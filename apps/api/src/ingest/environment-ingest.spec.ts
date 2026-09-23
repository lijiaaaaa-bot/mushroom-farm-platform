import { readFileSync } from 'fs';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Role } from '@mushroom/contracts';
import { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { QueryFailedError } from 'typeorm';
import { AlertEngineService } from '../alerts';
import { AuthUser } from '../common/auth-user';
import { IngestTokenGuard } from '../common/guards';
import { configureApp } from '../configure-app';
import { DevicesService } from '../devices';
import { EnvironmentReading } from '../entities/environment-reading.entity';
import { IngestReject } from '../entities/ingest-reject.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import { RedisService } from '../redis';
import { MinioStorageService } from '../storage';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';
import { MqttIngestAdapter } from './mqtt.adapter';

const golden = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '../../../../packages/contracts/fixtures/environment.golden.json',
    ),
    'utf8',
  ),
) as { body: Record<string, unknown> };

const recognitionGolden = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '../../../../packages/contracts/fixtures/recognition.golden.json',
    ),
    'utf8',
  ),
) as { body: Record<string, unknown> };

type Reading = EnvironmentReading;

function memoryReadings() {
  const rows: Reading[] = [];
  let seq = 0;
  return {
    rows,
    create: (input: Partial<Reading>) => input,
    findOne: async ({
      where,
    }: {
      where: { idempotencyKey?: string; id?: string };
    }) =>
      rows.find((row) => {
        if (
          where.idempotencyKey &&
          row.idempotencyKey !== where.idempotencyKey
        ) {
          return false;
        }
        if (where.id && row.id !== where.id) return false;
        return Boolean(where.idempotencyKey || where.id);
      }) ?? null,
    save: async (input: Partial<Reading>) => {
      const clash = rows.find(
        (row) => row.idempotencyKey === input.idempotencyKey,
      );
      if (clash) {
        const driverError = new Error('duplicate key') as Error & {
          code: string;
        };
        driverError.code = '23505';
        throw new QueryFailedError('INSERT', [], driverError);
      }
      const saved = {
        ...input,
        id: input.id ?? `env-${++seq}`,
        createdAt: input.createdAt ?? new Date(),
      } as Reading;
      rows.push(saved);
      return saved;
    },
    createQueryBuilder: () => {
      const filters: Array<(item: Reading) => boolean> = [];
      let skip = 0;
      let take = rows.length;
      const qb = {
        orderBy: () => qb,
        andWhere: (sql: string, params?: Record<string, unknown>) => {
          if (sql === '1 = 0') filters.push(() => false);
          else if (sql === 'e.shedCode IN (:...codes)') {
            const codes = params?.codes as string[];
            filters.push((item) => codes.includes(item.shedCode));
          } else if (sql === 'e.shedCode = :shedCode') {
            filters.push((item) => item.shedCode === params?.shedCode);
          } else if (sql === 'e.observedAt >= :from') {
            const from = params?.from as Date;
            filters.push((item) => item.observedAt >= from);
          } else if (sql === 'e.observedAt <= :to') {
            const to = params?.to as Date;
            filters.push((item) => item.observedAt <= to);
          } else {
            throw new Error(`unhandled where: ${sql}`);
          }
          return qb;
        },
        skip: (value: number) => {
          skip = value;
          return qb;
        },
        take: (value: number) => {
          take = value;
          return qb;
        },
        getManyAndCount: async () => {
          const matched = rows
            .filter((item) => filters.every((fn) => fn(item)))
            .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime());
          return [matched.slice(skip, skip + take), matched.length] as const;
        },
      };
      return qb;
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

describe('environment ingest', () => {
  let app: INestApplication;
  const readings = memoryReadings();
  const recognitionSave = jest.fn();
  const heartbeat = jest.fn();
  const redisKeys = new Set<string>();
  let redisMode: 'nx' | 'down' = 'nx';
  const rejects: { errors: string[] }[] = [];

  beforeEach(async () => {
    readings.rows.splice(0, readings.rows.length);
    redisKeys.clear();
    redisMode = 'nx';
    rejects.splice(0, rejects.length);
    recognitionSave.mockReset();
    heartbeat.mockReset();
    heartbeat.mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      controllers: [IngestController],
      providers: [
        IngestService,
        IngestTokenGuard,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'ingestToken' ? 'dev-ingest-token' : undefined,
          },
        },
        {
          provide: getRepositoryToken(RecognitionRecord),
          useValue: {
            create: jest.fn(),
            save: recognitionSave,
            findOne: jest.fn(),
          },
        },
        { provide: getRepositoryToken(EnvironmentReading), useValue: readings },
        {
          provide: getRepositoryToken(IngestReject),
          useValue: {
            create: (row: unknown) => row,
            save: async (row: { errors: string[] }) => {
              rejects.push(row);
              return row;
            },
          },
        },
        {
          provide: RedisService,
          useValue: {
            setNx: async (key: string) => {
              if (redisMode === 'down') return null;
              if (redisKeys.has(key)) return false;
              redisKeys.add(key);
              return true;
            },
          },
        },
        { provide: MinioStorageService, useValue: {} },
        { provide: DevicesService, useValue: { heartbeat } },
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

  function post(body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/api/v1/ingest/environment')
      .set('x-ingest-token', 'dev-ingest-token')
      .send(body);
  }

  it('accepts a valid environment report and lists shed, time, temperature, and humidity', async () => {
    const created = await post(golden.body);

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      accepted: true,
      duplicate: false,
      id: readings.rows[0]?.id,
    });
    expect(readings.rows).toHaveLength(1);
    expect(readings.rows[0]).toMatchObject({
      shedCode: 'S01',
      sensorCode: 'SENSOR-S01',
      temperature: 22.5,
      humidity: 88,
      source: 'http',
    });
    expect(heartbeat).toHaveBeenCalledWith('S01', 'SENSOR-S01', 'sensor', true);
    expect(recognitionSave).not.toHaveBeenCalled();

    const listed = await request(app.getHttpServer())
      .get('/api/v1/ingest/environment-readings')
      .query({ pageSize: '50' })
      .set('x-test-role', 'super_admin');

    expect(listed.status).toBe(200);
    expect(listed.body.total).toBe(1);
    expect(listed.body.items[0]).toMatchObject({
      shedCode: 'S01',
      temperature: 22.5,
      humidity: 88,
    });
  });

  it('treats the same idempotency key as a duplicate and stores one row', async () => {
    const first = await post(golden.body);
    const second = await post(golden.body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toMatchObject({
      accepted: true,
      duplicate: true,
      id: first.body.id,
    });
    expect(readings.rows).toHaveLength(1);
    expect(heartbeat).toHaveBeenCalledTimes(1);
  });

  it('dedupes a payload without an idempotency key by shed, sensor, and time', async () => {
    const body = { ...golden.body };
    delete body.idempotencyKey;
    const first = await post(body);
    const second = await post(body);

    expect(first.body.duplicate).toBe(false);
    expect(second.body).toMatchObject({
      accepted: true,
      duplicate: true,
      id: first.body.id,
    });
    expect(readings.rows).toHaveLength(1);
  });

  it('returns the existing row when Redis is down and the unique key already exists', async () => {
    const first = await post(golden.body);
    redisMode = 'down';
    const second = await post(golden.body);

    expect(second.status).toBe(201);
    expect(second.body).toMatchObject({
      accepted: true,
      duplicate: true,
      id: first.body.id,
    });
    expect(readings.rows).toHaveLength(1);
  });

  it('rejects a recognition payload on the environment path', async () => {
    const response = await post(recognitionGolden.body);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('UNKNOWN_FIELD');
    expect(String(response.body.errors)).toContain('未知字段');
    expect(readings.rows).toHaveLength(0);
    expect(rejects).toHaveLength(1);
    expect(recognitionSave).not.toHaveBeenCalled();
  });

  it('keeps shed managers and viewers inside their sheds', async () => {
    await post(golden.body);
    await post({
      ...golden.body,
      idempotencyKey: 'golden-environment-s02',
      shedCode: 'S02',
      sensorCode: 'SENSOR-S02',
      observedAt: '2026-09-23T01:40:00.000Z',
      temperature: 19,
      humidity: 91,
    });

    const manager = await request(app.getHttpServer())
      .get('/api/v1/ingest/environment-readings')
      .query({ pageSize: '50' })
      .set('x-test-role', 'shed_manager');
    const viewer = await request(app.getHttpServer())
      .get('/api/v1/ingest/environment-readings')
      .query({ pageSize: '50' })
      .set('x-test-role', 'viewer');
    const crossed = await request(app.getHttpServer())
      .get('/api/v1/ingest/environment-readings')
      .query({ shedCode: 'S02' })
      .set('x-test-role', 'shed_manager');
    const emptyScope = await request(app.getHttpServer())
      .get('/api/v1/ingest/environment-readings')
      .set('x-test-role', 'viewer')
      .set('x-test-sheds', '');
    const admin = await request(app.getHttpServer())
      .get('/api/v1/ingest/environment-readings')
      .query({ pageSize: '50' })
      .set('x-test-role', 'super_admin');

    expect(manager.status).toBe(200);
    expect(
      manager.body.items.map((item: { shedCode: string }) => item.shedCode),
    ).toEqual(['S01']);
    expect(
      viewer.body.items.map((item: { shedCode: string }) => item.shedCode),
    ).toEqual(['S01']);
    expect(crossed.status).toBe(403);
    expect(emptyScope.body).toMatchObject({ items: [], total: 0 });
    expect(admin.body.total).toBe(2);
  });

  it('stores an MQTT environment report without calling recognition ingest', async () => {
    const ingest = app.get(IngestService);
    const handle = jest.spyOn(ingest, 'handle');
    const adapter = new MqttIngestAdapter(
      app.get(ConfigService),
      ingest,
      app.get(DevicesService),
    );
    await adapter.onMessage(
      'mushroom/S03/SENSOR-S03/environment',
      Buffer.from(
        JSON.stringify({
          observedAt: '2026-09-23T01:45:00.000Z',
          temperature: 18.4,
          humidity: 86,
        }),
      ),
    );

    expect(handle).not.toHaveBeenCalled();
    expect(readings.rows).toHaveLength(1);
    expect(readings.rows[0]).toMatchObject({
      shedCode: 'S03',
      sensorCode: 'SENSOR-S03',
      temperature: 18.4,
      humidity: 86,
      source: 'mqtt',
    });
  });
});
