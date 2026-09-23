import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  Role,
  shanghaiDate,
  shanghaiDayRange,
  shiftShanghaiDate,
  todayShanghai,
} from '@mushroom/contracts';
import { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { AuditService } from '../audit';
import { AuthUser } from '../common/auth-user';
import { configureApp } from '../configure-app';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import { HarvestController } from './harvest.controller';
import { HarvestService } from './harvest.service';
import { projectMatureYield } from './yield-estimate';

function calendar(values: Array<number | null>) {
  return values.map((matureCount, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, '0')}`,
    matureCount,
  }));
}

describe('projectMatureYield', () => {
  const horizon = ['2026-01-31', '2026-02-01', '2026-02-02'];

  it('projects a flat series and a unit slope, and clamps below zero', () => {
    const flat = projectMatureYield({
      calendar: calendar(Array.from({ length: 30 }, () => 10)),
      horizonDates: horizon,
    });
    expect(flat.sufficient).toBe(true);
    expect(flat.label).toBe('估计');
    expect(flat.days.map((day) => day.matureCount)).toEqual([10, 10, 10]);
    expect(flat.days.map((day) => day.offsetDays)).toEqual([1, 2, 3]);

    const line = projectMatureYield({
      calendar: calendar(Array.from({ length: 30 }, (_, index) => index)),
      horizonDates: horizon,
    });
    expect(line.days.map((day) => day.matureCount)).toEqual([30, 31, 32]);

    const falling = projectMatureYield({
      calendar: calendar(Array.from({ length: 30 }, (_, index) => 3 - index)),
      horizonDates: horizon,
    });
    expect(falling.days.map((day) => day.matureCount)).toEqual([0, 0, 0]);
  });

  it('refuses numbers when any of the 30 days is missing', () => {
    const values: Array<number | null> = Array.from({ length: 30 }, () => 10);
    values[4] = null;
    const result = projectMatureYield({
      calendar: calendar(values),
      horizonDates: horizon,
    });

    expect(result.sufficient).toBe(false);
    expect(result.historyDays).toBe(29);
    expect(result.requiredDays).toBe(30);
    expect(result.days).toEqual([]);
    expect(result.message).toContain('29');
    expect(result.message).toContain('30');
    expect(result.message).not.toContain('10');
    expect(result.label).toBe('估计');
  });
});

function memoryRecords() {
  const rows: RecognitionRecord[] = [];
  return {
    rows,
    query: async (sql: string, params: unknown[]) => {
      if (!sql.includes('yield_daily'))
        throw new Error(`unexpected sql: ${sql}`);
      const start = new Date(params[0] as string | Date).getTime();
      const end = new Date(params[1] as string | Date).getTime();
      const shedCodes = params[2] as string[] | null;
      const shedFilter = (params[3] as string | null) || null;
      const inRange = rows.filter((row) => {
        const at = new Date(row.recognizedAt).getTime();
        if (at < start || at >= end) return false;
        if (shedCodes && !shedCodes.includes(row.shedCode)) return false;
        if (shedFilter && row.shedCode !== shedFilter) return false;
        return true;
      });
      const latest = new Map<string, RecognitionRecord>();
      const ordered = [...inRange].sort(
        (a, b) =>
          new Date(b.recognizedAt).getTime() -
          new Date(a.recognizedAt).getTime(),
      );
      for (const row of ordered) {
        const key = `${row.shedCode}|${row.cameraCode}|${shanghaiDate(new Date(row.recognizedAt))}`;
        if (!latest.has(key)) latest.set(key, row);
      }
      const sums = new Map<string, number>();
      for (const row of latest.values()) {
        const day = shanghaiDate(new Date(row.recognizedAt));
        sums.set(day, (sums.get(day) ?? 0) + row.matureCount);
      }
      return [...sums.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([day, matureCount]) => ({ day, matureCount }));
    },
  };
}

function sample(
  partial: Partial<RecognitionRecord> &
    Pick<RecognitionRecord, 'id' | 'shedCode' | 'cameraCode' | 'recognizedAt'>,
): RecognitionRecord {
  return {
    idempotencyKey: partial.id,
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
    rawPayload: null,
    createdAt: new Date(),
    ...partial,
  };
}

function fillShed(
  records: { rows: RecognitionRecord[] },
  input: {
    shedCode: string;
    cameraCode: string;
    matureCount: number;
    earlierMature?: number;
    days?: number;
  },
) {
  const today = todayShanghai();
  const days = input.days ?? 30;
  for (let ago = days - 1; ago >= 0; ago -= 1) {
    const date = shiftShanghaiDate(today, -ago);
    const start = shanghaiDayRange(date).start.getTime();
    if (input.earlierMature !== undefined) {
      records.rows.push(
        sample({
          id: `${input.shedCode}-${input.cameraCode}-${date}-early`,
          shedCode: input.shedCode,
          cameraCode: input.cameraCode,
          recognizedAt: new Date(start + 60_000),
          matureCount: input.earlierMature,
        }),
      );
    }
    records.rows.push(
      sample({
        id: `${input.shedCode}-${input.cameraCode}-${date}`,
        shedCode: input.shedCode,
        cameraCode: input.cameraCode,
        recognizedAt: new Date(start + 3_600_000),
        matureCount: input.matureCount,
      }),
    );
  }
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

describe('yield estimate HTTP', () => {
  let app: INestApplication;
  const records = memoryRecords();

  beforeEach(async () => {
    records.rows.splice(0, records.rows.length);
    const moduleRef = await Test.createTestingModule({
      controllers: [HarvestController],
      providers: [
        HarvestService,
        { provide: AuditService, useValue: { write: async () => undefined } },
        { provide: getRepositoryToken(RecognitionRecord), useValue: records },
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

  it('uses the latest mature count per camera and keeps other sheds out', async () => {
    fillShed(records, {
      shedCode: 'S01',
      cameraCode: 'CAM-A',
      matureCount: 10,
      earlierMature: 1,
    });
    fillShed(records, {
      shedCode: 'S01',
      cameraCode: 'CAM-B',
      matureCount: 5,
    });
    fillShed(records, {
      shedCode: 'S02',
      cameraCode: 'CAM-C',
      matureCount: 1000,
    });

    const manager = await request(app.getHttpServer())
      .get('/api/v1/harvest/yield-estimate')
      .set('x-test-role', 'shed_manager');
    const admin = await request(app.getHttpServer())
      .get('/api/v1/harvest/yield-estimate')
      .set('x-test-role', 'super_admin');
    const denied = await request(app.getHttpServer())
      .get('/api/v1/harvest/yield-estimate')
      .query({ shedCode: 'S02' })
      .set('x-test-role', 'shed_manager');

    expect(manager.status).toBe(200);
    expect(manager.body.label).toBe('估计');
    expect(manager.body.sufficient).toBe(true);
    expect(manager.body.historyDays).toBe(30);
    expect(
      manager.body.days.map((day: { matureCount: number }) => day.matureCount),
    ).toEqual([15, 15, 15]);
    expect(JSON.stringify(manager.body.days)).not.toContain('1000');
    expect(
      admin.body.days.map((day: { matureCount: number }) => day.matureCount),
    ).toEqual([1015, 1015, 1015]);
    expect(denied.status).toBe(403);
  });

  it('explains thin history for the caller shed and does not invent numbers from another shed', async () => {
    fillShed(records, {
      shedCode: 'S01',
      cameraCode: 'CAM-A',
      matureCount: 8,
      days: 2,
    });
    fillShed(records, {
      shedCode: 'S02',
      cameraCode: 'CAM-C',
      matureCount: 1000,
    });

    const manager = await request(app.getHttpServer())
      .get('/api/v1/harvest/yield-estimate')
      .set('x-test-role', 'shed_manager');
    const emptyViewer = await request(app.getHttpServer())
      .get('/api/v1/harvest/yield-estimate')
      .set('x-test-role', 'viewer')
      .set('x-test-sheds', '');

    expect(manager.status).toBe(200);
    expect(manager.body.sufficient).toBe(false);
    expect(manager.body.historyDays).toBe(2);
    expect(manager.body.days).toEqual([]);
    expect(manager.body.message).toContain('仅有 2 天');
    expect(manager.body.message).toContain('30');
    expect(manager.body.label).toBe('估计');
    expect(JSON.stringify(manager.body.days)).not.toContain('1000');
    expect(emptyViewer.body.sufficient).toBe(false);
    expect(emptyViewer.body.historyDays).toBe(0);
    expect(emptyViewer.body.days).toEqual([]);
  });
});
