import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Role } from '@mushroom/contracts';
import { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { AuditService } from '../audit';
import { AuthUser } from '../common/auth-user';
import { RolesGuard } from '../common/guards';
import { configureApp } from '../configure-app';
import { Alert } from '../entities/alert.entity';
import { AlertRead } from '../entities/alert-read.entity';
import { AlertRule } from '../entities/alert-rule.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import { MinioStorageService } from '../storage';
import { AlertEngineService } from './alert-engine.service';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const objectKey = 'snapshots/S01/2026-10-14/CAM-SNAP-01/1.jpg';

function record(key: string | null = objectKey): RecognitionRecord {
  return {
    id: 'rec-snap-1',
    shedCode: 'S01',
    cameraCode: 'CAM-SNAP-01',
    mushroomCount: 12,
    matureCount: 5,
    diseaseCount: 1,
    diseaseLevel: 1,
    temperature: 30,
    humidity: 88,
    co2: 900,
    substrateMoisture: 70,
    recognizedAt: new Date('2026-10-14T01:02:03.004Z'),
    snapshotObjectKey: key,
  } as RecognitionRecord;
}

function temperatureRule() {
  return {
    id: 'rule-temp',
    enabled: true,
    shedCode: null,
    metric: 'temperature_high',
    threshold: 28,
    level: 'severe',
    windowMinutes: 60,
  };
}

function engineWith(open: Partial<Alert> | null) {
  const saved: Partial<Alert>[] = [];
  const alerts = {
    findOne: async () => open,
    create: (input: Partial<Alert>) => input,
    save: async (input: Partial<Alert>) => {
      const row = { ...input, id: input.id ?? 'alert-snap-1' };
      saved.push(row);
      if (open && input.id === open.id) Object.assign(open, row);
      return row;
    },
  };
  const rules = { find: async () => [temperatureRule()] };
  const engine = new AlertEngineService(
    rules as never,
    alerts as never,
    {} as never,
  );
  return { engine, saved, open };
}

describe('alert engine snapshot key', () => {
  it('stores the recognition object key on a new alert', async () => {
    const { engine, saved } = engineWith(null);
    await engine.evaluate(record());
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      cameraCode: 'CAM-SNAP-01',
      recognitionId: 'rec-snap-1',
      snapshotObjectKey: objectKey,
      metric: 'temperature_high',
      metricValue: 30,
    });
  });

  it('fills an open alert that still has no object key', async () => {
    const open: Partial<Alert> = {
      id: 'alert-old',
      ruleId: 'rule-temp',
      cameraCode: 'CAM-SNAP-01',
      status: 'open',
      snapshotObjectKey: null,
      recognitionId: null,
    };
    const { engine, saved } = engineWith(open);
    await engine.evaluate(record());
    expect(saved).toEqual([
      expect.objectContaining({
        id: 'alert-old',
        recognitionId: 'rec-snap-1',
        snapshotObjectKey: objectKey,
      }),
    ]);
    expect(open.snapshotObjectKey).toBe(objectKey);
  });

  it('leaves an open alert object key in place', async () => {
    const open: Partial<Alert> = {
      id: 'alert-old',
      snapshotObjectKey: 'snapshots/S01/2026-10-14/CAM-SNAP-01/0.jpg',
      recognitionId: 'rec-older',
    };
    const { engine, saved } = engineWith(open);
    await engine.evaluate(record());
    expect(saved).toHaveLength(0);
    expect(open.snapshotObjectKey).toBe(
      'snapshots/S01/2026-10-14/CAM-SNAP-01/0.jpg',
    );
  });

  it('does not store an unsafe object key', async () => {
    const { engine, saved } = engineWith(null);
    await engine.evaluate(record('../secret.jpg'));
    expect(saved[0].snapshotObjectKey).toBeNull();
    expect(saved[0].recognitionId).toBe('rec-snap-1');
  });
});

const ROLES = [
  'super_admin',
  'production_admin',
  'shed_manager',
  'viewer',
] as const;

