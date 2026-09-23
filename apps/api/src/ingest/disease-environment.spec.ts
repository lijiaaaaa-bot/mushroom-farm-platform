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
import { DiseasesController } from '../diseases/diseases.controller';
import { EnvironmentReading } from '../entities/environment-reading.entity';
import { HeartbeatReceipt } from '../entities/heartbeat-receipt.entity';
import { IngestReject } from '../entities/ingest-reject.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import { RedisService } from '../redis';
import { MinioStorageService } from '../storage';
import { IngestService } from './ingest.service';

const RECOGNIZED_AT = new Date('2026-09-23T02:00:00.000Z');

function recognition(
  partial: Partial<RecognitionRecord> &
    Pick<RecognitionRecord, 'id' | 'shedCode'>,
): RecognitionRecord {
  return {
    idempotencyKey: partial.id,
    cameraCode: 'CAM-1',
    recognizedAt: RECOGNIZED_AT,
    mushroomCount: 10,
    matureCount: 4,
    capDiameters: [],
    avgCapDiameter: null,
    diseaseCount: 2,
    diseaseLevel: 1,
    snapshotObjectKey: null,
    snapshotUrl: null,
    temperature: 22.5,
    humidity: 88,
    co2: 900,
    substrateMoisture: 70,
    source: 'http',
    rawPayload: null,
    createdAt: RECOGNIZED_AT,
    ...partial,
  };
}

function reading(
  partial: Partial<EnvironmentReading> &
    Pick<EnvironmentReading, 'id' | 'shedCode' | 'observedAt'>,
): EnvironmentReading {
  return {
    idempotencyKey: partial.id,
    sensorCode: 'SEN-1',
    temperature: 21,
    humidity: 80,
    co2: 800,
    substrateMoisture: 60,
    source: 'http',
    rawPayload: null,
    createdAt: partial.observedAt,
    ...partial,
  };
}

function memoryRecords(rows: RecognitionRecord[]) {
  return {
    findOne: async ({ where }: { where: { id?: string } }) =>
      rows.find((item) => item.id === where.id) ?? null,
  };
}

