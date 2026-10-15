import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  Role,
  shanghaiDate,
  shanghaiDayRange,
  shanghaiHourStart,
  todayShanghai,
} from '@mushroom/contracts';
import { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { AuthUser } from '../common/auth-user';
import { configureApp } from '../configure-app';
import {
  MetricBucketBase,
  MetricBucketDay,
  MetricBucketHour,
} from '../entities/metric-bucket.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import { HarvestService } from '../harvest';
import {
  AggregateSource,
  maturityPercent,
  rollupGrowthPoints,
  shiftShanghaiDay,
  trendPeriodKey,
} from './growth-trend.aggregate';
import {
  foldBuckets,
  METRIC_CAP_DIAMETER_MEAN,
  METRIC_DISEASE_COUNT,
  METRIC_ENV_HUMIDITY,
  METRIC_ENV_TEMPERATURE,
  METRIC_MATURE_COUNT,
  METRIC_MUSHROOM_COUNT,
  METRIC_SAMPLE_COUNT,
} from './metric-bucket.apply';
import { DiseasesController } from '../diseases/diseases.controller';
import { IngestService } from '../ingest';
import { GrowthTrendsController } from './growth-trend.controller';
import { GrowthTrendService } from './growth-trend.service';

function memoryRecords(initial: AggregateSource[]) {
  const rows = initial.map((row) => ({
    ...row,
    recognizedAt: new Date(row.recognizedAt),
  }));
  return {
    rows,
    createQueryBuilder() {
      let start = new Date(0);
      let end = new Date(0);
      const qb = {
        where(_sql: string, params: { start: Date; end: Date }) {
          start = new Date(params.start);
          end = new Date(params.end);
          return qb;
        },
        async getMany() {
          return rows.filter((row) => {
            const at = new Date(row.recognizedAt).getTime();
            return at >= start.getTime() && at < end.getTime();
          });
        },
      };
      return qb;
    },
  };
}

function memoryMetricBuckets() {
  const rows: MetricBucketBase[] = [];
  let seq = 0;
  const copy = (row: MetricBucketBase): MetricBucketBase => ({
    ...row,
    bucketStart: new Date(row.bucketStart),
    latestAt: row.latestAt ? new Date(row.latestAt) : null,
    updatedAt: new Date(row.updatedAt),
  });
  return {
    rows,
    create: (input: Partial<MetricBucketBase>) =>
      ({ ...input }) as MetricBucketBase,
    find: async (options?: {
      where?: { shedCode?: string; bucketStart?: Date };
    }) => {
      const where = options?.where;
      return rows
        .filter((row) => {
          if (where?.shedCode && row.shedCode !== where.shedCode) return false;
          if (
            where?.bucketStart &&
            new Date(row.bucketStart).getTime() !==
              new Date(where.bucketStart).getTime()
          ) {
            return false;
          }
          return true;
        })
        .map(copy);
    },
    save: async (input: MetricBucketBase) => {
      const saved = {
        ...input,
        id: input.id ?? `bucket-${++seq}`,
        updatedAt: input.updatedAt ?? new Date(),
      };
      const index = rows.findIndex((row) => row.id === saved.id);
      if (index >= 0) rows[index] = saved;
      else rows.push(saved);
      return copy(saved);
    },
    delete: async (criteria: { id: string }) => {
      const index = rows.findIndex((row) => row.id === criteria.id);
      if (index >= 0) rows.splice(index, 1);
      return { affected: index >= 0 ? 1 : 0 };
    },
    createQueryBuilder() {
      let start = new Date(0);
      let end = new Date(0);
      const extra: Array<(row: MetricBucketBase) => boolean> = [];
      const qb = {
        where(_sql: string, params: { start: Date; end: Date }) {
          start = new Date(params.start);
          end = new Date(params.end);
          return qb;
        },
        andWhere(
          _sql: string,
          params?: { metrics?: string[]; codes?: string[]; shedCode?: string },
        ) {
          if (params?.metrics) {
            const metrics = params.metrics;
            extra.push((row) => metrics.includes(row.metric));
          }
          if (params?.codes) {
            const codes = params.codes;
            extra.push((row) => codes.includes(row.shedCode));
          }
          if (params?.shedCode) {
            extra.push((row) => row.shedCode === params.shedCode);
          }
          return qb;
        },
        async getMany() {
          return rows
            .filter((row) => {
              const at = new Date(row.bucketStart).getTime();
              return at >= start.getTime() && at < end.getTime();
            })
            .filter((row) => extra.every((fn) => fn(row)))
            .map(copy);
        },
      };
      return qb;
    },
  };
}

function bucketValue(
  rows: Array<{ metric: string; cameraCode: string; value: number | null }>,
  metric: string,
  cameraCode: string,
) {
  return rows.find(
    (row) => row.metric === metric && row.cameraCode === cameraCode,
  );
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

describe('day bucket rollup', () => {
  it('keeps the latest mushroom count and the mean cap diameter', () => {
    const day = '2026-09-23';
    const sources: AggregateSource[] = [
      {
        id: 'a',
        shedCode: 'S01',
        cameraCode: 'CAM-1',
        recognizedAt: '2026-09-23T01:00:00.000Z',
        mushroomCount: 10,
        avgCapDiameter: 4,
      },
      {
        id: 'b',
        shedCode: 'S01',
        cameraCode: 'CAM-1',
        recognizedAt: '2026-09-23T05:00:00.000Z',
        mushroomCount: 12,
        avgCapDiameter: 6,
      },
      {
        id: 'c',
        shedCode: 'S01',
        cameraCode: 'CAM-2',
        recognizedAt: '2026-09-23T03:00:00.000Z',
        mushroomCount: 8,
        avgCapDiameter: 4,
      },
      {
        id: 'old',
        shedCode: 'S01',
        cameraCode: 'CAM-1',
        recognizedAt: '2026-09-22T01:00:00.000Z',
        mushroomCount: 99,
        avgCapDiameter: 9,
      },
      {
        id: 'd',
        shedCode: 'S01',
        cameraCode: 'CAM-3',
        recognizedAt: '2026-09-23T02:00:00.000Z',
        mushroomCount: 3,
        avgCapDiameter: null,
      },
    ];
    const rows = foldBuckets(
      sources.filter(
        (record) => shanghaiDate(new Date(record.recognizedAt)) === day,
      ),
      shanghaiDayRange(day).start,
    );

    expect(bucketValue(rows, METRIC_MUSHROOM_COUNT, '')?.value).toBe(23);
    expect(bucketValue(rows, METRIC_CAP_DIAMETER_MEAN, '')?.value).toBe(4.67);
    expect(bucketValue(rows, METRIC_SAMPLE_COUNT, '')?.value).toBe(4);
    expect(bucketValue(rows, METRIC_MUSHROOM_COUNT, 'CAM-1')?.value).toBe(12);
    expect(bucketValue(rows, METRIC_CAP_DIAMETER_MEAN, 'CAM-1')?.value).toBe(5);
    expect(bucketValue(rows, METRIC_SAMPLE_COUNT, 'CAM-1')?.value).toBe(2);
    expect(bucketValue(rows, METRIC_MUSHROOM_COUNT, 'CAM-3')?.value).toBe(3);
    expect(
      bucketValue(rows, METRIC_CAP_DIAMETER_MEAN, 'CAM-3'),
    ).toBeUndefined();
    expect(rows.some((row) => row.value === 99)).toBe(false);
  });

  it('returns no rows when the day has no recognitions', () => {
    expect(foldBuckets([], shanghaiDayRange('2026-09-23').start)).toEqual([]);
  });

  it('rewrites the day and drops cameras that no longer reported', async () => {
    const records = memoryRecords([
      {
        id: 'a',
        shedCode: 'S01',
        cameraCode: 'CAM-1',
        recognizedAt: '2026-09-23T01:00:00.000Z',
        mushroomCount: 10,
        avgCapDiameter: 4,
      },
      {
        id: 'b',
        shedCode: 'S01',
        cameraCode: 'CAM-2',
        recognizedAt: '2026-09-23T02:00:00.000Z',
        mushroomCount: 8,
        avgCapDiameter: 5,
      },
    ]);
    const hours = memoryMetricBuckets();
    const days = memoryMetricBuckets();
    const service = new GrowthTrendService(
      records as never,
      hours as never,
      days as never,
    );
    await service.refreshDay('2026-09-23');
    expect(bucketValue(days.rows, METRIC_MUSHROOM_COUNT, '')?.value).toBe(18);
    expect(bucketValue(days.rows, METRIC_MUSHROOM_COUNT, 'CAM-2')?.value).toBe(
      8,
    );
    expect(bucketValue(hours.rows, METRIC_MUSHROOM_COUNT, 'CAM-2')?.value).toBe(
      8,
    );

    records.rows.splice(1, 1);
    records.rows[0].mushroomCount = 15;
    await service.refreshDay('2026-09-23');
    expect(
      bucketValue(days.rows, METRIC_MUSHROOM_COUNT, 'CAM-2'),
    ).toBeUndefined();
    expect(bucketValue(days.rows, METRIC_MUSHROOM_COUNT, '')?.value).toBe(15);
    expect(
      bucketValue(hours.rows, METRIC_MUSHROOM_COUNT, 'CAM-2'),
    ).toBeUndefined();
    expect(bucketValue(days.rows, METRIC_MUSHROOM_COUNT, 'CAM-1')?.value).toBe(
      15,
    );
  });

  it('upserts hour and day buckets for recognizedAt and ignores the arrival day', async () => {
    const records = memoryRecords([]);
    const hours = memoryMetricBuckets();
    const days = memoryMetricBuckets();
    const service = new GrowthTrendService(
      records as never,
      hours as never,
      days as never,
    );
    const scan = jest.spyOn(records, 'createQueryBuilder');
    const backfill = {
      shedCode: 'S01',
      cameraCode: 'CAM-1',
      recognizedAt: new Date('2026-09-20T03:15:00.000Z'),
      mushroomCount: 7,
      avgCapDiameter: 4,
    };
    await service.applyRecognition(backfill);
    await service.applyRecognition({
      ...backfill,
      recognizedAt: new Date('2026-09-20T03:40:00.000Z'),
      mushroomCount: 9,
      avgCapDiameter: 6,
    });
    await service.applyRecognition({
      ...backfill,
      recognizedAt: new Date('2026-09-20T03:05:00.000Z'),
      mushroomCount: 3,
      avgCapDiameter: 5,
    });
    await service.applyRecognition({
      shedCode: 'S01',
      cameraCode: 'CAM-2',
      recognizedAt: new Date('2026-09-20T05:10:00.000Z'),
      mushroomCount: 4,
      avgCapDiameter: 8,
    });

    expect(scan).not.toHaveBeenCalled();
    const hourStart = new Date('2026-09-20T03:00:00.000Z').getTime();
    const laterHour = new Date('2026-09-20T05:00:00.000Z').getTime();
    const dayStart = new Date('2026-09-20T00:00:00+08:00').getTime();
    const cam1Hour = hours.rows.filter(
      (row) =>
        row.cameraCode === 'CAM-1' &&
        new Date(row.bucketStart).getTime() === hourStart,
    );
    expect(bucketValue(cam1Hour, METRIC_MUSHROOM_COUNT, 'CAM-1')).toMatchObject(
      { value: 9, latestAt: new Date('2026-09-20T03:40:00.000Z') },
    );
    expect(bucketValue(cam1Hour, METRIC_SAMPLE_COUNT, 'CAM-1')?.value).toBe(3);
    expect(
      bucketValue(cam1Hour, METRIC_CAP_DIAMETER_MEAN, 'CAM-1')?.value,
    ).toBe(5);
    expect(
      hours.rows.find(
        (row) =>
          row.cameraCode === 'CAM-2' &&
          row.metric === METRIC_MUSHROOM_COUNT &&
          new Date(row.bucketStart).getTime() === laterHour,
      )?.value,
    ).toBe(4);
    expect(bucketValue(days.rows, METRIC_MUSHROOM_COUNT, '')?.value).toBe(13);
    expect(bucketValue(days.rows, METRIC_SAMPLE_COUNT, '')?.value).toBe(4);
    expect(bucketValue(days.rows, METRIC_CAP_DIAMETER_MEAN, '')?.value).toBe(
      5.75,
    );
    expect(
      days.rows.every(
        (row) => new Date(row.bucketStart).getTime() === dayStart,
      ),
    ).toBe(true);
    expect(bucketValue(days.rows, METRIC_MUSHROOM_COUNT, 'CAM-1')?.value).toBe(
      9,
    );
    expect(bucketValue(days.rows, METRIC_SAMPLE_COUNT, 'CAM-1')?.value).toBe(3);
    expect(
      bucketValue(days.rows, METRIC_CAP_DIAMETER_MEAN, 'CAM-1')?.value,
    ).toBe(5);
  });
});

function seedGrowth(
  repo: { rows: MetricBucketBase[] },
  day: string,
  shedCode: string,
  cameraCode: string,
  mushroom: number,
  diameter: number | null = 4,
) {
  const bucketStart = shanghaiDayRange(day).start;
  const add = (metric: string, value: number | null) => {
    repo.rows.push({
      id: `${shedCode}|${cameraCode}|${day}|${metric}`,
      shedCode,
      cameraCode,
      bucketStart,
      metric,
      value,
      sampleCount: 1,
      valueSum: value,
      latestAt: null,
      updatedAt: new Date(),
    });
  };
  add(METRIC_MUSHROOM_COUNT, mushroom);
  add(METRIC_CAP_DIAMETER_MEAN, diameter);
  add(METRIC_SAMPLE_COUNT, 1);
}

describe('growth trend API', () => {
  let app: INestApplication;
  let recordScans: jest.SpyInstance;
  const today = todayShanghai();
  const recent = shiftShanghaiDay(today, -1);
  const within30 = shiftShanghaiDay(today, -20);
  const outside = shiftShanghaiDay(today, -40);

  beforeEach(async () => {
    const records = memoryRecords([]);
    recordScans = jest.spyOn(records, 'createQueryBuilder');
    const days = memoryMetricBuckets();
    seedGrowth(days, today, 'S01', '', 20, 5);
    seedGrowth(days, today, 'S01', 'CAM-1', 12, 5);
    seedGrowth(days, today, 'S01', 'CAM-2', 8, 4);
    seedGrowth(days, recent, 'S01', '', 9);
    seedGrowth(days, within30, 'S01', '', 4);
    seedGrowth(days, outside, 'S01', '', 1);
    seedGrowth(days, today, 'S02', '', 50);
    seedGrowth(days, today, 'S02', 'CAM-9', 50);
    seedMetric(
      days,
      shanghaiDayRange(today).start,
      'S01',
      'CAM-1',
      METRIC_MATURE_COUNT,
      5,
    );
    seedMetric(
      days,
      shanghaiDayRange(today).start,
      'S01',
      '',
      METRIC_MATURE_COUNT,
      7,
    );
    const moduleRef = await Test.createTestingModule({
      controllers: [GrowthTrendsController],
      providers: [
        GrowthTrendService,
        {
          provide: getRepositoryToken(RecognitionRecord),
          useValue: records,
        },
        {
          provide: getRepositoryToken(MetricBucketHour),
          useValue: memoryMetricBuckets(),
        },
        {
          provide: getRepositoryToken(MetricBucketDay),
          useValue: days,
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

  it('returns only stored days inside the 7-day window', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/growth-trends')
      .set('x-test-role', 'super_admin');

    expect(response.status).toBe(200);
    expect(response.body.days).toBe(7);
    expect(recordScans).not.toHaveBeenCalled();
    const s01 = response.body.sheds.find(
      (shed: { shedCode: string }) => shed.shedCode === 'S01',
    );
    expect(s01.points.map((row: { day: string }) => row.day)).toEqual([
      recent,
      today,
    ]);
    expect(s01.points).toHaveLength(2);
    expect(
      s01.cameras.map((row: { cameraCode: string }) => row.cameraCode),
    ).toEqual(['CAM-1', 'CAM-2']);
    expect(
      s01.points.find((row: { day: string }) => row.day === today),
    ).toEqual(
      expect.objectContaining({
        mushroomCount: 20,
        matureCount: 7,
        maturityRate: 35,
      }),
    );
    expect(
      s01.points.find((row: { day: string }) => row.day === recent),
    ).toEqual(
      expect.objectContaining({
        mushroomCount: 9,
        matureCount: 0,
        maturityRate: 0,
      }),
    );
    expect(
      s01.cameras.find(
        (row: { cameraCode: string }) => row.cameraCode === 'CAM-1',
      ).points[0],
    ).toEqual(
      expect.objectContaining({
        mushroomCount: 12,
        matureCount: 5,
        maturityRate: 41.7,
      }),
    );
  });

  it('returns two sheds with different mushroom counts when shedCode is omitted', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/growth-trends')
      .set('x-test-role', 'super_admin');

    expect(response.status).toBe(200);
    const todayCount = (code: string) => {
      const shed = response.body.sheds.find(
        (item: { shedCode: string }) => item.shedCode === code,
      );
      return shed?.points.find((point: { day: string }) => point.day === today)
        ?.mushroomCount;
    };
    expect(todayCount('S01')).toBe(20);
    expect(todayCount('S02')).toBe(50);
    expect(todayCount('S01')).not.toBe(todayCount('S02'));
  });

  it('includes a 20-day-old point in the 30-day window and omits older days', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/growth-trends?days=30&shedCode=S01')
      .set('x-test-role', 'super_admin');

    expect(response.status).toBe(200);
    expect(response.body.days).toBe(30);
    expect(response.body.sheds).toHaveLength(1);
    const days = response.body.sheds[0].points.map(
      (row: { day: string }) => row.day,
    );
    expect(days).toContain(within30);
    expect(days).not.toContain(outside);
    expect(days).toHaveLength(3);
  });

  it('rejects a window other than 7 or 30', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/growth-trends?days=14')
      .set('x-test-role', 'super_admin');
    expect(response.status).toBe(400);
  });

  it.each(['shed_manager', 'viewer'] as const)(
    '%s sees only authorized sheds and cannot query another shed',
    async (role) => {
      const listed = await request(app.getHttpServer())
        .get('/api/v1/growth-trends')
        .set('x-test-role', role);
      expect(listed.status).toBe(200);
      expect(
        listed.body.sheds.map((row: { shedCode: string }) => row.shedCode),
      ).toEqual(['S01']);

      const denied = await request(app.getHttpServer())
        .get('/api/v1/growth-trends?shedCode=S02')
        .set('x-test-role', role);
      expect(denied.status).toBe(403);
    },
  );

  it('filters one camera without dropping that shed rollup', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/growth-trends?shedCode=S01&cameraCode=CAM-1')
      .set('x-test-role', 'production_admin');
    expect(response.status).toBe(200);
    expect(response.body.sheds[0].cameras).toEqual([
      expect.objectContaining({
        cameraCode: 'CAM-1',
        points: [expect.objectContaining({ mushroomCount: 12 })],
      }),
    ]);
    expect(response.body.sheds[0].points).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ day: today, mushroomCount: 20 }),
      ]),
    );
  });

  it('rejects a grain other than day, week, or month', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/growth-trends?grain=hour')
      .set('x-test-role', 'super_admin');
    expect(response.status).toBe(400);
  });

  it('returns an empty shed list when the window has no aggregates', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/growth-trends?days=7&shedCode=S01&cameraCode=MISSING')
      .set('x-test-role', 'super_admin');
    expect(response.status).toBe(200);
    expect(response.body.sheds).toEqual([]);
    expect(response.body.from).toBe(shiftShanghaiDay(today, -6));
    expect(response.body.to).toBe(today);
  });
});

