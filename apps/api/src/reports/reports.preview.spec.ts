import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { shanghaiDayRange, Role } from '@mushroom/contracts';
import ExcelJS from 'exceljs';
import { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { AuthUser } from '../common/auth-user';
import { RolesGuard } from '../common/guards';
import { configureApp } from '../configure-app';
import { Alert } from '../entities/alert.entity';
import { Device } from '../entities/device.entity';
import { MetricBucketDay } from '../entities/metric-bucket.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import {
  METRIC_CAP_DIAMETER_MEAN,
  METRIC_DISEASE_COUNT,
  METRIC_ENV_TEMPERATURE,
  METRIC_MATURE_COUNT,
  METRIC_MUSHROOM_COUNT,
} from '../growth';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

function chain<T>(rows: T[]) {
  const qb = {
    where: () => qb,
    andWhere: () => qb,
    orderBy: () => qb,
    take: () => qb,
    getMany: async () => rows,
  };
  return { createQueryBuilder: () => qb };
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

describe('report preview and export HTTP', () => {
  let app: INestApplication;
  const buckets: MetricBucketDay[] = [];
  const devices: Device[] = [];
  const alerts: Alert[] = [];

  beforeEach(async () => {
    buckets.splice(0, buckets.length);
    devices.splice(0, devices.length);
    alerts.splice(0, alerts.length);
    const moduleRef = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [
        ReportsService,
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: getRepositoryToken(RecognitionRecord), useValue: chain([]) },
        {
          provide: getRepositoryToken(MetricBucketDay),
          useValue: chain(buckets),
        },
        { provide: getRepositoryToken(Device), useValue: chain(devices) },
        { provide: getRepositoryToken(Alert), useValue: chain(alerts) },
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

  it('previews weekly garden growth from day buckets and exports the same shed', async () => {
    buckets.push(
      fact('S01', '2026-09-21', METRIC_MUSHROOM_COUNT, 10),
      fact('S01', '2026-09-21', METRIC_MATURE_COUNT, 2),
      fact('S01', '2026-09-21', METRIC_CAP_DIAMETER_MEAN, 20),
      fact('S01', '2026-09-24', METRIC_MUSHROOM_COUNT, 14),
      fact('S01', '2026-09-24', METRIC_MATURE_COUNT, 7),
      fact('S01', '2026-09-24', METRIC_CAP_DIAMETER_MEAN, 30),
      fact('S02', '2026-09-24', METRIC_MUSHROOM_COUNT, 99),
    );

    const preview = await request(app.getHttpServer())
      .get('/api/v1/reports/preview')
      .query({
        kind: 'growth',
        grain: 'week',
        from: '2026-09-21',
        to: '2026-09-24',
        shedCode: 'S01',
      })
      .set('x-test-role', 'production_admin');
    expect(preview.status).toBe(200);
    expect(preview.body.title).toBe('园区生长');
    expect(preview.body.rows).toEqual([
      expect.objectContaining({
        shedCode: 'S01',
        period: '2026-09-21',
        mushroomCount: 14,
        matureCount: 7,
        capDiameterMean: 25,
      }),
    ]);

    const exported = await request(app.getHttpServer())
      .get('/api/v1/reports/export.xlsx')
      .query({
        kind: 'growth',
        grain: 'week',
        from: '2026-09-21',
        to: '2026-09-24',
        shedCode: 'S01',
      })
      .set('x-test-role', 'production_admin')
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(exported.status).toBe(200);
    expect(exported.headers['content-type']).toContain('spreadsheetml');
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(exported.body as never);
    const sheet = book.getWorksheet('园区生长');
    expect(sheet?.getRow(1).getCell(1).value).toBe('棚区');
    expect(sheet?.getRow(2).getCell(1).value).toBe('S01');
    expect(sheet?.getRow(2).getCell(3).value).toBe(14);
  });

  it('keeps another shed out of disease, device and alert ledgers', async () => {
    buckets.push(fact('S01', '2026-09-24', METRIC_DISEASE_COUNT, 2));
    buckets.push(fact('S02', '2026-09-24', METRIC_DISEASE_COUNT, 8));
    devices.push(
      device('CAM-1', 'S01', 'online'),
      device('CAM-2', 'S02', 'offline'),
    );
    alerts.push(
      alert('a1', 'S01', 'closed', '2026-09-24T01:00:00.000Z'),
      alert('a2', 'S02', 'closed', '2026-09-24T01:00:00.000Z'),
    );

    const disease = await request(app.getHttpServer())
      .get('/api/v1/reports/preview')
      .query({ kind: 'disease', from: '2026-09-24', to: '2026-09-24' })
      .set('x-test-role', 'shed_manager');
    expect(disease.body.rows).toEqual([
      expect.objectContaining({
        shedCode: 'S01',
        diseaseCount: 2,
        diseasePeak: 2,
      }),
    ]);

    const online = await request(app.getHttpServer())
      .get('/api/v1/reports/preview')
      .query({ kind: 'devices', online: 'online' })
      .set('x-test-role', 'viewer');
    expect(online.body.rows.map((row: { code: string }) => row.code)).toEqual([
      'CAM-1',
    ]);

    const closed = await request(app.getHttpServer())
      .get('/api/v1/reports/preview')
      .query({
        kind: 'alerts',
        status: 'closed',
        from: '2026-09-24',
        to: '2026-09-24',
      })
      .set('x-test-role', 'shed_manager');
    expect(closed.body.rows).toHaveLength(1);
    expect(closed.body.rows[0]).toMatchObject({
      shedCode: 'S01',
      closeReason: 'resolved',
      status: 'closed',
    });

    buckets.push(fact('S01', '2026-09-24', METRIC_MATURE_COUNT, 6));
    buckets.push(fact('S01', '2026-09-24', METRIC_CAP_DIAMETER_MEAN, 4));
    buckets.push(fact('S01', '2026-09-24', METRIC_ENV_TEMPERATURE, 18.2));
    const yieldSheet = await request(app.getHttpServer())
      .get('/api/v1/reports/preview')
      .query({ kind: 'yield', from: '2026-09-24', to: '2026-09-24' })
      .set('x-test-role', 'shed_manager');
    expect(yieldSheet.body.title).toBe('分棚产量');
    expect(yieldSheet.body.rows).toEqual([
      expect.objectContaining({
        shedCode: 'S01',
        matureCount: 6,
        capDiameterMean: 4,
      }),
    ]);
    const environment = await request(app.getHttpServer())
      .get('/api/v1/reports/preview')
      .query({ kind: 'environment', from: '2026-09-24', to: '2026-09-24' })
      .set('x-test-role', 'viewer');
    expect(environment.body.rows).toEqual([
      expect.objectContaining({ shedCode: 'S01', temperature: 18.2 }),
    ]);

    const bad = await request(app.getHttpServer())
      .get('/api/v1/reports/preview')
      .query({ kind: 'unknown' })
      .set('x-test-role', 'super_admin');
    expect(bad.status).toBe(400);
  });
});

function fact(
  shedCode: string,
  day: string,
  metric: string,
  value: number,
): MetricBucketDay {
  return {
    id: `${shedCode}-${day}-${metric}`,
    shedCode,
    cameraCode: '',
    bucketStart: shanghaiDayRange(day).start,
    metric,
    value,
    sampleCount: 1,
    valueSum: value,
    latestAt: null,
    updatedAt: shanghaiDayRange(day).start,
  };
}

function device(
  code: string,
  shedCode: string,
  onlineStatus: 'online' | 'offline',
): Device {
  return {
    id: code,
    code,
    name: code,
    type: 'camera',
    shedCode,
    parentCode: null,
    onlineStatus,
    lastSeenAt: null,
    lastHeartbeatAt: new Date('2026-09-24T00:00:00.000Z'),
    meta: {},
    createdAt: new Date('2026-09-24T00:00:00.000Z'),
  };
}

function alert(
  id: string,
  shedCode: string,
  status: 'open' | 'closed',
  createdAt: string,
): Alert {
  return {
    id,
    ruleId: null,
    metric: null,
    shedCode,
    cameraCode: 'CAM-1',
    level: 'warning',
    status,
    title: '高温',
    message: '越限',
    metricValue: 30,
    threshold: 28,
    ackedBy: null,
    ackedAt: null,
    ackNote: null,
    closedBy: status === 'closed' ? 'admin' : null,
    closedAt: status === 'closed' ? new Date(createdAt) : null,
    closeNote: null,
    closeReason: status === 'closed' ? 'resolved' : null,
    claimedBy: 'admin',
    claimedAt: new Date(createdAt),
    claimNote: null,
    createdAt: new Date(createdAt),
  };
}
