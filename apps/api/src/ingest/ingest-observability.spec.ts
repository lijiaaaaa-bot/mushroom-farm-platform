import { readFileSync } from 'fs';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Role } from '@mushroom/contracts';
import { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { AlertEngineService } from '../alerts';
import { AuthUser } from '../common/auth-user';
import { IngestTokenGuard } from '../common/guards';
import { configureApp } from '../configure-app';
import { DevicesService } from '../devices';
import { Alert } from '../entities/alert.entity';
import { Device } from '../entities/device.entity';
import { EnvironmentReading } from '../entities/environment-reading.entity';
import { HeartbeatReceipt } from '../entities/heartbeat-receipt.entity';
import { IngestReject } from '../entities/ingest-reject.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import { Shed } from '../entities/shed.entity';
import { RedisService } from '../redis';
import { MinioStorageService } from '../storage';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';

const heartbeatFixture = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '../../../../packages/contracts/fixtures/heartbeat.http.json',
    ),
    'utf8',
  ),
) as { body: Record<string, unknown> };

interface Summary {
  windowMinutes: number;
  accepted: number;
  rejected: number;
  latencyP50Ms: number | null;
  latencyLatestMs: number | null;
  channels: Array<{
    channel: string;
    transport: string;
    accepted: number;
    rejected: number;
    latencyP50Ms: number | null;
    latencyLatestMs: number | null;
  }>;
  recentErrors: Array<{
    channel: string;
    transport: string;
    shedCode: string | null;
    code: string | null;
    errors: string[];
  }>;
}

function memoryTable<
  T extends { id?: string; createdAt?: Date; shedCode?: string | null },