describe('week and month grain', () => {
  it('turns mature and mushroom counts into a percent, or nothing when mushrooms are zero', () => {
    expect(maturityPercent(20, 2)).toBe(10);
    expect(maturityPercent(20, 6)).toBe(30);
    expect(maturityPercent(20, 10)).toBe(50);
    expect(maturityPercent(14, 5)).toBe(35.7);
    expect(maturityPercent(21, 8)).toBe(38.1);
    expect(maturityPercent(9, 0)).toBe(0);
    expect(maturityPercent(0, 0)).toBeNull();
    expect(maturityPercent(0, 4)).toBeNull();
  });

  it('keeps the last day in a period and sums samples', () => {
    const points = [
      {
        day: '2026-09-21',
        mushroomCount: 8,
        matureCount: 2,
        capDiameterMean: 4,
        sampleCount: 1,
      },
      {
        day: '2026-09-23',
        mushroomCount: 14,
        matureCount: 5,
        capDiameterMean: 6,
        sampleCount: 1,
      },
      {
        day: '2026-09-28',
        mushroomCount: 8,
        matureCount: 2,
        capDiameterMean: 4,
        sampleCount: 1,
      },
      {
        day: '2026-09-30',
        mushroomCount: 14,
        matureCount: 5,
        capDiameterMean: 6,
        sampleCount: 1,
      },
      {
        day: '2026-10-05',
        mushroomCount: 8,
        matureCount: 2,
        capDiameterMean: 4,
        sampleCount: 1,
      },
      {
        day: '2026-10-07',
        mushroomCount: 21,
        matureCount: 8,
        capDiameterMean: 6,
        sampleCount: 1,
      },
    ];
    const week = rollupGrowthPoints(points, 'week');
    const month = rollupGrowthPoints(points, 'month');
    expect(week.map((point) => point.day)).toEqual([
      '2026-09-21',
      '2026-09-28',
      '2026-10-05',
    ]);
    expect(week.map((point) => point.mushroomCount)).toEqual([14, 14, 21]);
    expect(week.map((point) => point.matureCount)).toEqual([5, 5, 8]);
    expect(week.map((point) => point.sampleCount)).toEqual([2, 2, 2]);
    expect(week.map((point) => point.capDiameterMean)).toEqual([5, 5, 5]);
    expect(month.map((point) => point.day)).toEqual(['2026-09', '2026-10']);
    expect(month.map((point) => point.mushroomCount)).toEqual([14, 21]);
    expect(month.map((point) => point.sampleCount)).toEqual([4, 2]);
    expect(points).toHaveLength(6);
    expect(week).toHaveLength(3);
    expect(month.length).toBeLessThan(week.length);
  });

  it('rolls the 30-day window into fewer week and month points', async () => {
    const records = memoryRecords([]);
    const buckets = memoryMetricBuckets();
    const today = todayShanghai();
    const thisMonday = trendPeriodKey(today, 'week');
    const mondays = [3, 2, 1].map((weeksAgo) =>
      shiftShanghaiDay(thisMonday, -7 * weeksAgo),
    );
    mondays.forEach((monday, index) => {
      const wednesday = shiftShanghaiDay(monday, 2);
      const closing = index === mondays.length - 1 ? 21 : 14;
      const mature = closing === 21 ? 8 : 5;
      for (const [day, mushroom, matureCount] of [
        [monday, 8, 2],
        [wednesday, closing, mature],
      ] as const) {
        seedGrowth(buckets, day, 'S01', '', mushroom, mushroom === 8 ? 4 : 6);
        seedGrowth(
          buckets,
          day,
          'S01',
          'CAM-GG',
          mushroom,
          mushroom === 8 ? 4 : 6,
        );
        seedMetric(
          buckets,
          shanghaiDayRange(day).start,
          'S01',
          '',
          METRIC_MATURE_COUNT,
          matureCount,
        );
        seedMetric(
          buckets,
          shanghaiDayRange(day).start,
          'S01',
          'CAM-GG',
          METRIC_MATURE_COUNT,
          matureCount,
        );
      }
    });
    const moduleRef = await Test.createTestingModule({
      controllers: [GrowthTrendsController],
      providers: [
        GrowthTrendService,
        {
          provide: getRepositoryToken(RecognitionRecord),
          useValue: records,
        },
        {
          provide: getRepositoryToken(MetricBucketHour),
          useValue: memoryMetricBuckets(),
        },
        {
          provide: getRepositoryToken(MetricBucketDay),
          useValue: buckets,
        },
      ],
    }).compile();
    const grainApp = moduleRef.createNestApplication();
    grainApp.use(assignUser);
    configureApp(grainApp);
    await grainApp.init();
    try {
      const load = (grain?: string) => {
        const params = new URLSearchParams({
          days: '30',
          shedCode: 'S01',
          cameraCode: 'CAM-GG',
        });
        if (grain) params.set('grain', grain);
        return request(grainApp.getHttpServer())
          .get(`/api/v1/growth-trends?${params.toString()}`)
          .set('x-test-role', 'super_admin');
      };
      const day = await load();
      const week = await load('week');
      const month = await load('month');
      expect(day.status).toBe(200);
      expect(week.status).toBe(200);
      expect(month.status).toBe(200);
      expect(day.body.grain).toBe('day');
      expect(week.body.grain).toBe('week');
      expect(month.body.grain).toBe('month');
      const pointsOf = (body: {
        sheds: Array<{
          cameras: Array<{
            points: Array<{
              day: string;
              mushroomCount: number;
              sampleCount: number;
            }>;
          }>;
        }>;
      }) => body.sheds[0].cameras[0].points;
      const dayPoints = pointsOf(day.body);
      const weekPoints = pointsOf(week.body);
      const monthPoints = pointsOf(month.body);
      expect(dayPoints).toHaveLength(6);
      expect(weekPoints).toHaveLength(3);
      expect(monthPoints.length).toBeGreaterThan(0);
      expect(monthPoints.length).toBeLessThan(weekPoints.length);
      expect(
        new Set([dayPoints.length, weekPoints.length, monthPoints.length]).size,
      ).toBe(3);
      expect(weekPoints.map((point) => point.day)).toEqual(mondays);
      expect(weekPoints.map((point) => point.mushroomCount)).toEqual([
        14, 14, 21,
      ]);
      expect(
        weekPoints.map(
          (point) => (point as { maturityRate?: number }).maturityRate,
        ),
      ).toEqual([35.7, 35.7, 38.1]);
      expect(weekPoints.every((point) => point.sampleCount === 2)).toBe(true);
      expect(dayPoints.some((point) => point.mushroomCount === 8)).toBe(true);
      expect(weekPoints.some((point) => point.mushroomCount === 8)).toBe(false);
      const wednesdays = mondays.map((monday) => shiftShanghaiDay(monday, 2));
      for (const wednesday of wednesdays) {
        expect(dayPoints.map((point) => point.day)).toContain(wednesday);
        expect(weekPoints.map((point) => point.day)).not.toContain(wednesday);
      }
      expect(
        monthPoints.every((point) => /^\d{4}-\d{2}$/.test(point.day)),
      ).toBe(true);
      expect(monthPoints[monthPoints.length - 1].mushroomCount).toBe(21);
    } finally {
      await grainApp.close();
    }
  });
});

