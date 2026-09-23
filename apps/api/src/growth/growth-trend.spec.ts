import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Role, todayShanghai } from '@mushroom/contracts';
import { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { AuthUser } from '../common/auth-user';
import { configureApp } from '../configure-app';
import { DailyAggregate } from '../entities/daily-aggregate.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import { HarvestService } from '../harvest';
import {
  AggregateSource,
  aggregateDay,
  shiftShanghaiDay,
} from './growth-trend.aggregate';
import { GrowthTrendsController } from './growth-trend.controller';
import { GrowthTrendService } from './growth-trend.service';

function memoryAggregates(initial: DailyAggregate[] = []) {
  const rows = initial.map((row) => ({ ...row }));
  let seq = rows.length;
  return {
    rows,
    create: (input: Partial<DailyAggregate>) => ({ ...input }) as DailyAggregate,
    find: async (options?: { where?: { day?: string } }) => {
      const day = options?.where?.day;
      const found = day ? rows.filter((row) => row.day === day) : rows;
      return found.map((row) => ({ ...row }));
    },
    save: async (input: DailyAggregate) => {
      const saved = {
        ...input,
        id: input.id ?? `agg-${++seq}`,
        updatedAt: input.updatedAt ?? new Date(),
      };
      const index = rows.findIndex((row) => row.id === saved.id);
      if (index >= 0) rows[index] = saved;
      else rows.push(saved);
      return { ...saved };
    },
    delete: async (criteria: { id: string }) => {
      const index = rows.findIndex((row) => row.id === criteria.id);
      if (index >= 0) rows.splice(index, 1);
      return { affected: index >= 0 ? 1 : 0 };
    },
    createQueryBuilder() {
      const filters: Array<(row: DailyAggregate) => boolean> = [];
      const qb = {
        where(_sql: string, params: { from: string; to: string }) {
          filters.push((row) => row.day >= params.from && row.day <= params.to);
          return qb;
        },
        andWhere(
          sql: string,
          params?: { codes?: string[]; shedCode?: string },
        ) {
          if (sql.includes('1 = 0')) filters.push(() => false);
          if (params?.codes) {
            const codes = params.codes;
            filters.push((row) => codes.includes(row.shedCode));
          }
          if (params?.shedCode) {
            filters.push((row) => row.shedCode === params.shedCode);
          }
          return qb;
        },
        orderBy() {
          return qb;
        },
        addOrderBy() {
          return qb;
        },
        async getMany() {
          return rows
            .filter((row) => filters.every((fn) => fn(row)))
            .sort(
              (a, b) =>
                a.day.localeCompare(b.day) ||
                a.shedCode.localeCompare(b.shedCode),
            )
            .map((row) => ({ ...row }));
        },
      };
      return qb;
    },
  };
}

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

function point(
  partial: Partial<DailyAggregate> &
    Pick<DailyAggregate, 'day' | 'grain' | 'shedCode' | 'cameraCode'>,
): DailyAggregate {
  return {
    id: partial.id ?? `${partial.shedCode}-${partial.cameraCode}-${partial.day}`,
    mushroomCount: partial.mushroomCount ?? 1,
    capDiameterMean: partial.capDiameterMean ?? 4,
    sampleCount: partial.sampleCount ?? 1,
    updatedAt: new Date(),
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

describe('daily growth aggregates', () => {
  it('keeps the latest mushroom count and the mean cap diameter', () => {
    const day = '2026-09-23';
    const points = aggregateDay(day, [
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
    ]);

    const shed = points.find((row) => row.grain === 'shed');
    const cam1 = points.find((row) => row.cameraCode === 'CAM-1');
    const cam3 = points.find((row) => row.cameraCode === 'CAM-3');
    expect(shed).toMatchObject({
      mushroomCount: 23,
      capDiameterMean: 4.67,
      sampleCount: 4,
    });
    expect(cam1).toMatchObject({
      mushroomCount: 12,
      capDiameterMean: 5,
      sampleCount: 2,
    });
    expect(cam3).toMatchObject({ mushroomCount: 3, capDiameterMean: null });
    expect(points.some((row) => row.mushroomCount === 99)).toBe(false);
  });

  it('returns no rows when the day has no recognitions', () => {
    expect(aggregateDay('2026-09-23', [])).toEqual([]);
  });

  it('rewrites the day and drops cameras that no longer reported', async () => {
    const aggregates = memoryAggregates();
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
    const service = new GrowthTrendService(
      aggregates as never,
      records as never,
    );
    await service.refreshDay('2026-09-23');
    expect(aggregates.rows).toHaveLength(3);

    records.rows.splice(1, 1);
    records.rows[0].mushroomCount = 15;
    await service.refreshDay('2026-09-23');
    expect(aggregates.rows.map((row) => row.cameraCode).sort()).toEqual([
      '',
      'CAM-1',
    ]);
    expect(
      aggregates.rows.find((row) => row.grain === 'shed')?.mushroomCount,
    ).toBe(15);
  });
});

describe('growth trend API', () => {
  let app: INestApplication;
  const today = todayShanghai();
  const recent = shiftShanghaiDay(today, -1);
  const within30 = shiftShanghaiDay(today, -20);
  const outside = shiftShanghaiDay(today, -40);

  beforeEach(async () => {
    const aggregates = memoryAggregates([
      point({
        day: today,
        grain: 'shed',
        shedCode: 'S01',
        cameraCode: '',
        mushroomCount: 20,
        capDiameterMean: 5,
      }),
      point({
        day: today,
        grain: 'camera',
        shedCode: 'S01',
        cameraCode: 'CAM-1',
        mushroomCount: 12,
        capDiameterMean: 5,
      }),
      point({
        day: today,
        grain: 'camera',
        shedCode: 'S01',
        cameraCode: 'CAM-2',
        mushroomCount: 8,
        capDiameterMean: 4,
      }),
      point({
        day: recent,
        grain: 'shed',
        shedCode: 'S01',
        cameraCode: '',
        mushroomCount: 9,
      }),
      point({
        day: within30,
        grain: 'shed',
        shedCode: 'S01',
        cameraCode: '',
        mushroomCount: 4,
      }),
      point({
        day: outside,
        grain: 'shed',
        shedCode: 'S01',
        cameraCode: '',
        mushroomCount: 1,
      }),
      point({
        day: today,
        grain: 'shed',
        shedCode: 'S02',
        cameraCode: '',
        mushroomCount: 50,
      }),
      point({
        day: today,
        grain: 'camera',
        shedCode: 'S02',
        cameraCode: 'CAM-9',
        mushroomCount: 50,
      }),
    ]);
    const moduleRef = await Test.createTestingModule({
      controllers: [GrowthTrendsController],
      providers: [
        GrowthTrendService,
        {
          provide: getRepositoryToken(DailyAggregate),
          useValue: aggregates,
        },
        {
          provide: getRepositoryToken(RecognitionRecord),
          useValue: memoryRecords([]),
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
    const s01 = response.body.sheds.find(
      (shed: { shedCode: string }) => shed.shedCode === 'S01',
    );
    expect(s01.points.map((row: { day: string }) => row.day)).toEqual([
      recent,
      today,
    ]);
    expect(s01.points).toHaveLength(2);
    expect(s01.cameras.map((row: { cameraCode: string }) => row.cameraCode)).toEqual([
      'CAM-1',
      'CAM-2',
    ]);
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
      expect(listed.body.sheds.map((row: { shedCode: string }) => row.shedCode)).toEqual([
        'S01',
      ]);

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
    const harvest = new HarvestService(records as never, {
      refreshDay,
    } as never);
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