>() {
  const rows: T[] = [];
  let seq = 0;
  return {
    rows,
    create: (input: Partial<T>) => ({ ...input }) as T,
    save: async (input: Partial<T>) => {
      const saved = {
        ...input,
        id: input.id ?? `row-${++seq}`,
        createdAt: input.createdAt ?? new Date(),
      } as T;
      rows.push(saved);
      return saved;
    },
    findOne: async () => null,
    createQueryBuilder: () => {
      let since: Date | null = null;
      let sheds: string[] | null = null;
      let blocked = false;
      let limit: number | null = null;
      const qb = {
        where: (sql: string, params?: { since?: Date }) => {
          if (sql.includes('createdAt >= :since') && params?.since)
            since = params.since;
          return qb;
        },
        andWhere: (sql: string, params?: { codes?: string[] }) => {
          if (sql.includes('1 = 0')) blocked = true;
          if (sql.includes('shedCode IN') && params?.codes)
            sheds = params.codes;
          return qb;
        },
        orderBy: () => qb,
        take: (value: number) => {
          limit = value;
          return qb;
        },
        getMany: async () => {
          if (blocked) return [];
          let items = rows.filter((row) => {
            if (since && row.createdAt && row.createdAt < since) return false;
            if (sheds && (!row.shedCode || !sheds.includes(row.shedCode)))
              return false;
            return true;
          });
          items = [...items].sort(
            (a, b) =>
              (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
          );
          if (limit !== null) items = items.slice(0, limit);
          return items;
        },
      };
      return qb;
    },
  };
}

function memoryDevices() {
  const rows: Device[] = [];
  return {
    rows,
    findOne: async ({ where }: { where: { code?: string } }) =>
      rows.find((row) => row.code === where.code) ?? null,
    find: async () => rows,
    create: (input: Partial<Device>) => ({ ...input }) as Device,
    save: async (input: Partial<Device> | Partial<Device>[]) => {
      const batch = Array.isArray(input) ? input : [input];
      const saved = batch.map((item) => {
        const next = {
          parentCode: null,
          onlineStatus: 'offline' as const,
          lastSeenAt: null,
          lastHeartbeatAt: null,
          meta: {},
          ...item,
          id: item.id ?? `device-${rows.length + 1}`,
          createdAt: item.createdAt ?? new Date(),
        } as Device;
        const index = rows.findIndex((row) => row.code === next.code);
        if (index >= 0) rows[index] = next;
        else rows.push(next);
        return next;
      });
      return Array.isArray(input) ? saved : saved[0];
    },
  };
}

function assignUser(
  req: Request & { user?: AuthUser },
  _res: Response,
  next: NextFunction,
) {
  const role = req.header('x-test-role');
  if (
    role === 'super_admin' ||
    role === 'production_admin' ||
    role === 'shed_manager' ||
    role === 'viewer'
  ) {
    const rawSheds = req.header('x-test-sheds');
    req.user = {
      id: `id-${role}`,
      username: role,
      displayName: role,
      role: role as Role,
      shedCodes:
        rawSheds === undefined
          ? ['S01']
          : rawSheds
              .split(',')
              .map((code) => code.trim())
              .filter(Boolean),
    };
  }
  next();
}

function channel(body: Summary, name: string, transport: string) {
  const row = body.channels.find(
    (item) => item.channel === name && item.transport === transport,
  );
  expect(row).toBeTruthy();
  return row!;
}

describe('ingest observability', () => {
  let app: INestApplication;
  const records = memoryTable<RecognitionRecord>();
  const readings = memoryTable<EnvironmentReading>();
  const rejects = memoryTable<IngestReject>();
  const beats = memoryTable<HeartbeatReceipt>();

  beforeEach(async () => {
    records.rows.splice(0, records.rows.length);
    readings.rows.splice(0, readings.rows.length);
    rejects.rows.splice(0, rejects.rows.length);
    beats.rows.splice(0, beats.rows.length);
    const moduleRef = await Test.createTestingModule({
      controllers: [IngestController],
      providers: [
        IngestService,
        DevicesService,
        IngestTokenGuard,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'ingestToken' ? 'dev-ingest-token' : undefined,
          },
        },
        { provide: getRepositoryToken(RecognitionRecord), useValue: records },
        { provide: getRepositoryToken(EnvironmentReading), useValue: readings },
        { provide: getRepositoryToken(IngestReject), useValue: rejects },
        { provide: getRepositoryToken(HeartbeatReceipt), useValue: beats },
        { provide: getRepositoryToken(Device), useValue: memoryDevices() },
        {
          provide: getRepositoryToken(Shed),
          useValue: {
            findOne: async ({ where }: { where: { code?: string } }) =>
              where.code === 'S01' ? { code: 'S01', name: 'S01' } : null,
            create: (input: { code: string; name: string }) => input,
            save: async (input: { code: string }) => input,
          },
        },
        {
          provide: getRepositoryToken(Alert),
          useValue: {
            find: async () => [],
            create: (input: Partial<Alert>) => input,
            save: async (input: Partial<Alert>) => input,
          },
        },
        { provide: RedisService, useValue: {} },
        { provide: MinioStorageService, useValue: {} },
        { provide: AlertEngineService, useValue: { evaluate: jest.fn() } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(assignUser);
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  function summary(role: string, sheds?: string) {
    const req = request(app.getHttpServer())
      .get('/api/v1/ingest/observability')
      .set('x-test-role', role);
    if (sheds !== undefined) req.set('x-test-sheds', sheds);
    return req;
  }

  it('counts the recent window and keeps other sheds out of a shed manager view', async () => {
    const t0 = new Date();
    records.rows.push(
      {
        id: 'rec-s01-a',
        shedCode: 'S01',
        source: 'http',
        createdAt: t0,
        recognizedAt: new Date(t0.getTime() - 1000),
      } as RecognitionRecord,
      {
        id: 'rec-s01-b',
        shedCode: 'S01',
        source: 'http',
        createdAt: new Date(t0.getTime() + 1000),
        recognizedAt: new Date(t0.getTime() + 1000 - 3000),
      } as RecognitionRecord,
      {
        id: 'rec-s02',
        shedCode: 'S02',
        source: 'mqtt',
        createdAt: t0,
        recognizedAt: new Date(t0.getTime() - 800),
      } as RecognitionRecord,
      {
        id: 'rec-old',
        shedCode: 'S01',
        source: 'http',
        createdAt: new Date(t0.getTime() - 2 * 24 * 60 * 60 * 1000),
        recognizedAt: new Date(t0.getTime() - 2 * 24 * 60 * 60 * 1000),
      } as RecognitionRecord,
    );
    readings.rows.push({
      id: 'env-s01',
      shedCode: 'S01',
      source: 'http',
      createdAt: t0,
      observedAt: new Date(t0.getTime() - 500),
    } as EnvironmentReading);
    beats.rows.push(
      {
        id: 'beat-s01',
        shedCode: 'S01',
        source: 'http',
        latencyMs: 200,
        createdAt: t0,
      } as HeartbeatReceipt,
      {
        id: 'beat-s02',
        shedCode: 'S02',
        source: 'mqtt',
        latencyMs: 400,
        createdAt: t0,
      } as HeartbeatReceipt,
    );
    rejects.rows.push(
      {
        id: 'err-s02',
        channel: 'recognition',
        source: 'mqtt',
        shedCode: 'S02',
        code: 'UNKNOWN_FIELD',
        errors: ['二号棚未知字段'],
        createdAt: t0,
      } as IngestReject,
      {
        id: 'err-s01',
        channel: 'heartbeat',
        source: 'http',
        shedCode: 'S01',
        code: 'VALIDATION_FAILED',
        errors: ['一号棚心跳无效'],
        createdAt: new Date(t0.getTime() + 500),
      } as IngestReject,
      {
        id: 'err-none',
        channel: 'recognition',
        source: 'http',
        shedCode: null,
        code: 'VALIDATION_FAILED',
        errors: ['无棚载荷不是 JSON'],
        createdAt: t0,
      } as IngestReject,
    );

    const admin = await summary('super_admin');
    const producer = await summary('production_admin', 'S01');
    const manager = await summary('shed_manager');
    const viewer = await summary('viewer', '');

    expect(admin.status).toBe(200);
    expect(admin.body.channels).toHaveLength(6);
    expect(admin.body).toMatchObject({
      windowMinutes: 60,
      accepted: 6,
      rejected: 3,
      latencyP50Ms: 650,
      latencyLatestMs: 3000,
    });
    expect(channel(admin.body, 'recognition', 'http')).toMatchObject({
      accepted: 2,
      rejected: 1,
      latencyP50Ms: 2000,
      latencyLatestMs: 3000,
    });
    expect(channel(admin.body, 'recognition', 'mqtt')).toMatchObject({
      accepted: 1,
      rejected: 1,
    });
    expect(channel(admin.body, 'environment', 'http')).toMatchObject({
      accepted: 1,
      rejected: 0,
      latencyP50Ms: 500,
    });
    expect(channel(admin.body, 'environment', 'mqtt').accepted).toBe(0);
    expect(channel(admin.body, 'heartbeat', 'http')).toMatchObject({
      accepted: 1,
      rejected: 1,
      latencyP50Ms: 200,
    });
    expect(channel(admin.body, 'heartbeat', 'mqtt')).toMatchObject({
      accepted: 1,
      rejected: 0,
    });
    expect(
      admin.body.recentErrors.map(
        (item: { errors: string[] }) => item.errors[0],
      ),
    ).toEqual(
      expect.arrayContaining([
        '二号棚未知字段',
        '一号棚心跳无效',
        '无棚载荷不是 JSON',
      ]),
    );

    expect(producer.status).toBe(200);
    expect(producer.body.accepted).toBe(6);
    expect(producer.body.rejected).toBe(3);

    expect(manager.status).toBe(200);
    expect(manager.body).toMatchObject({
      accepted: 4,
      rejected: 1,
      latencyP50Ms: 750,
      latencyLatestMs: 3000,
    });
    expect(channel(manager.body, 'recognition', 'mqtt')).toMatchObject({
      accepted: 0,
      rejected: 0,
    });
    expect(channel(manager.body, 'heartbeat', 'mqtt').accepted).toBe(0);
    expect(manager.body.recentErrors).toEqual([
      expect.objectContaining({
        channel: 'heartbeat',
        shedCode: 'S01',
        errors: ['一号棚心跳无效'],
      }),
    ]);
    expect(JSON.stringify(manager.body)).not.toContain('二号棚未知字段');
    expect(JSON.stringify(manager.body)).not.toContain('无棚载荷不是 JSON');

    expect(viewer.status).toBe(200);
    expect(viewer.body).toMatchObject({
      accepted: 0,
      rejected: 0,
      latencyP50Ms: null,
      recentErrors: [],
    });
  });

  it('records an accepted HTTP heartbeat and a rejected heartbeat in the summary', async () => {
    const accepted = await request(app.getHttpServer())
      .post('/api/v1/ingest/heartbeat')
      .set('x-ingest-token', 'dev-ingest-token')
      .send(heartbeatFixture.body);
    const duplicate = await request(app.getHttpServer())
      .post('/api/v1/ingest/heartbeat')
      .set('x-ingest-token', 'dev-ingest-token')
      .send(heartbeatFixture.body);
    const rejected = await request(app.getHttpServer())
      .post('/api/v1/ingest/heartbeat')
      .set('x-ingest-token', 'dev-ingest-token')
      .send({ ...heartbeatFixture.body, firmware: '1.2.3' });

    expect(accepted.status).toBe(201);
    expect(accepted.body.duplicate).toBe(false);
    expect(duplicate.body.duplicate).toBe(true);
    expect(rejected.status).toBe(400);
    expect(rejected.body.code).toBe('UNKNOWN_FIELD');

    const listed = await summary('shed_manager');
    expect(listed.status).toBe(200);
    expect(channel(listed.body, 'heartbeat', 'http')).toMatchObject({
      accepted: 2,
      rejected: 1,
    });
    expect(listed.body.recentErrors[0]).toMatchObject({
      channel: 'heartbeat',
      transport: 'http',
      shedCode: 'S01',
      code: 'UNKNOWN_FIELD',
    });
    expect(listed.body.recentErrors[0].errors.join('；')).toContain('未知字段');
    expect(channel(listed.body, 'heartbeat', 'http').latencyLatestMs).toEqual(
      expect.any(Number),
    );

    const otherShed = await summary('shed_manager', 'S02');
    expect(otherShed.body).toMatchObject({
      accepted: 0,
      rejected: 0,
      recentErrors: [],
    });
  });
});
