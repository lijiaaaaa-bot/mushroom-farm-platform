import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { shanghaiDayRange, Role } from '@mushroom/contracts';
import { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { RolesGuard } from '../common/guards';
import { configureApp } from '../configure-app';
import { AuthUser } from '../common/auth-user';
import {
  FlushBatch,
  FlushPhaseEvent,
} from '../entities/flush-batch.entity';
import { MetricBucketDay } from '../entities/metric-bucket.entity';
import { METRIC_MATURE_COUNT, METRIC_MUSHROOM_COUNT } from '../growth';
import { BatchController } from './batch.controller';
import { BatchService } from './batch.service';

function memoryRows<T extends { id: string }>() {
  const rows: T[] = [];
  const api = {
    rows,
    create: (input: T) => input,
    save: async (input: T) => {
      const index = rows.findIndex((row) => row.id === input.id);
      if (index >= 0) rows[index] = input;
      else rows.push(input);
      return input;
    },
    find: async (options?: { where?: Partial<T> }) => {
      const where = options?.where;
      if (!where) return rows;
      return rows.filter((row) =>
        Object.entries(where).every(
          ([key, value]) => row[key as keyof T] === value,
        ),
      );
    },
    findOne: async (options: { where: Partial<T> }) => {
      const found = await api.find(options);
      return found[0] ?? null;
    },
  };
  return api;
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
    req.user = {
      id: `id-${role}`,
      username: role,
      displayName: role,
      role: role as Role,
      shedCodes: ['S01'],
    };
  }
  next();
}

describe('flush batch HTTP', () => {
  let app: INestApplication;
  const batches = memoryRows<FlushBatch>();
  const events = memoryRows<FlushPhaseEvent>();
  const buckets: MetricBucketDay[] = [];

  beforeEach(async () => {
    batches.rows.splice(0, batches.rows.length);
    events.rows.splice(0, events.rows.length);
    buckets.splice(0, buckets.length);
    const moduleRef = await Test.createTestingModule({
      controllers: [BatchController],
      providers: [
        BatchService,
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: getRepositoryToken(FlushBatch), useValue: batches },
        { provide: getRepositoryToken(FlushPhaseEvent), useValue: events },
        {
          provide: getRepositoryToken(MetricBucketDay),
          useValue: {
            createQueryBuilder: () => {
              const qb = {
                where: () => qb,
                andWhere: () => qb,
                getMany: async () => buckets,
              };
              return qb;
            },
          },
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

  it('records flush, fast growth and mature phases and replays the bucket curve', async () => {
    buckets.push(
      bucket('S01', '2026-09-03', METRIC_MUSHROOM_COUNT, 40),
      bucket('S01', '2026-09-03', METRIC_MATURE_COUNT, 8),
      bucket('S01', 'cam-1', '2026-09-03', METRIC_MUSHROOM_COUNT, 99),
      bucket('S02', '2026-09-03', METRIC_MUSHROOM_COUNT, 7),
    );

    const created = await request(app.getHttpServer())
      .post('/api/v1/batches')
      .set('x-test-role', 'production_admin')
      .send({
        shedCode: 'S01',
        batchCode: 'B-0901',
        startedAt: '2026-09-01',
        note: '第一潮',
      });
    expect(created.status).toBe(201);
    expect(created.body.batch).toMatchObject({
      shedCode: 'S01',
      batchCode: 'B-0901',
      phase: 'flush',
    });
    const id = created.body.batch.id as string;

    const fast = await request(app.getHttpServer())
      .post(`/api/v1/batches/${id}/phases`)
      .set('x-test-role', 'production_admin')
      .send({ phase: 'fast_growth', occurredAt: '2026-09-05T00:00:00+08:00' });
    expect(fast.status).toBe(201);

    const mature = await request(app.getHttpServer())
      .post(`/api/v1/batches/${id}/phases`)
      .set('x-test-role', 'shed_manager')
      .send({ phase: 'mature', occurredAt: '2026-09-12T00:00:00+08:00' });
    expect(mature.status).toBe(201);

    const replay = await request(app.getHttpServer())
      .get(`/api/v1/batches/${id}/replay`)
      .set('x-test-role', 'viewer');
    expect(replay.status).toBe(200);
    expect(replay.body.phases.map((phase: { phase: string }) => phase.phase)).toEqual([
      'flush',
      'fast_growth',
      'mature',
    ]);
    expect(replay.body.curve).toEqual([
      expect.objectContaining({
        day: '2026-09-03',
        mushroomCount: 40,
        matureCount: 8,
      }),
    ]);
  });

  it('hides another shed from a shed manager and rejects a viewer write', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/batches')
      .set('x-test-role', 'super_admin')
      .send({ shedCode: 'S02', batchCode: 'B-S02', startedAt: '2026-09-01' });
    expect(created.status).toBe(201);
    const id = created.body.batch.id as string;

    const hidden = await request(app.getHttpServer())
      .get(`/api/v1/batches/${id}/replay`)
      .set('x-test-role', 'shed_manager');
    expect(hidden.status).toBe(403);

    const listed = await request(app.getHttpServer())
      .get('/api/v1/batches')
      .set('x-test-role', 'shed_manager');
    expect(listed.status).toBe(200);
    expect(listed.body.items).toEqual([]);

    const denied = await request(app.getHttpServer())
      .post('/api/v1/batches')
      .set('x-test-role', 'viewer')
      .send({ shedCode: 'S01', batchCode: 'B-V', startedAt: '2026-09-02' });
    expect(denied.status).toBe(403);
  });
});

function bucket(
  shedCode: string,
  dayOrCamera: string,
  metricOrDay: string,
  valueOrMetric: number | string,
  maybeValue?: number,
): MetricBucketDay {
  const cameraCode = maybeValue === undefined ? '' : dayOrCamera;
  const day = maybeValue === undefined ? dayOrCamera : metricOrDay;
  const metric = maybeValue === undefined ? metricOrDay : String(valueOrMetric);
  const value = maybeValue === undefined ? Number(valueOrMetric) : maybeValue;
  return {
    id: `${shedCode}-${cameraCode}-${day}-${metric}`,
    shedCode,
    cameraCode,
    bucketStart: shanghaiDayRange(day).start,
    metric,
    value,
    sampleCount: 1,
    valueSum: value,
    latestAt: shanghaiDayRange(day).start,
    updatedAt: shanghaiDayRange(day).start,
  };
}
