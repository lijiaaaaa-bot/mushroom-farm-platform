import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { shanghaiDayRange, todayShanghai, Role } from '@mushroom/contracts';
import { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { AuditController, AuditService } from '../audit';
import { AuthUser } from '../common/auth-user';
import { RolesGuard } from '../common/guards';
import { configureApp } from '../configure-app';
import { AuditLog } from '../entities/audit-log.entity';
import { HarvestTask } from '../entities/harvest-task.entity';
import { MetricBucketDay } from '../entities/metric-bucket.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import { HarvestController } from './harvest.controller';
import { HarvestService } from './harvest.service';

const WRITE_ROLES = [
  'super_admin',
  'production_admin',
  'shed_manager',
] as const;

function memoryRecords() {
  const rows: RecognitionRecord[] = [];
  return {
    rows,
    findOne: async ({ where }: { where: { id: string } }) =>
      rows.find((row) => row.id === where.id) ?? null,
    save: async (input: RecognitionRecord) => {
      const index = rows.findIndex((row) => row.id === input.id);
      if (index >= 0) {
        rows[index] = input;
        return rows[index];
      }
      rows.push(input);
      return input;
    },
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
      const ordered = [...inRange].sort((a, b) => {
        if (a.cameraCode !== b.cameraCode) {
          return a.cameraCode < b.cameraCode ? -1 : 1;
        }
        return (
          new Date(b.recognizedAt).getTime() -
          new Date(a.recognizedAt).getTime()
        );
      });
      for (const row of ordered) {
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

function memoryLogs() {
  const rows: AuditLog[] = [];
  return {
    rows,
    create: (input: Partial<AuditLog>) => ({ ...input }),
    save: async (input: Partial<AuditLog>) => {
      const saved = {
        ...input,
        id: input.id ?? `audit-${rows.length + 1}`,
        createdAt: input.createdAt ?? new Date(),
      } as AuditLog;
      rows.push(saved);
      return saved;
    },
    findAndCount: async (options?: { skip?: number; take?: number }) => {
      const skip = options?.skip ?? 0;
      const take = options?.take ?? rows.length;
      const sorted = [...rows].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      );
      return [sorted.slice(skip, skip + take), rows.length] as [
        AuditLog[],
        number,
      ];
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
    rawPayload: { matureCount: 4, mushroomCount: 10 },
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

describe('harvest correction HTTP', () => {
  let app: INestApplication;
  const records = memoryRecords();
  const logs = memoryLogs();

  beforeEach(async () => {
    records.rows.splice(0, records.rows.length);
    logs.rows.splice(0, logs.rows.length);
    const moduleRef = await Test.createTestingModule({
      controllers: [HarvestController, AuditController],
      providers: [
        HarvestService,
        AuditService,
        { provide: APP_GUARD, useClass: RolesGuard },
        {
          provide: getRepositoryToken(RecognitionRecord),
          useValue: records,
        },
        { provide: getRepositoryToken(AuditLog), useValue: logs },
        {
          provide: getRepositoryToken(HarvestTask),
          useValue: {
            find: async () => [],
            findOne: async () => null,
            create: (input: Partial<HarvestTask>) => input,
            save: async (input: HarvestTask) => input,
            delete: async () => undefined,
          },
        },
        {
          provide: getRepositoryToken(MetricBucketDay),
          useValue: {
            createQueryBuilder: () => {
              const qb = {
                where: () => qb,
                andWhere: () => qb,
                getMany: async () => [],
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

  it.each(WRITE_ROLES)(
    '%s corrects mature and mushroom counts, refreshes the summary, and writes one audit row',
    async (role) => {
      records.rows.push(
        sample({ id: 'rec-1', shedCode: 'S01', cameraCode: 'CAM-S01' }),
      );
      const day = todayShanghai();

      const patched = await request(app.getHttpServer())
        .patch('/api/v1/harvest/daily/rec-1')
        .set('x-test-role', role)
        .send({ matureCount: 0, mushroomCount: 6 });

      expect(patched.status).toBe(200);
      expect(patched.body).toMatchObject({
        id: 'rec-1',
        shedCode: 'S01',
        cameraCode: 'CAM-S01',
        matureCount: 0,
        mushroomCount: 6,
      });

      const listed = await request(app.getHttpServer())
        .get('/api/v1/harvest/daily')
        .query({ date: day })
        .set('x-test-role', role);

      expect(listed.status).toBe(200);
      expect(listed.body.summary).toMatchObject({
        matureCount: 0,
        mushroomCount: 6,
        harvestableCameras: 0,
      });
      expect(listed.body.items).toEqual([
        expect.objectContaining({
          id: 'rec-1',
          matureCount: 0,
          mushroomCount: 6,
        }),
      ]);

      const audit = await request(app.getHttpServer())
        .get('/api/v1/audit-logs')
        .set('x-test-role', 'super_admin');

      expect(audit.status).toBe(200);
      expect(audit.body.total).toBe(1);
      expect(audit.body.items).toHaveLength(1);
      expect(audit.body.items[0]).toMatchObject({
        userId: `id-${role}`,
        username: role,
        action: 'harvest.correct',
        resource: 'recognition:rec-1',
        detail: {
          shedCode: 'S01',
          cameraCode: 'CAM-S01',
          changes: {
            matureCount: { old: 4, new: 0 },
            mushroomCount: { old: 10, new: 6 },
          },
        },
      });
      expect(audit.body.items[0].createdAt).toEqual(expect.any(String));
    },
  );

  it('rejects a shed manager correcting another shed and keeps that row out of the daily list', async () => {
    records.rows.push(
      sample({
        id: 'rec-s02',
        shedCode: 'S02',
        cameraCode: 'CAM-S02',
        matureCount: 9,
        mushroomCount: 12,
      }),
      sample({ id: 'rec-s01', shedCode: 'S01', cameraCode: 'CAM-S01' }),
    );

    const denied = await request(app.getHttpServer())
      .patch('/api/v1/harvest/daily/rec-s02')
      .set('x-test-role', 'shed_manager')
      .send({ matureCount: 1 });

    expect(denied.status).toBe(403);
    expect(records.rows.find((row) => row.id === 'rec-s02')?.matureCount).toBe(
      9,
    );
    expect(logs.rows).toHaveLength(0);

    const listed = await request(app.getHttpServer())
      .get('/api/v1/harvest/daily')
      .set('x-test-role', 'shed_manager');

    expect(listed.status).toBe(200);
    const shedCodes = listed.body.items.map(
      (item: { shedCode: string }) => item.shedCode,
    );
    expect(shedCodes).toEqual(['S01']);
    expect(listed.body.summary.matureCount).toBe(4);
  });

  it('rejects a viewer correction', async () => {
    records.rows.push(
      sample({ id: 'rec-1', shedCode: 'S01', cameraCode: 'CAM-S01' }),
    );

    const denied = await request(app.getHttpServer())
      .patch('/api/v1/harvest/daily/rec-1')
      .set('x-test-role', 'viewer')
      .send({ matureCount: 1 });

    expect(denied.status).toBe(403);
    expect(records.rows[0].matureCount).toBe(4);
    expect(logs.rows).toHaveLength(0);
  });

  it('rejects a mature count above the mushroom count without an audit row', async () => {
    records.rows.push(
      sample({ id: 'rec-1', shedCode: 'S01', cameraCode: 'CAM-S01' }),
    );

    const denied = await request(app.getHttpServer())
      .patch('/api/v1/harvest/daily/rec-1')
      .set('x-test-role', 'production_admin')
      .send({ matureCount: 11 });

    expect(denied.status).toBe(400);
    expect(records.rows[0].matureCount).toBe(4);
    expect(logs.rows).toHaveLength(0);
  });

  it('returns one harvest row and hides another shed', async () => {
    records.rows.push(
      sample({
        id: 'rec-1',
        shedCode: 'S01',
        cameraCode: 'CAM-HAR-01',
        matureCount: 5,
        mushroomCount: 12,
        avgCapDiameter: 4.7,
      }),
      sample({
        id: 'rec-s02',
        shedCode: 'S02',
        cameraCode: 'CAM-HAR-02',
        matureCount: 3,
        mushroomCount: 8,
      }),
    );

    const opened = await request(app.getHttpServer())
      .get('/api/v1/harvest/daily/rec-1')
      .set('x-test-role', 'viewer');

    expect(opened.status).toBe(200);
    expect(opened.body).toMatchObject({
      id: 'rec-1',
      shedCode: 'S01',
      cameraCode: 'CAM-HAR-01',
      matureCount: 5,
      mushroomCount: 12,
      avgCapDiameter: 4.7,
    });

    const denied = await request(app.getHttpServer())
      .get('/api/v1/harvest/daily/rec-s02')
      .set('x-test-role', 'shed_manager');
    expect(denied.status).toBe(403);

    const missing = await request(app.getHttpServer())
      .get('/api/v1/harvest/daily/missing')
      .set('x-test-role', 'super_admin');
    expect(missing.status).toBe(404);
  });

  it('filters the daily list by camera and leaves an unknown camera empty', async () => {
    const day = todayShanghai();
    records.rows.push(
      sample({
        id: 'rec-1',
        shedCode: 'S01',
        cameraCode: 'CAM-HAR-01',
        matureCount: 5,
        mushroomCount: 12,
      }),
      sample({
        id: 'rec-2',
        shedCode: 'S01',
        cameraCode: 'CAM-OTHER',
        matureCount: 2,
        mushroomCount: 4,
      }),
    );

    const listed = await request(app.getHttpServer())
      .get('/api/v1/harvest/daily')
      .query({ date: day, cameraCode: 'CAM-HAR-01' })
      .set('x-test-role', 'super_admin');

    expect(listed.status).toBe(200);
    expect(listed.body.items).toEqual([
      expect.objectContaining({
        id: 'rec-1',
        cameraCode: 'CAM-HAR-01',
        matureCount: 5,
        mushroomCount: 12,
      }),
    ]);
    expect(listed.body.summary).toMatchObject({
      matureCount: 5,
      mushroomCount: 12,
      harvestableCameras: 1,
    });

    const contrast = await request(app.getHttpServer())
      .get('/api/v1/harvest/daily')
      .query({ date: day, cameraCode: 'CAM-HAR-NONE' })
      .set('x-test-role', 'super_admin');

    expect(contrast.status).toBe(200);
    expect(contrast.body.items).toEqual([]);
    expect(contrast.body.summary).toMatchObject({
      matureCount: 0,
      mushroomCount: 0,
      harvestableCameras: 0,
    });
  });

  it('filters the daily list by shed and by an inclusive time window', async () => {
    const day = todayShanghai();
    const { start } = shanghaiDayRange(day);
    const early = new Date(start.getTime() + 60 * 1000);
    const late = new Date(start.getTime() + 3 * 60 * 60 * 1000);
    const beforeDay = new Date(start.getTime() - 60 * 60 * 1000);
    records.rows.push(
      sample({
        id: 'rec-s01',
        shedCode: 'S01',
        cameraCode: 'CAM-HF-S01',
        matureCount: 5,
        mushroomCount: 12,
        recognizedAt: early,
      }),
      sample({
        id: 'rec-s02',
        shedCode: 'S02',
        cameraCode: 'CAM-HF-S02',
        matureCount: 9,
        mushroomCount: 17,
        recognizedAt: late,
      }),
      sample({
        id: 'rec-old',
        shedCode: 'S01',
        cameraCode: 'CAM-HF-OLD',
        matureCount: 1,
        mushroomCount: 2,
        recognizedAt: beforeDay,
      }),
    );

    const wide = await request(app.getHttpServer())
      .get('/api/v1/harvest/daily')
      .query({
        date: day,
        from: beforeDay.toISOString(),
        to: late.toISOString(),
      })
      .set('x-test-role', 'super_admin');

    expect(wide.status).toBe(200);
    expect(
      wide.body.items.map((item: { id: string }) => item.id).sort(),
    ).toEqual(['rec-old', 'rec-s01', 'rec-s02']);
    expect(wide.body.summary).toMatchObject({
      matureCount: 15,
      mushroomCount: 31,
      harvestableCameras: 3,
    });
    expect(wide.body.from).toBe(beforeDay.toISOString());
    expect(wide.body.to).toBe(late.toISOString());

    const shed = await request(app.getHttpServer())
      .get('/api/v1/harvest/daily')
      .query({
        from: beforeDay.toISOString(),
        to: late.toISOString(),
        shedCode: 'S01',
      })
      .set('x-test-role', 'super_admin');

    expect(shed.status).toBe(200);
    expect(shed.body.shedCode).toBe('S01');
    expect(
      shed.body.items
        .map((item: { cameraCode: string }) => item.cameraCode)
        .sort(),
    ).toEqual(['CAM-HF-OLD', 'CAM-HF-S01']);
    expect(
      shed.body.items.every(
        (item: { shedCode: string }) => item.shedCode === 'S01',
      ),
    ).toBe(true);
    expect(shed.body.items.length).toBeLessThan(wide.body.items.length);
    expect(shed.body.summary.matureCount).toBeLessThan(
      wide.body.summary.matureCount,
    );

    const narrow = await request(app.getHttpServer())
      .get('/api/v1/harvest/daily')
      .query({
        from: new Date(start.getTime() + 2 * 60 * 60 * 1000).toISOString(),
        to: late.toISOString(),
      })
      .set('x-test-role', 'super_admin');

    expect(narrow.status).toBe(200);
    expect(narrow.body.items).toEqual([
      expect.objectContaining({
        id: 'rec-s02',
        shedCode: 'S02',
        cameraCode: 'CAM-HF-S02',
        matureCount: 9,
        mushroomCount: 17,
      }),
    ]);
    expect(narrow.body.items.length).toBeLessThan(wide.body.items.length);
    expect(narrow.body.summary.matureCount).toBeLessThan(
      wide.body.summary.matureCount,
    );

    const dayOnly = await request(app.getHttpServer())
      .get('/api/v1/harvest/daily')
      .query({ date: day })
      .set('x-test-role', 'super_admin');

    expect(dayOnly.status).toBe(200);
    expect(dayOnly.body.from).toBeNull();
    expect(
      dayOnly.body.items.map((item: { id: string }) => item.id).sort(),
    ).toEqual(['rec-s01', 'rec-s02']);

    const denied = await request(app.getHttpServer())
      .get('/api/v1/harvest/daily')
      .query({ shedCode: 'S02' })
      .set('x-test-role', 'shed_manager');
    expect(denied.status).toBe(403);

    const reversed = await request(app.getHttpServer())
      .get('/api/v1/harvest/daily')
      .query({ from: late.toISOString(), to: early.toISOString() })
      .set('x-test-role', 'super_admin');
    expect(reversed.status).toBe(400);
    expect(reversed.body.message).toBe('时间筛选无效');

    const half = await request(app.getHttpServer())
      .get('/api/v1/harvest/daily')
      .query({ from: early.toISOString() })
      .set('x-test-role', 'super_admin');
    expect(half.status).toBe(400);
    expect(half.body.message).toBe('时间筛选无效');
  });
});
