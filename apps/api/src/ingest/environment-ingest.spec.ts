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
import { HeartbeatReceipt } from '../entities/heartbeat-receipt.entity';
import { IngestReject } from '../entities/ingest-reject.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import { RedisService } from '../redis';
import { MinioStorageService } from '../storage';
import { GrowthTrendService } from '../growth';
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
      let distinct = false;
      const matched = () =>
        rows
          .filter((item) => filters.every((fn) => fn(item)))
          .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime());
      const qb = {
        distinctOn: () => {
          distinct = true;
          return qb;
        },
        orderBy: () => qb,
        addOrderBy: () => qb,
        andWhere: (sql: string, params?: Record<string, unknown>) => {
          if (sql === '1 = 0') filters.push(() => false);
          else if (sql === 'e.shedCode IN (:...codes)') {
            const codes = params?.codes as string[];
            filters.push((item) => codes.includes(item.shedCode));
          } else if (sql === 'e.shedCode = :shedCode') {
            filters.push((item) => item.shedCode === params?.shedCode);
          } else if (sql === 'e.sensorCode = :sensorCode') {
            filters.push((item) => item.sensorCode === params?.sensorCode);
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
        getMany: async () => {
          const items = matched();
          if (!distinct) return items;
          const seen = new Set<string>();
          const latest: Reading[] = [];
          for (const item of items) {
            const key = `${item.shedCode}\0${item.sensorCode}`;
            if (seen.has(key)) continue;
            seen.add(key);
            latest.push(item);
          }
          return latest;
        },
        getManyAndCount: async () => {
          const items = matched();
          return [items.slice(skip, skip + take), items.length] as const;
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
  const applyEnvironment = jest.fn();
  const evaluateEnvironment = jest.fn();
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
    evaluateEnvironment.mockReset();
    applyEnvironment.mockReset();
    applyEnvironment.mockResolvedValue(undefined);
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
          provide: getRepositoryToken(HeartbeatReceipt),
          useValue: { create: jest.fn(), save: jest.fn() },
        },
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
        {
          provide: AlertEngineService,
          useValue: { evaluate: jest.fn(), evaluateEnvironment },
        },
        {
          provide: GrowthTrendService,
          useValue: { applyEnvironment },
        },
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
    expect(applyEnvironment).toHaveBeenCalledTimes(1);
    expect(applyEnvironment.mock.calls[0][0]).toMatchObject({
      shedCode: 'S01',
      sensorCode: 'SENSOR-S01',
      temperature: 22.5,
      humidity: 88,
      observedAt: readings.rows[0]?.observedAt,
    });

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
    expect(applyEnvironment).toHaveBeenCalledTimes(1);
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
    expect(evaluateEnvironment).toHaveBeenCalledTimes(1);
    expect(evaluateEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: first.body.id,
        shedCode: 'S01',
        sensorCode: 'SENSOR-S01',
        temperature: golden.body.temperature,
      }),
    );
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

  it('keeps one latest row per sensor and returns that row from the detail', async () => {
    await post(golden.body);
    const newer = await post({
      ...golden.body,
      idempotencyKey: 'golden-environment-later',
      observedAt: '2026-09-23T02:10:00.000Z',
      temperature: 24.6,
      humidity: 85,
      co2: 760,
      substrateMoisture: 72,
    });
    await post({
      ...golden.body,
      idempotencyKey: 'golden-environment-other',
      sensorCode: 'SENSOR-S01-B',
      observedAt: '2026-09-23T02:05:00.000Z',
      temperature: 18.1,
      humidity: 90,
      co2: 1000,
      substrateMoisture: 60,
    });

    const latest = await request(app.getHttpServer())
      .get('/api/v1/ingest/environment-readings/latest')
      .query({ sensorCode: 'SENSOR-S01' })
      .set('x-test-role', 'super_admin');
    const both = await request(app.getHttpServer())
      .get('/api/v1/ingest/environment-readings/latest')
      .set('x-test-role', 'super_admin');
    const history = await request(app.getHttpServer())
      .get('/api/v1/ingest/environment-readings')
      .query({ sensorCode: 'SENSOR-S01', pageSize: '50' })
      .set('x-test-role', 'super_admin');
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/ingest/environment-readings/${newer.body.id}`)
      .set('x-test-role', 'super_admin');

    expect(latest.status).toBe(200);
    expect(latest.body.total).toBe(1);
    expect(latest.body.items[0]).toMatchObject({
      id: newer.body.id,
      sensorCode: 'SENSOR-S01',
      temperature: 24.6,
      humidity: 85,
      co2: 760,
      substrateMoisture: 72,
    });
    expect(latest.body.items[0].temperature).not.toBe(22.5);
    expect(both.body.total).toBe(2);
    expect(
      both.body.items.map((item: { sensorCode: string }) => item.sensorCode),
    ).toEqual(['SENSOR-S01', 'SENSOR-S01-B']);
    expect(history.body.total).toBe(2);
    expect(
      history.body.items.map(
        (item: { temperature: number }) => item.temperature,
      ),
    ).toEqual([24.6, 22.5]);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      id: newer.body.id,
      temperature: 24.6,
      co2: 760,
      substrateMoisture: 72,
      source: 'http',
    });
  });

  it('lists one sensor inside a time window and leaves other rows out', async () => {
    await post({
      ...golden.body,
      idempotencyKey: 'hist-in-older',
      sensorCode: 'SENSOR-HIST-01',
      observedAt: '2026-09-23T01:22:00.000Z',
      temperature: 18.4,
      humidity: 86,
      co2: 820,
      substrateMoisture: 66,
    });
    await post({
      ...golden.body,
      idempotencyKey: 'hist-in-newer',
      sensorCode: 'SENSOR-HIST-01',
      observedAt: '2026-09-23T01:30:00.000Z',
      temperature: 23.1,
      humidity: 80,
      co2: 740,
      substrateMoisture: 71,
    });
    await post({
      ...golden.body,
      idempotencyKey: 'hist-outside',
      sensorCode: 'SENSOR-HIST-01',
      observedAt: '2026-09-23T00:00:00.000Z',
      temperature: 16.5,
      humidity: 84,
      co2: 900,
      substrateMoisture: 68,
    });
    await post({
      ...golden.body,
      idempotencyKey: 'hist-other',
      sensorCode: 'SENSOR-HIST-02',
      observedAt: '2026-09-23T01:26:00.000Z',
      temperature: 21,
      humidity: 82,
      co2: 880,
      substrateMoisture: 67,
    });

    const history = await request(app.getHttpServer())
      .get('/api/v1/ingest/environment-readings')
      .query({
        sensorCode: 'SENSOR-HIST-01',
        from: '2026-09-23T01:00:00.000Z',
        to: '2026-09-23T01:40:00.000Z',
        pageSize: '50',
      })
      .set('x-test-role', 'super_admin');
    const byDevice = await request(app.getHttpServer())
      .get('/api/v1/ingest/environment-readings')
      .query({
        deviceCode: 'SENSOR-HIST-01',
        from: '2026-09-23T01:00:00.000Z',
        to: '2026-09-23T01:40:00.000Z',
        pageSize: '50',
      })
      .set('x-test-role', 'super_admin');

    expect(history.status).toBe(200);
    expect(history.body.total).toBe(2);
    expect(
      history.body.items.map(
        (item: { temperature: number }) => item.temperature,
      ),
    ).toEqual([23.1, 18.4]);
    expect(
      history.body.items.every(
        (item: { sensorCode: string }) => item.sensorCode === 'SENSOR-HIST-01',
      ),
    ).toBe(true);
    expect(JSON.stringify(history.body.items)).not.toContain('16.5');
    expect(JSON.stringify(history.body.items)).not.toContain('SENSOR-HIST-02');
    expect(byDevice.body.total).toBe(2);
    expect(
      byDevice.body.items.map(
        (item: { temperature: number }) => item.temperature,
      ),
    ).toEqual([23.1, 18.4]);
  });

  it('hides another shed from the latest list and the detail', async () => {
    const own = await post(golden.body);
    const other = await post({
      ...golden.body,
      idempotencyKey: 'golden-environment-s02-latest',
      shedCode: 'S02',
      sensorCode: 'SENSOR-S02',
      observedAt: '2026-09-23T02:20:00.000Z',
      temperature: 19,
      humidity: 91,
    });

    const latest = await request(app.getHttpServer())
      .get('/api/v1/ingest/environment-readings/latest')
      .set('x-test-role', 'shed_manager');
    const crossed = await request(app.getHttpServer())
      .get('/api/v1/ingest/environment-readings/latest')
      .query({ shedCode: 'S02' })
      .set('x-test-role', 'viewer');
    const denied = await request(app.getHttpServer())
      .get(`/api/v1/ingest/environment-readings/${other.body.id}`)
      .set('x-test-role', 'shed_manager');
    const allowed = await request(app.getHttpServer())
      .get(`/api/v1/ingest/environment-readings/${own.body.id}`)
      .set('x-test-role', 'viewer');
    const missing = await request(app.getHttpServer())
      .get('/api/v1/ingest/environment-readings/missing-reading')
      .set('x-test-role', 'super_admin');
    const emptyScope = await request(app.getHttpServer())
      .get('/api/v1/ingest/environment-readings/latest')
      .set('x-test-role', 'viewer')
      .set('x-test-sheds', '');

    expect(latest.status).toBe(200);
    expect(
      latest.body.items.map((item: { shedCode: string }) => item.shedCode),
    ).toEqual(['S01']);
    expect(crossed.status).toBe(403);
    expect(denied.status).toBe(403);
    expect(allowed.status).toBe(200);
    expect(allowed.body.id).toBe(own.body.id);
    expect(missing.status).toBe(404);
    expect(emptyScope.body).toMatchObject({ items: [], total: 0 });
  });

  it('includes both ends of from and to and rejects an invalid window', async () => {
    const from = '2026-10-14T01:00:00.000Z';
    const to = '2026-10-14T02:00:00.000Z';
    await post({
      ...golden.body,
      idempotencyKey: 'envf-from',
      sensorCode: 'SENSOR-ENVF-01',
      observedAt: from,
      temperature: 15.2,
      humidity: 82,
      co2: 910,
      substrateMoisture: 66,
    });
    await post({
      ...golden.body,
      idempotencyKey: 'envf-mid',
      sensorCode: 'SENSOR-ENVF-01',
      observedAt: '2026-10-14T01:30:00.000Z',
      temperature: 19.7,
      humidity: 86,
      co2: 820,
      substrateMoisture: 68,
    });
    await post({
      ...golden.body,
      idempotencyKey: 'envf-to',
      sensorCode: 'SENSOR-ENVF-01',
      observedAt: to,
      temperature: 26.4,
      humidity: 80,
      co2: 740,
      substrateMoisture: 71,
    });
    await post({
      ...golden.body,
      idempotencyKey: 'envf-before',
      sensorCode: 'SENSOR-ENVF-01',
      observedAt: '2026-10-14T00:59:59.000Z',
      temperature: 14.1,
      humidity: 82,
      co2: 900,
      substrateMoisture: 66,
    });

    const windowed = await request(app.getHttpServer())
      .get('/api/v1/ingest/environment-readings')
      .query({ sensorCode: 'SENSOR-ENVF-01', from, to, pageSize: '50' })
      .set('x-test-role', 'super_admin');
    const reversed = await request(app.getHttpServer())
      .get('/api/v1/ingest/environment-readings')
      .query({
        sensorCode: 'SENSOR-ENVF-01',
        from: to,
        to: from,
        pageSize: '50',
      })
      .set('x-test-role', 'super_admin');
    const bogus = await request(app.getHttpServer())
      .get('/api/v1/ingest/environment-readings')
      .query({
        sensorCode: 'SENSOR-ENVF-01',
        from: 'not-a-date',
        to,
        pageSize: '50',
      })
      .set('x-test-role', 'super_admin');

    expect(windowed.status).toBe(200);
    expect(windowed.body.total).toBe(3);
    expect(
      windowed.body.items.map(
        (item: { temperature: number }) => item.temperature,
      ),
    ).toEqual([26.4, 19.7, 15.2]);
    expect(JSON.stringify(windowed.body.items)).not.toContain('14.1');
    expect(reversed.status).toBe(400);
    expect(JSON.stringify(reversed.body)).toContain('时间筛选无效');
    expect(bogus.status).toBe(400);
    expect(JSON.stringify(bogus.body)).toContain('时间筛选无效');
  });
});
