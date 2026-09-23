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
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';

const ROLES = [
  'super_admin',
  'production_admin',
  'shed_manager',
  'viewer',
] as const;

class MemoryAlertQuery {
  private blocked = false;
  private sheds: string[] | null = null;
  private status: string | null = null;
  private skipN = 0;
  private takeN: number | null = null;

  constructor(private readonly alerts: Alert[]) {}

  orderBy() {
    return this;
  }

  andWhere(
    condition: string,
    params?: { codes?: string[]; shedCode?: string; status?: string },
  ) {
    if (condition.includes('1 = 0')) this.blocked = true;
    if (params?.codes) this.sheds = params.codes;
    if (params?.shedCode) this.sheds = [params.shedCode];
    if (params?.status) this.status = params.status;
    return this;
  }

  skip(n: number) {
    this.skipN = n;
    return this;
  }

  take(n: number) {
    this.takeN = n;
    return this;
  }

  private match() {
    if (this.blocked) return [] as Alert[];
    let items = [...this.alerts];
    if (this.sheds) {
      const sheds = this.sheds;
      items = items.filter((row) => sheds.includes(row.shedCode));
    }
    if (this.status) {
      const status = this.status;
      items = items.filter((row) => row.status === status);
    }
    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return items;
  }

  async getManyAndCount() {
    const items = this.match();
    const end = this.takeN === null ? undefined : this.skipN + this.takeN;
    return [items.slice(this.skipN, end), items.length] as [Alert[], number];
  }
}

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
      const index = rows.findIndex((row) => row.id === saved.id);
      if (index >= 0) rows[index] = saved;
      else rows.push(saved);
      return saved;
    },
    findOne: async (query: { where: { id?: string } }) =>
      rows.find((row) => row.id === query.where.id) ?? null,
    createQueryBuilder: () => new MemoryAlertQuery(rows),
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