function memoryReadings(rows: EnvironmentReading[]) {
  return {
    createQueryBuilder: () => {
      const filters: Array<(item: EnvironmentReading) => boolean> = [];
      let order: 'ASC' | 'DESC' = 'ASC';
      const apply = (sql: string, params?: Record<string, unknown>) => {
        if (sql === 'e.shedCode = :shedCode') {
          filters.push((item) => item.shedCode === params?.shedCode);
        } else if (sql === 'e.observedAt >= :start') {
          const start = params?.start as Date;
          filters.push((item) => item.observedAt.getTime() >= start.getTime());
        } else if (sql === 'e.observedAt <= :end') {
          const end = params?.end as Date;
          filters.push((item) => item.observedAt.getTime() <= end.getTime());
        } else if (sql === 'e.sensorCode = :sensorCode') {
          filters.push((item) => item.sensorCode === params?.sensorCode);
        } else {
          throw new Error(`unhandled where: ${sql}`);
        }
      };
      const qb = {
        where: (sql: string, params?: Record<string, unknown>) => {
          apply(sql, params);
          return qb;
        },
        andWhere: (sql: string, params?: Record<string, unknown>) => {
          apply(sql, params);
          return qb;
        },
        orderBy: (_column: string, direction?: 'ASC' | 'DESC') => {
          order = direction ?? 'ASC';
          return qb;
        },
        getMany: async () =>
          rows
            .filter((item) => filters.every((fn) => fn(item)))
            .sort((a, b) => {
              const delta = a.observedAt.getTime() - b.observedAt.getTime();
              return order === 'ASC' ? delta : -delta;
            }),
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

describe('disease environment alignment', () => {
  let app: INestApplication;
  const records = memoryRecords([
    recognition({ id: 'd-s01', shedCode: 'S01' }),
    recognition({
      id: 'd-s02',
      shedCode: 'S02',
      cameraCode: 'CAM-2',
      recognizedAt: new Date('2026-09-23T03:00:00.000Z'),
    }),
    recognition({
      id: 'd-empty',
      shedCode: 'S01',
      recognizedAt: new Date('2026-08-01T00:00:00.000Z'),
      temperature: 22.5,
    }),
  ]);
  const readings = memoryReadings([
    reading({
      id: 'edge-before',
      shedCode: 'S01',
      observedAt: new Date('2026-09-23T01:30:00.000Z'),
      temperature: 18,
    }),
    reading({
      id: 'inside',
      shedCode: 'S01',
      observedAt: new Date('2026-09-23T01:50:00.000Z'),
      temperature: 21.5,
      humidity: 86,
      co2: 910,
      substrateMoisture: 68,
    }),
    reading({
      id: 'other-sensor',
      shedCode: 'S01',
      sensorCode: 'SEN-2',
      observedAt: new Date('2026-09-23T02:10:00.000Z'),
      temperature: 23,
    }),
    reading({
      id: 'edge-after',
      shedCode: 'S01',
      observedAt: new Date('2026-09-23T02:30:00.000Z'),
      temperature: 24,
    }),
    reading({
      id: 'before-window',
      shedCode: 'S01',
      observedAt: new Date('2026-09-23T01:29:59.000Z'),
      temperature: 1,
    }),
    reading({
      id: 'after-window',
      shedCode: 'S01',
      observedAt: new Date('2026-09-23T02:30:00.001Z'),
      temperature: 99,
    }),
    reading({
      id: 'other-shed',
      shedCode: 'S02',
      observedAt: new Date('2026-09-23T02:00:00.000Z'),
      temperature: 40,
      sensorCode: 'SEN-S02',
    }),
  ]);

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DiseasesController],
      providers: [
        IngestService,
        IngestTokenGuard,
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: getRepositoryToken(RecognitionRecord), useValue: records },
        { provide: getRepositoryToken(EnvironmentReading), useValue: readings },
        { provide: getRepositoryToken(IngestReject), useValue: {} },
        { provide: getRepositoryToken(HeartbeatReceipt), useValue: {} },
        { provide: RedisService, useValue: {} },
        { provide: MinioStorageService, useValue: {} },
        { provide: DevicesService, useValue: {} },
        { provide: AlertEngineService, useValue: {} },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(assignUser);
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('aligns readings to the recognition shed and the default 30 minute window', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/diseases/d-s01/environment')
      .set('x-test-role', 'super_admin');

    expect(response.status).toBe(200);
    expect(response.body.alignment).toEqual({
      shedCode: 'S01',
      sensorCode: null,
    });
    expect(response.body.window.beforeMinutes).toBe(30);
    expect(response.body.window.afterMinutes).toBe(30);
    expect(response.body.empty).toBe(false);
    expect(response.body.emptyReason).toBeNull();
    expect(response.body.readings.map((item: { id: string }) => item.id)).toEqual([
      'edge-before',
      'inside',
      'other-sensor',
      'edge-after',
    ]);
    expect(response.body.readings.map((item: { shedCode: string }) => item.shedCode)).toEqual([
      'S01',
      'S01',
      'S01',
      'S01',
    ]);
    const inside = response.body.readings.find(
      (item: { id: string }) => item.id === 'inside',
    );
    expect(inside).toMatchObject({
      temperature: 21.5,
      humidity: 86,
      co2: 910,
      substrateMoisture: 68,
      sensorCode: 'SEN-1',
    });
  });

  it('narrows the same shed window to one sensor', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/diseases/d-s01/environment')
      .query({ sensorCode: 'SEN-2', beforeMinutes: 30, afterMinutes: 30 })
      .set('x-test-role', 'production_admin');

    expect(response.status).toBe(200);
    expect(response.body.alignment.sensorCode).toBe('SEN-2');
    expect(response.body.readings.map((item: { id: string }) => item.id)).toEqual([
      'other-sensor',
    ]);
  });

  it('returns an explainable empty state and does not reuse the recognition payload', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/diseases/d-empty/environment')
      .set('x-test-role', 'super_admin');

    expect(response.status).toBe(200);
    expect(response.body.empty).toBe(true);
    expect(response.body.emptyReason).toBe('该时间窗内无环境读数');
    expect(response.body.readings).toEqual([]);
    expect(JSON.stringify(response.body.readings)).not.toContain('22.5');
  });

  it('keeps a shed manager on their own disease and rejects the other shed', async () => {
    const own = await request(app.getHttpServer())
      .get('/api/v1/diseases/d-s01/environment')
      .set('x-test-role', 'shed_manager');
    const other = await request(app.getHttpServer())
      .get('/api/v1/diseases/d-s02/environment')
      .set('x-test-role', 'shed_manager');

    expect(own.status).toBe(200);
    expect(own.body.readings.every((item: { shedCode: string }) => item.shedCode === 'S01')).toBe(
      true,
    );
    expect(own.body.readings.map((item: { id: string }) => item.id)).not.toContain(
      'other-shed',
    );
    expect(other.status).toBe(403);
  });

  it('returns 404 when the disease id does not exist', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/diseases/missing/environment')
      .set('x-test-role', 'viewer')
      .set('x-test-sheds', 'S01');

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('病害记录不存在');
  });
});