function seedMetric(
  repo: { rows: MetricBucketBase[] },
  bucketStart: Date,
  shedCode: string,
  cameraCode: string,
  metric: string,
  value: number,
) {
  repo.rows.push({
    id: `${shedCode}|${cameraCode}|${bucketStart.toISOString()}|${metric}`,
    shedCode,
    cameraCode,
    bucketStart,
    metric,
    value,
    sampleCount: 1,
    valueSum: value,
    latestAt: bucketStart,
    updatedAt: new Date(),
  });
}

describe('hour buckets and disease peaks', () => {
  const admin: AuthUser = {
    id: 'admin',
    username: 'admin',
    displayName: 'admin',
    role: 'super_admin',
    shedCodes: [],
  };

  it('reads stored hours, leaves gaps empty, and keeps shed scope', async () => {
    const now = new Date('2026-09-24T03:30:00.000Z');
    const current = shanghaiHourStart(now);
    const skipped = new Date(current.getTime() - 3_600_000);
    const earlier = new Date(current.getTime() - 2 * 3_600_000);
    const stale = new Date(current.getTime() - 30 * 3_600_000);
    const hours = memoryMetricBuckets();
    const days = memoryMetricBuckets();
    seedMetric(hours, current, 'S01', '', METRIC_MUSHROOM_COUNT, 6);
    seedMetric(hours, earlier, 'S01', 'CAM-1', METRIC_MUSHROOM_COUNT, 4);
    seedMetric(hours, stale, 'S01', '', METRIC_MUSHROOM_COUNT, 99);
    seedMetric(hours, current, 'S02', '', METRIC_MUSHROOM_COUNT, 50);
    const records = memoryRecords([]);
    const scan = jest.spyOn(records, 'createQueryBuilder');
    const service = new GrowthTrendService(
      records as never,
      hours as never,
      days as never,
    );

    const series = await service.hourlySeries(admin, {}, now);
    expect(scan).not.toHaveBeenCalled();
    expect(series.hours).toBe(24);
    const s01 = series.sheds.find((shed) => shed.shedCode === 'S01');
    expect(s01?.points.map((point) => point.hour)).toEqual([
      current.toISOString(),
    ]);
    expect(s01?.cameras[0].points.map((point) => point.hour)).toEqual([
      earlier.toISOString(),
    ]);
    const labels = [
      ...(s01?.points.map((point) => point.hour) ?? []),
      ...(s01?.cameras.flatMap((camera) =>
        camera.points.map((point) => point.hour),
      ) ?? []),
    ];
    expect(labels).not.toContain(skipped.toISOString());
    expect(labels).not.toContain(stale.toISOString());

    const manager: AuthUser = {
      ...admin,
      role: 'shed_manager',
      shedCodes: ['S01'],
    };
    const scoped = await service.hourlySeries(manager, {}, now);
    expect(scoped.sheds.map((shed) => shed.shedCode)).toEqual(['S01']);
    await expect(
      service.hourlySeries(manager, { shedCode: 'S02' }, now),
    ).rejects.toThrow('无权访问该棚区');
  });

  it('rolls day buckets for the overview trend without scanning recognitions', async () => {
    const now = new Date('2026-09-24T03:30:00.000Z');
    const today = todayShanghai(now);
    const days = memoryMetricBuckets();
    seedGrowth(days, today, 'S01', '', 9, null);
    seedGrowth(days, today, 'S01', 'CAM-1', 9, null);
    seedMetric(
      days,
      shanghaiDayRange(today).start,
      'S01',
      '',
      METRIC_MATURE_COUNT,
      3,
    );
    seedMetric(
      days,
      shanghaiDayRange(today).start,
      'S01',
      'CAM-1',
      METRIC_MATURE_COUNT,
      3,
    );
    seedMetric(
      days,
      shanghaiDayRange(today).start,
      'S01',
      '',
      METRIC_DISEASE_COUNT,
      2,
    );
    const records = memoryRecords([]);
    const scan = jest.spyOn(records, 'createQueryBuilder');
    const service = new GrowthTrendService(
      records as never,
      memoryMetricBuckets() as never,
      days as never,
    );
    const { ShedScope } = await import('../common/shed-scope');
    const rollup = await service.trendFromDayBuckets(
      ShedScope.fromUser(admin),
      now,
    );
    const todayCounts = await service.todaySnapshot(
      ShedScope.fromUser(admin),
      now,
    );
    expect(scan).not.toHaveBeenCalled();
    expect(rollup).toEqual([
      expect.objectContaining({
        day: today,
        mushroom: 9,
        mature: 3,
        disease: 2,
      }),
    ]);
    expect(todayCounts).toEqual({
      mushroomCount: 9,
      matureCount: 3,
      harvestableCameras: 1,
    });
  });

  it('writes environment hour and day means from observedAt and serves disease peaks from buckets', async () => {
    const hours = memoryMetricBuckets();
    const days = memoryMetricBuckets();
    const service = new GrowthTrendService(
      memoryRecords([]) as never,
      hours as never,
      days as never,
    );
    const observedAt = new Date('2026-09-20T03:15:00.000Z');
    await service.applyEnvironment({
      shedCode: 'S01',
      sensorCode: 'SENSOR-1',
      observedAt,
      temperature: 20,
      humidity: 80,
      co2: 600,
      substrateMoisture: 50,
    });
    await service.applyEnvironment({
      shedCode: 'S01',
      sensorCode: 'SENSOR-2',
      observedAt: new Date('2026-09-20T03:40:00.000Z'),
      temperature: 22,
      humidity: null,
      co2: null,
      substrateMoisture: null,
    });
    const hourStart = shanghaiHourStart(observedAt);
    expect(
      bucketValue(
        hours.rows.filter(
          (row) => new Date(row.bucketStart).getTime() === hourStart.getTime(),
        ),
        METRIC_ENV_TEMPERATURE,
        '',
      )?.value,
    ).toBe(21);
    expect(
      days.rows.every(
        (row) =>
          new Date(row.bucketStart).getTime() ===
          shanghaiDayRange('2026-09-20').start.getTime(),
      ),
    ).toBe(true);

    await service.applyRecognition({
      shedCode: 'S01',
      cameraCode: 'CAM-1',
      recognizedAt: observedAt,
      mushroomCount: 5,
      avgCapDiameter: 4,
      matureCount: 2,
      diseaseCount: 3,
    });
    await service.applyRecognition({
      shedCode: 'S02',
      cameraCode: 'CAM-9',
      recognizedAt: new Date('2026-09-20T05:10:00.000Z'),
      mushroomCount: 1,
      avgCapDiameter: null,
      matureCount: 0,
      diseaseCount: 8,
    });
    const peaks = await service.diseasePeaks(
      admin,
      { grain: 'hour' },
      new Date('2026-09-20T06:00:00.000Z'),
    );
    expect(peaks.byTime.map((row) => row.diseaseCount)).toEqual([3, 8]);
    expect(peaks.byShed[0]).toEqual({ shedCode: 'S02', diseaseCount: 8 });
    expect(peaks.peak).toMatchObject({ diseaseCount: 8 });
    const dayPeaks = await service.diseasePeaks(
      admin,
      { grain: 'day' },
      new Date('2026-09-20T06:00:00.000Z'),
    );
    expect(dayPeaks.byShed).toEqual([
      { shedCode: 'S02', diseaseCount: 8 },
      { shedCode: 'S01', diseaseCount: 3 },
    ]);
  });

  it('keeps environment buckets when a recognition day is rebuilt', async () => {
    const hours = memoryMetricBuckets();
    const days = memoryMetricBuckets();
    const recognizedAt = new Date('2026-09-23T01:00:00.000Z');
    seedMetric(
      hours,
      shanghaiHourStart(recognizedAt),
      'S01',
      '',
      METRIC_ENV_TEMPERATURE,
      19.5,
    );
    const records = memoryRecords([
      {
        id: 'a',
        shedCode: 'S01',
        cameraCode: 'CAM-1',
        recognizedAt,
        mushroomCount: 10,
        avgCapDiameter: 4,
      },
    ]);
    const service = new GrowthTrendService(
      records as never,
      hours as never,
      days as never,
    );
    await service.refreshDay('2026-09-23');
    expect(bucketValue(hours.rows, METRIC_ENV_TEMPERATURE, '')?.value).toBe(
      19.5,
    );
    expect(bucketValue(hours.rows, METRIC_MUSHROOM_COUNT, 'CAM-1')?.value).toBe(
      10,
    );
  });

  it('serves hourly growth and disease peaks over HTTP without a recognition scan', async () => {
    const nowHour = shanghaiHourStart(new Date());
    const hours = memoryMetricBuckets();
    const days = memoryMetricBuckets();
    seedMetric(hours, nowHour, 'S01', '', METRIC_MUSHROOM_COUNT, 4);
    seedMetric(
      days,
      shanghaiDayRange(todayShanghai()).start,
      'S01',
      '',
      METRIC_DISEASE_COUNT,
      6,
    );
    const records = memoryRecords([]);
    const scan = jest.spyOn(records, 'createQueryBuilder');
    const listed = jest
      .fn()
      .mockResolvedValue({ items: [{ id: 'd-1' }], total: 1 });
    const moduleRef = await Test.createTestingModule({
      controllers: [GrowthTrendsController, DiseasesController],
      providers: [
        GrowthTrendService,
        { provide: getRepositoryToken(RecognitionRecord), useValue: records },
        { provide: getRepositoryToken(MetricBucketHour), useValue: hours },
        { provide: getRepositoryToken(MetricBucketDay), useValue: days },
        { provide: IngestService, useValue: { list: listed } },
      ],
    }).compile();
    const http = moduleRef.createNestApplication();
    http.use(assignUser);
    configureApp(http);
    await http.init();
    const hourly = await request(http.getHttpServer())
      .get('/api/v1/growth-trends/hours')
      .set('x-test-role', 'super_admin');
    expect(hourly.status).toBe(200);
    expect(hourly.body.hours).toBe(24);
    expect(hourly.body.sheds).toEqual([
      expect.objectContaining({
        shedCode: 'S01',
        points: [expect.objectContaining({ mushroomCount: 4 })],
      }),
    ]);
    expect(hourly.body.sheds[0].points).toHaveLength(1);
    const peaks = await request(http.getHttpServer())
      .get('/api/v1/diseases/peaks?grain=day')
      .set('x-test-role', 'shed_manager');
    expect(peaks.status).toBe(200);
    expect(peaks.body.byShed).toEqual([{ shedCode: 'S01', diseaseCount: 6 }]);
    expect(scan).not.toHaveBeenCalled();
    expect(listed).not.toHaveBeenCalled();
    const archive = await request(http.getHttpServer())
      .get('/api/v1/diseases')
      .set('x-test-role', 'super_admin');
    expect(archive.body.items).toEqual([{ id: 'd-1' }]);
    const denied = await request(http.getHttpServer())
      .get('/api/v1/growth-trends/hours?shedCode=S02')
      .set('x-test-role', 'viewer');
    expect(denied.status).toBe(403);
    await http.close();
  });

  it('reads one sensor hour series and leaves shed means on the unfiltered path', async () => {
    const now = new Date('2026-10-15T02:30:00.000Z');
    const current = shanghaiHourStart(now);
    const earlier = new Date(current.getTime() - 18 * 3_600_000);
    const hours = memoryMetricBuckets();
    const days = memoryMetricBuckets();
    seedMetric(hours, earlier, 'S01', '', METRIC_ENV_TEMPERATURE, 15);
    seedMetric(hours, current, 'S01', '', METRIC_ENV_TEMPERATURE, 30);
    seedMetric(
      hours,
      earlier,
      'S01',
      'SENSOR-ENV24-01',
      METRIC_ENV_TEMPERATURE,
      22,
    );
    seedMetric(
      hours,
      earlier,
      'S01',
      'SENSOR-ENV24-01',
      METRIC_ENV_HUMIDITY,
      78,
    );
    seedMetric(
      hours,
      current,
      'S01',
      'SENSOR-ENV24-01',
      METRIC_ENV_TEMPERATURE,
      26,
    );
    seedMetric(
      hours,
      current,
      'S01',
      'SENSOR-ENV24-01',
      METRIC_ENV_HUMIDITY,
      92,
    );
    seedMetric(
      hours,
      current,
      'S01',
      'SENSOR-OTHER',
      METRIC_ENV_TEMPERATURE,
      40,
    );
    const service = new GrowthTrendService(
      memoryRecords([]) as never,
      hours as never,
      days as never,
    );
    const mixed = await service.environmentSeries(
      admin,
      { shedCode: 'S01' },
      now,
    );
    expect(mixed.sensorCode).toBeNull();
    expect(mixed.points.map((point) => point.temperature)).toEqual([15, 30]);
    const series = await service.environmentSeries(
      admin,
      { hours: '24', shedCode: 'S01', sensorCode: 'SENSOR-ENV24-01' },
      now,
    );
    expect(series.hours).toBe(24);
    expect(series.sensorCode).toBe('SENSOR-ENV24-01');
    expect(series.points.map((point) => point.temperature)).toEqual([22, 26]);
    expect(series.points.map((point) => point.humidity)).toEqual([78, 92]);
    expect(series.sheds).toEqual([
      expect.objectContaining({ shedCode: 'S01' }),
    ]);
  });

  it('forwards sensorCode on the environment route', async () => {
    const trends = {
      environmentSeries: jest.fn().mockResolvedValue({ points: [] }),
    };
    const controller = new GrowthTrendsController(trends as never);
    await controller.environment(admin, '24', 'S01', 'SENSOR-ENV24-01');
    expect(trends.environmentSeries).toHaveBeenCalledWith(admin, {
      hours: '24',
      shedCode: 'S01',
      sensorCode: 'SENSOR-ENV24-01',
    });
  });

  it('reads a rising disease day series from day buckets without a recognition scan', async () => {
    const now = new Date('2026-10-15T02:00:00.000Z');
    const hours = memoryMetricBuckets();
    const daysRepo = memoryMetricBuckets();
    const records = memoryRecords([]);
    const scan = jest.spyOn(records, 'createQueryBuilder');
    const service = new GrowthTrendService(
      records as never,
      hours as never,
      daysRepo as never,
    );
    const counts = [
      { offset: 5, diseaseCount: 1 },
      { offset: 3, diseaseCount: 3 },
      { offset: 1, diseaseCount: 6 },
      { offset: 0, diseaseCount: 10 },
    ];
    for (const point of counts) {
      await service.applyRecognition({
        shedCode: 'S01',
        cameraCode: 'CAM-SDT-01',
        recognizedAt: new Date(now.getTime() - point.offset * 86_400_000),
        mushroomCount: 40,
        avgCapDiameter: 4.2,
        matureCount: 4,
        diseaseCount: point.diseaseCount,
      });
    }
    await service.applyRecognition({
      shedCode: 'S01',
      cameraCode: 'CAM-OTHER',
      recognizedAt: now,
      mushroomCount: 40,
      avgCapDiameter: 4.2,
      matureCount: 4,
      diseaseCount: 2,
    });
    const series = await service.diseaseTrends(
      admin,
      { days: '7', shedCode: 'S01', cameraCode: 'CAM-SDT-01' },
      now,
    );
    expect(scan).not.toHaveBeenCalled();
    expect(series.days).toBe(7);
    expect(series.diseaseCount).toBe('latest_per_camera');
    const camera = series.sheds[0]?.cameras.find(
      (item) => item.cameraCode === 'CAM-SDT-01',
    );
    expect(camera?.points.map((point) => point.diseaseCount)).toEqual([
      1, 3, 6, 10,
    ]);
    expect(series.sheds[0]?.cameras.map((item) => item.cameraCode)).toEqual([
      'CAM-SDT-01',
    ]);
    const month = await service.diseaseTrends(
      admin,
      { days: '30', shedCode: 'S01', cameraCode: 'CAM-SDT-01' },
      now,
    );
    expect(month.days).toBe(30);
    expect(
      month.sheds[0]?.cameras[0]?.points.map((point) => point.diseaseCount),
    ).toEqual([1, 3, 6, 10]);
    const shed = await service.diseaseTrends(
      admin,
      { days: '7', shedCode: 'S01' },
      now,
    );
    expect(shed.sheds[0]?.points.map((point) => point.diseaseCount)).toEqual([
      1, 3, 6, 12,
    ]);
    const empty = await service.diseaseTrends(
      admin,
      { days: '7', shedCode: 'S01', cameraCode: 'CAM-SDT-NONE' },
      now,
    );
    expect(empty.sheds).toEqual([]);
    const viewer: AuthUser = {
      id: 'viewer',
      username: 'viewer',
      displayName: 'viewer',
      role: 'viewer',
      shedCodes: ['S01'],
    };
    await expect(
      service.diseaseTrends(viewer, { shedCode: 'S02' }, now),
    ).rejects.toThrow('无权访问该棚区');
    await expect(
      service.diseaseTrends(admin, { days: '14' }, now),
    ).rejects.toThrow('天数只支持 7 或 30');
  });

  it('serves disease day trends over HTTP without listing disease rows', async () => {
    const today = todayShanghai();
    const dayStart = (offset: number) =>
      shanghaiDayRange(shiftShanghaiDay(today, -offset)).start;
    const hours = memoryMetricBuckets();
    const days = memoryMetricBuckets();
    const seeded = [
      { offset: 5, diseaseCount: 1 },
      { offset: 3, diseaseCount: 3 },
      { offset: 1, diseaseCount: 6 },
      { offset: 0, diseaseCount: 10 },
    ];
    for (const point of seeded) {
      seedMetric(
        days,
        dayStart(point.offset),
        'S01',
        'CAM-SDT-01',
        METRIC_DISEASE_COUNT,
        point.diseaseCount,
      );
      seedMetric(
        days,
        dayStart(point.offset),
        'S01',
        '',
        METRIC_DISEASE_COUNT,
        point.diseaseCount,
      );
    }
    const records = memoryRecords([]);
    const scan = jest.spyOn(records, 'createQueryBuilder');
    const listed = jest.fn().mockResolvedValue({ items: [], total: 0 });
    const moduleRef = await Test.createTestingModule({
      controllers: [DiseasesController],
      providers: [
        GrowthTrendService,
        { provide: getRepositoryToken(RecognitionRecord), useValue: records },
        { provide: getRepositoryToken(MetricBucketHour), useValue: hours },
        { provide: getRepositoryToken(MetricBucketDay), useValue: days },
        { provide: IngestService, useValue: { list: listed } },
      ],
    }).compile();
    const http = moduleRef.createNestApplication();
    http.use(assignUser);
    configureApp(http);
    await http.init();
    const week = await request(http.getHttpServer())
      .get('/api/v1/diseases/trends?days=7&shedCode=S01&cameraCode=CAM-SDT-01')
      .set('x-test-role', 'super_admin');
    expect(week.status).toBe(200);
    expect(week.body.days).toBe(7);
    expect(
      week.body.sheds[0].cameras[0].points.map(
        (point: { diseaseCount: number }) => point.diseaseCount,
      ),
    ).toEqual([1, 3, 6, 10]);
    const denied = await request(http.getHttpServer())
      .get('/api/v1/diseases/trends?days=7&shedCode=S02')
      .set('x-test-role', 'viewer');
    expect(denied.status).toBe(403);
    const bad = await request(http.getHttpServer())
      .get('/api/v1/diseases/trends?days=14')
      .set('x-test-role', 'super_admin');
    expect(bad.status).toBe(400);
    expect(scan).not.toHaveBeenCalled();
    expect(listed).not.toHaveBeenCalled();
    await http.close();
  });
});