function memoryAlerts() {
  const rows: Alert[] = [];
  return {
    rows,
    create: (input: Partial<Alert>) => input,
    save: async (input: Partial<Alert>) => {
      const saved = {
        ...input,
        id: input.id ?? `alert-${rows.length + 1}`,
        createdAt: input.createdAt ?? new Date(),
      } as Alert;
      rows.push(saved);
      return saved;
    },
    findOne: async (query: { where: { id?: string } }) =>
      rows.find((row) => row.id === query.where.id) ?? null,
    createQueryBuilder: () => {
      throw new Error('list is not used');
    },
  };
}

function assignUser(
  req: Request & { user?: AuthUser },
  _res: Response,
  next: NextFunction,
) {
  const role = req.header('x-test-role');
  if (role && (ROLES as readonly string[]).includes(role)) {
    const sheds = req.header('x-test-sheds');
    req.user = {
      id: req.header('x-test-user') || `id-${role}`,
      username: req.header('x-test-user') || role,
      displayName: role,
      role: role as Role,
      shedCodes: sheds
        ? sheds.split(',').filter((code) => code.length > 0)
        : [],
    };
  }
  next();
}

function auth(role: string, id: string, sheds = '') {
  return {
    'x-test-role': role,
    'x-test-user': id,
    'x-test-sheds': sheds,
  };
}

describe('GET /alerts/:id/snapshot', () => {
  let app: INestApplication;
  const alerts = memoryAlerts();
  const objects = new Map<string, Buffer>();

  beforeEach(async () => {
    alerts.rows.splice(0, alerts.rows.length);
    objects.clear();
    objects.set(objectKey, jpeg);
    const moduleRef = await Test.createTestingModule({
      controllers: [AlertsController],
      providers: [
        AlertsService,
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: getRepositoryToken(AlertRule), useValue: {} },
        { provide: getRepositoryToken(Alert), useValue: alerts },
        { provide: getRepositoryToken(AlertRead), useValue: {} },
        { provide: AuditService, useValue: { write: jest.fn() } },
        {
          provide: MinioStorageService,
          useValue: {
            readObject: async (key: string) => objects.get(key) ?? null,
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

  function seed(key: string | null) {
    alerts.rows.push({
      id: 'alert-snap',
      shedCode: 'S01',
      cameraCode: 'CAM-SNAP-01',
      level: 'severe',
      status: 'open',
      title: '温度过高告警',
      message: '棚区 S01 摄像头 CAM-SNAP-01 温度过高 30，阈值 28',
      snapshotObjectKey: key,
      recognitionId: key ? 'rec-snap-1' : null,
      createdAt: new Date('2026-10-14T01:02:03.004Z'),
    } as Alert);
  }

  it('returns the stored JPEG and the detail names the object key', async () => {
    seed(objectKey);
    const detail = await request(app.getHttpServer())
      .get('/api/v1/alerts/alert-snap')
      .set(auth('viewer', 'viewer-s01', 'S01'));
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      id: 'alert-snap',
      snapshotObjectKey: objectKey,
      recognitionId: 'rec-snap-1',
    });

    const shot = await request(app.getHttpServer())
      .get('/api/v1/alerts/alert-snap/snapshot')
      .set(auth('viewer', 'viewer-s01', 'S01'))
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(shot.status).toBe(200);
    expect(shot.headers['content-type']).toMatch(/image\/jpeg/);
    expect(Buffer.compare(shot.body as Buffer, jpeg)).toBe(0);
  });

  it('says there is no snapshot when the alert has no object key', async () => {
    seed(null);
    const shot = await request(app.getHttpServer())
      .get('/api/v1/alerts/alert-snap/snapshot')
      .set(auth('super_admin', 'id-super'));
    expect(shot.status).toBe(404);
    expect(shot.body.message).toBe('无抓拍');
  });

  it('hides another shed snapshot', async () => {
    seed(objectKey);
    const shot = await request(app.getHttpServer())
      .get('/api/v1/alerts/alert-snap/snapshot')
      .set(auth('shed_manager', 'shed-b', 'S02'));
    expect(shot.status).toBe(403);
    expect(objects.get(objectKey)).toEqual(jpeg);
  });
});