describe('alert claim and false-positive close', () => {
  let app: INestApplication;
  const alerts = memoryAlerts();
  const auditWrite = jest.fn();

  beforeEach(async () => {
    alerts.rows.splice(0, alerts.rows.length);
    auditWrite.mockReset();
    const moduleRef = await Test.createTestingModule({
      controllers: [AlertsController],
      providers: [
        AlertsService,
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: getRepositoryToken(AlertRule), useValue: {} },
        { provide: getRepositoryToken(Alert), useValue: alerts },
        {
          provide: getRepositoryToken(AlertRead),
          useValue: {
            findOne: async () => null,
            create: (input: unknown) => input,
          },
        },
        { provide: AuditService, useValue: { write: auditWrite } },
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

  async function createAlert(shedCode = 'S01', title = '高温') {
    const response = await request(app.getHttpServer())
      .post('/api/v1/alerts')
      .set(auth('super_admin', 'id-super'))
      .send({
        shedCode,
        level: 'severe',
        title,
        message: `${title}说明`,
      });
    expect(response.status).toBe(201);
    return response.body as { id: string; shedCode: string };
  }

  it('records the claimant and shows it to another operator in the same shed', async () => {
    const created = await createAlert();
    const claim = await request(app.getHttpServer())
      .post(`/api/v1/alerts/${created.id}/claim`)
      .set(auth('shed_manager', 'shed-a', 'S01'))
      .send({ note: '我来跟进' });
    expect(claim.status).toBe(201);
    expect(claim.body).toMatchObject({
      id: created.id,
      status: 'open',
      claimedBy: 'shed-a',
      claimNote: '我来跟进',
    });
    expect(claim.body.claimedAt).toEqual(expect.any(String));
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'alert.claim',
        resource: `alert:${created.id}`,
        detail: { note: '我来跟进', claimedBy: 'shed-a' },
      }),
    );

    const listed = await request(app.getHttpServer())
      .get('/api/v1/alerts?pageSize=50')
      .set(auth('shed_manager', 'shed-b', 'S01'));
    expect(listed.status).toBe(200);
    expect(listed.body.items).toEqual([
      expect.objectContaining({
        id: created.id,
        claimedBy: 'shed-a',
        claimNote: '我来跟进',
      }),
    ]);

    const outsider = await request(app.getHttpServer())
      .get('/api/v1/alerts?pageSize=50')
      .set(auth('shed_manager', 'shed-c', 'S02'));
    expect(outsider.status).toBe(200);
    expect(outsider.body.items).toEqual([]);
  });

  it('closes a false positive with a different reason from a normal close and audits both', async () => {
    const normalTarget = await createAlert('S01', '湿度');
    const falseTarget = await createAlert('S01', '病害');

    const normal = await request(app.getHttpServer())
      .post(`/api/v1/alerts/${normalTarget.id}/close`)
      .set(auth('production_admin', 'producer'))
      .send({ note: '已恢复' });
    expect(normal.status).toBe(201);
    expect(normal.body).toMatchObject({
      status: 'closed',
      closeReason: 'resolved',
      closeNote: '已恢复',
      closedBy: 'producer',
    });

    const falsePositive = await request(app.getHttpServer())
      .post(`/api/v1/alerts/${falseTarget.id}/false-positive`)
      .set(auth('production_admin', 'producer'))
      .send({ note: '传感器抖动' });
    expect(falsePositive.status).toBe(201);
    expect(falsePositive.body).toMatchObject({
      status: 'closed',
      closeReason: 'false_positive',
      closeNote: '传感器抖动',
      closedBy: 'producer',
    });
    expect(falsePositive.body.closeReason).toBe('false_positive');
    expect(normal.body.closeReason).toBe('resolved');

    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'alert.close',
        resource: `alert:${normalTarget.id}`,
        detail: { note: '已恢复', closeReason: 'resolved' },
      }),
    );
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'alert.false_positive',
        resource: `alert:${falseTarget.id}`,
        detail: { note: '传感器抖动', closeReason: 'false_positive' },
      }),
    );
  });

  it('rejects a false-positive close without a note and a claim after close', async () => {
    const created = await createAlert();
    auditWrite.mockClear();
    const missing = await request(app.getHttpServer())
      .post(`/api/v1/alerts/${created.id}/false-positive`)
      .set(auth('shed_manager', 'shed-a', 'S01'))
      .send({});
    expect(missing.status).toBe(400);

    const blank = await request(app.getHttpServer())
      .post(`/api/v1/alerts/${created.id}/false-positive`)
      .set(auth('shed_manager', 'shed-a', 'S01'))
      .send({ note: '   ' });
    expect(blank.status).toBe(400);
    expect(auditWrite).not.toHaveBeenCalled();

    const closed = await request(app.getHttpServer())
      .post(`/api/v1/alerts/${created.id}/close`)
      .set(auth('shed_manager', 'shed-a', 'S01'))
      .send({ note: '处理完' });
    expect(closed.status).toBe(201);

    const again = await request(app.getHttpServer())
      .post(`/api/v1/alerts/${created.id}/claim`)
      .set(auth('shed_manager', 'shed-a', 'S01'))
      .send({ note: '太晚了' });
    expect(again.status).toBe(400);
    expect(alerts.rows[0].claimedBy).toBeNull();
  });

  it('forbids viewers and out-of-shed managers from claim, false-positive, and close', async () => {
    const created = await createAlert('S01', '离线');
    auditWrite.mockClear();
    const cases = [
      auth('viewer', 'viewer-s01', 'S01'),
      auth('shed_manager', 'shed-s02', 'S02'),
    ];
    for (const headers of cases) {
      const claim = await request(app.getHttpServer())
        .post(`/api/v1/alerts/${created.id}/claim`)
        .set(headers)
        .send({ note: '越权' });
      const falsePositive = await request(app.getHttpServer())
        .post(`/api/v1/alerts/${created.id}/false-positive`)
        .set(headers)
        .send({ note: '越权' });
      const close = await request(app.getHttpServer())
        .post(`/api/v1/alerts/${created.id}/close`)
        .set(headers)
        .send({ note: '越权' });
      expect(claim.status).toBe(403);
      expect(falsePositive.status).toBe(403);
      expect(close.status).toBe(403);
    }
    expect(alerts.rows[0]).toMatchObject({
      status: 'open',
      claimedBy: null,
      closeReason: null,
    });
    expect(auditWrite).not.toHaveBeenCalled();

    const reader = await request(app.getHttpServer())
      .get('/api/v1/alerts?pageSize=50')
      .set(auth('viewer', 'viewer-s01', 'S01'));
    expect(reader.status).toBe(200);
    expect(reader.body.items).toEqual([
      expect.objectContaining({ id: created.id, shedCode: 'S01' }),
    ]);
  });
});