describe('shed live stats', () => {
  const admin: AuthUser = {
    id: 'admin',
    username: 'admin',
    displayName: 'admin',
    role: 'super_admin',
    shedCodes: [],
  };

  it('sums each camera latest for today and computes pending after the sum', async () => {
    const now = new Date('2026-10-15T02:00:00.000Z');
    const hours = memoryMetricBuckets();
    const daysRepo = memoryMetricBuckets();
    const records = memoryRecords([]);
    const scan = jest.spyOn(records, 'createQueryBuilder');
    const service = new GrowthTrendService(
      records as never,
      hours as never,
      daysRepo as never,
    );
    await service.applyRecognition({
      shedCode: 'S01',
      cameraCode: 'CAM-SLS-01',
      recognizedAt: now,
      mushroomCount: 20,
      avgCapDiameter: 4.2,
      matureCount: 8,
      diseaseCount: 2,
    });
    await service.applyRecognition({
      shedCode: 'S01',
      cameraCode: 'CAM-SLS-02',
      recognizedAt: now,
      mushroomCount: 5,
      avgCapDiameter: 4.2,
      matureCount: 6,
      diseaseCount: 1,
    });
    await service.applyRecognition({
      shedCode: 'S01',
      cameraCode: 'CAM-YDAY',
      recognizedAt: new Date(now.getTime() - 86_400_000),
      mushroomCount: 99,
      avgCapDiameter: 4.2,
      matureCount: 99,
      diseaseCount: 99,
    });
    await service.applyRecognition({
      shedCode: 'S01',
      cameraCode: 'CAM-ZERO',
      recognizedAt: now,
      mushroomCount: 0,
      avgCapDiameter: 4.2,
      matureCount: 3,
      diseaseCount: 0,
    });
    const camera = await service.liveStats(
      admin,
      { shedCode: 'S01', cameraCode: 'CAM-SLS-01' },
      now,
    );
    expect(scan).not.toHaveBeenCalled();
    expect(camera).toMatchObject({
      shedCode: 'S01',
      cameraCode: 'CAM-SLS-01',
      available: true,
      mushroomCount: 20,
      matureCount: 8,
      pendingMatureCount: 12,
      diseaseCount: 2,
      basis: 'latest_per_camera',
    });
    const shed = await service.liveStats(admin, { shedCode: 'S01' }, now);
    expect(shed.cameraCode).toBeNull();
    expect(shed.mushroomCount).toBe(25);
    expect(shed.matureCount).toBe(17);
    expect(shed.diseaseCount).toBe(3);
    expect(shed.pendingMatureCount).toBe(8);
    const zero = await service.liveStats(
      admin,
      { shedCode: 'S01', cameraCode: 'CAM-ZERO' },
      now,
    );
    expect(zero.mushroomCount).toBe(0);
    expect(zero.pendingMatureCount).toBe(0);
    const none = await service.liveStats(
      admin,
      { shedCode: 'S01', cameraCode: 'CAM-SLS-NONE' },
      now,
    );
    expect(none.available).toBe(false);
    expect(none.mushroomCount).toBeNull();
    expect(none.pendingMatureCount).toBeNull();
    const emptyShed = await service.liveStats(
      admin,
      { shedCode: 'S09' },
      now,
    );
    expect(emptyShed.available).toBe(false);
    const viewer: AuthUser = {
      id: 'viewer',
      username: 'viewer',
      displayName: 'viewer',
      role: 'viewer',
      shedCodes: ['S01'],
    };
    await expect(
      service.liveStats(viewer, { shedCode: 'S02' }, now),
    ).rejects.toThrow('无权访问该棚区');
    await expect(service.liveStats(admin, {}, now)).rejects.toThrow(
      '请选择棚区',
    );
  });

  it('serves live stats over HTTP without scanning recognition rows', async () => {
    const today = todayShanghai();
    const dayStart = shanghaiDayRange(today).start;
    const hours = memoryMetricBuckets();
    const days = memoryMetricBuckets();
    const metrics = [
      [METRIC_MUSHROOM_COUNT, 20],
      [METRIC_MATURE_COUNT, 8],
      [METRIC_DISEASE_COUNT, 2],
    ] as const;
    for (const [metric, value] of metrics) {
      seedMetric(days, dayStart, 'S01', 'CAM-SLS-01', metric, value);
      seedMetric(days, dayStart, 'S01', '', metric, value);
    }
    const records = memoryRecords([]);
    const scan = jest.spyOn(records, 'createQueryBuilder');
    const moduleRef = await Test.createTestingModule({
      controllers: [GrowthTrendsController],
      providers: [
        GrowthTrendService,
        { provide: getRepositoryToken(RecognitionRecord), useValue: records },
        { provide: getRepositoryToken(MetricBucketHour), useValue: hours },
        { provide: getRepositoryToken(MetricBucketDay), useValue: days },
      ],
    }).compile();
    const http = moduleRef.createNestApplication();
    http.use(assignUser);
    configureApp(http);
    await http.init();
    const live = await request(http.getHttpServer())
      .get('/api/v1/growth-trends/live?shedCode=S01&cameraCode=CAM-SLS-01')
      .set('x-test-role', 'super_admin');
    expect(live.status).toBe(200);
    expect(live.body).toMatchObject({
      available: true,
      mushroomCount: 20,
      matureCount: 8,
      pendingMatureCount: 12,
      diseaseCount: 2,
    });
    const denied = await request(http.getHttpServer())
      .get('/api/v1/growth-trends/live?shedCode=S02')
      .set('x-test-role', 'viewer');
    expect(denied.status).toBe(403);
    const missing = await request(http.getHttpServer())
      .get('/api/v1/growth-trends/live')
      .set('x-test-role', 'super_admin');
    expect(missing.status).toBe(400);
    expect(scan).not.toHaveBeenCalled();
    await http.close();
  });
});

describe('growth trend write path', () => {
  it('refreshes after a mushroom correction and skips a mature-only correction', async () => {
    const refreshDay = jest.fn().mockResolvedValue([]);
    const record = {
      id: 'r1',
      shedCode: 'S01',
      cameraCode: 'CAM-1',
      recognizedAt: new Date('2026-09-23T01:30:00.000Z'),
      mushroomCount: 10,
      matureCount: 4,
    } as RecognitionRecord;
    const records = {
      findOne: async () => record,
      save: async (input: RecognitionRecord) => input,
    };
    const harvest = new HarvestService(
      records as never,
      { find: async () => [], save: async (input: unknown) => input } as never,
      { createQueryBuilder: () => ({}) } as never,
      {
        refreshDay,
      } as never,
    );
    const user: AuthUser = {
      id: 'admin',
      username: 'admin',
      displayName: 'admin',
      role: 'super_admin',
      shedCodes: [],
    };

    await harvest.correct(user, 'r1', { matureCount: 3 });
    expect(refreshDay).not.toHaveBeenCalled();

    await harvest.correct(user, 'r1', { mushroomCount: 6 });
    expect(refreshDay).toHaveBeenCalledWith('2026-09-23');
  });
});
