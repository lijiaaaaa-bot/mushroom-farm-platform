import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  shanghaiDayRange,
  shiftShanghaiDate,
  todayShanghai,
  Role,
} from '@mushroom/contracts';
import { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { AuditService } from '../audit';
import { AuthUser } from '../common/auth-user';
import { RolesGuard } from '../common/guards';
import { configureApp } from '../configure-app';
import { AuditLog } from '../entities/audit-log.entity';
import { HarvestTask } from '../entities/harvest-task.entity';
import { MetricBucketDay } from '../entities/metric-bucket.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import { METRIC_MATURE_COUNT } from '../growth';
import { HarvestController } from './harvest.controller';
import { HarvestService } from './harvest.service';

function memoryRecords() {
  const rows: RecognitionRecord[] = [];
  return {
    rows,
    query: async (_sql: string, params: unknown[]) => {
      const start = new Date(params[0] as string | Date).getTime();
      const end = new Date(params[1] as string | Date).getTime();
      const shedCodes = params[2] as string[] | null;
      const inRange = rows.filter((row) => {
        const at = new Date(row.recognizedAt).getTime();
        if (at < start || at >= end) return false;
        return !shedCodes || shedCodes.includes(row.shedCode);
      });
      const latest = new Map<string, RecognitionRecord>();
      for (const row of [...inRange].sort(
        (a, b) =>
          new Date(b.recognizedAt).getTime() - new Date(a.recognizedAt).getTime(),
      )) {
        if (!latest.has(row.cameraCode)) latest.set(row.cameraCode, row);
      }
      return [...latest.values()].map((row) => ({
        id: row.id,
        shedCode: row.shedCode,
        cameraCode: row.cameraCode,
        recognizedAt: row.recognizedAt,
        mushroomCount: row.mushroomCount,
        matureCount: row.matureCount,
        avgCapDiameter: row.avgCapDiameter,
        diseaseCount: row.diseaseCount,
        diseaseLevel: row.diseaseLevel,
      }));
    },
  };
}

function memoryTasks() {
  const rows: HarvestTask[] = [];
  return {
    rows,
    find: async (options?: { where?: Partial<HarvestTask> }) => {
      const where = options?.where;
      if (!where) return [...rows];
      return rows.filter((row) =>
        Object.entries(where).every(
          ([key, value]) => row[key as keyof HarvestTask] === value,
        ),
      );
    },
    findOne: async (options: { where: Partial<HarvestTask> }) => {
      const found = await memoryTasksFind(rows, options.where);
      return found ?? null;
    },
    create: (input: HarvestTask) => input,
    save: async (input: HarvestTask) => {
      const index = rows.findIndex((row) => row.id === input.id);
      if (index >= 0) rows[index] = input;
      else rows.push(input);
      return input;
    },
    delete: async (criteria: { id: string }) => {
      const index = rows.findIndex((row) => row.id === criteria.id);
      if (index >= 0) rows.splice(index, 1);
    },
  };
}

function memoryTasksFind(rows: HarvestTask[], where: Partial<HarvestTask>) {
  return (
    rows.find((row) =>
      Object.entries(where).every(
        ([key, value]) => row[key as keyof HarvestTask] === value,
      ),
    ) ?? null
  );
}

function memoryLogs() {
  const rows: AuditLog[] = [];
  return {
    rows,
    create: (input: Partial<AuditLog>) => ({ ...input }),
    save: async (input: Partial<AuditLog>) => {
      rows.push({
        ...input,
        id: input.id ?? `audit-${rows.length + 1}`,
        createdAt: input.createdAt ?? new Date(),
      } as AuditLog);
      return rows[rows.length - 1];
    },
  };
}

function sample(
  partial: Partial<RecognitionRecord> &
    Pick<RecognitionRecord, 'id' | 'shedCode' | 'cameraCode'>,
): RecognitionRecord {
  return {
    idempotencyKey: partial.id,
    recognizedAt: shanghaiDayRange(todayShanghai()).start,
    mushroomCount: 10,
    matureCount: 4,
    capDiameters: [],
    avgCapDiameter: null,
    diseaseCount: 0,
    diseaseLevel: 0,
    snapshotObjectKey: null,
    snapshotUrl: null,
    temperature: null,
    humidity: null,
    co2: null,
    substrateMoisture: null,
    source: 'http',
    rawPayload: {},
    createdAt: new Date(),
    ...partial,
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

describe('harvest tasks and bucket forecast HTTP', () => {
  let app: INestApplication;
  const records = memoryRecords();
  const tasks = memoryTasks();
  const logs = memoryLogs();
  const buckets: MetricBucketDay[] = [];

  beforeEach(async () => {
    records.rows.splice(0, records.rows.length);
    tasks.rows.splice(0, tasks.rows.length);
    logs.rows.splice(0, logs.rows.length);
    buckets.splice(0, buckets.length);
    const moduleRef = await Test.createTestingModule({
      controllers: [HarvestController],
      providers: [
        HarvestService,
        AuditService,
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: getRepositoryToken(RecognitionRecord), useValue: records },
        { provide: getRepositoryToken(HarvestTask), useValue: tasks },
        { provide: getRepositoryToken(AuditLog), useValue: logs },
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

  it('builds a per-shed pick list and keeps a shift when regenerated', async () => {
    const day = todayShanghai();
    records.rows.push(
      sample({
        id: 'cam-a',
        shedCode: 'S01',
        cameraCode: 'CAM-A',
        matureCount: 6,
        mushroomCount: 12,
      }),
      sample({
        id: 'cam-b',
        shedCode: 'S01',
        cameraCode: 'CAM-B',
        matureCount: 0,
        mushroomCount: 4,
      }),
      sample({
        id: 'cam-c',
        shedCode: 'S02',
        cameraCode: 'CAM-C',
        matureCount: 3,
        mushroomCount: 5,
      }),
    );

    const generated = await request(app.getHttpServer())
      .post('/api/v1/harvest/tasks/generate')
      .query({ date: day })
      .set('x-test-role', 'production_admin');
    expect(generated.status).toBe(201);
    expect(generated.body.items).toHaveLength(2);
    expect(generated.body.sheds).toEqual([
      expect.objectContaining({ shedCode: 'S01', matureCount: 6, cameraCount: 1 }),
      expect.objectContaining({ shedCode: 'S02', matureCount: 3, cameraCount: 1 }),
    ]);
    const task = generated.body.items.find(
      (item: { cameraCode: string }) => item.cameraCode === 'CAM-A',
    );

    const scheduled = await request(app.getHttpServer())
      .patch(`/api/v1/harvest/tasks/${task.id}`)
      .set('x-test-role', 'production_admin')
      .send({ assignee: '甲班', shift: 'morning' });
    expect(scheduled.status).toBe(200);
    expect(scheduled.body).toMatchObject({
      assignee: '甲班',
      shift: 'morning',
      status: 'scheduled',
    });

    records.rows[0].matureCount = 9;
    const again = await request(app.getHttpServer())
      .post('/api/v1/harvest/tasks/generate')
      .query({ date: day })
      .set('x-test-role', 'production_admin');
    const kept = again.body.items.find(
      (item: { cameraCode: string }) => item.cameraCode === 'CAM-A',
    );
    expect(kept).toMatchObject({
      matureCount: 9,
      assignee: '甲班',
      shift: 'morning',
      status: 'scheduled',
    });
    expect(again.body.schedule).toMatchObject({ morning: 1 });

    const scoped = await request(app.getHttpServer())
      .get('/api/v1/harvest/tasks')
      .query({ date: day })
      .set('x-test-role', 'shed_manager');
    expect(scoped.body.items.map((item: { shedCode: string }) => item.shedCode)).toEqual([
      'S01',
    ]);
  });

  it('rejects a viewer generate and forecasts from mature day buckets', async () => {
    const denied = await request(app.getHttpServer())
      .post('/api/v1/harvest/tasks/generate')
      .set('x-test-role', 'viewer');
    expect(denied.status).toBe(403);

    const today = todayShanghai();
    const earlier = shiftShanghaiDate(today, -3);
    buckets.push(
      dayBucket('S01', earlier, 10),
      dayBucket('S01', today, 16),
      dayBucket('S02', today, 100),
    );
    const forecast = await request(app.getHttpServer())
      .get('/api/v1/harvest/bucket-forecast')
      .query({ shedCode: 'S01' })
      .set('x-test-role', 'shed_manager');
    expect(forecast.status).toBe(200);
    expect(forecast.body.label).toBe('估计');
    expect(forecast.body.sufficient).toBe(true);
    expect(forecast.body.speedPerDay).toBe(2);
    expect(forecast.body.days.map((day: { matureCount: number }) => day.matureCount)).toEqual([
      18, 20, 22,
    ]);

    const other = await request(app.getHttpServer())
      .get('/api/v1/harvest/bucket-forecast')
      .query({ shedCode: 'S02' })
      .set('x-test-role', 'shed_manager');
    expect(other.status).toBe(403);
  });
});

function dayBucket(shedCode: string, day: string, value: number): MetricBucketDay {
  return {
    id: `${shedCode}-${day}`,
    shedCode,
    cameraCode: '',
    bucketStart: shanghaiDayRange(day).start,
    metric: METRIC_MATURE_COUNT,
    value,
    sampleCount: value,
    valueSum: value,
    latestAt: shanghaiDayRange(day).start,
    updatedAt: shanghaiDayRange(day).start,
  };
}
