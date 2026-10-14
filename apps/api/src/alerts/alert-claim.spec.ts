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
  private camera: string | null = null;
  private titleKeyword: string | null = null;
  private skipN = 0;
  private takeN: number | null = null;

  constructor(private readonly alerts: Alert[]) {}

  orderBy() {
    return this;
  }

  andWhere(
    condition: string,
    params?: {
      codes?: string[];
      shedCode?: string;
      status?: string;
      cameraCode?: string;
      titleKeyword?: string;
    },
  ) {
    if (condition.includes('1 = 0')) this.blocked = true;
    if (params?.codes) this.sheds = params.codes;
    if (params?.shedCode) this.sheds = [params.shedCode];
    if (params?.status) this.status = params.status;
    if (params?.cameraCode) this.camera = params.cameraCode;
    if (params?.titleKeyword) this.titleKeyword = params.titleKeyword;
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
    if (this.camera) {
      const camera = this.camera;
      items = items.filter((row) => row.cameraCode === camera);
    }
    if (this.titleKeyword) {
      const needle = this.titleKeyword.toLowerCase();
      items = items.filter((row) =>
        (row.title || '').toLowerCase().includes(needle),
      );
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

  async function createAlert(
    shedCode = 'S01',
    title = '高温',
    cameraCode?: string,
    message?: string,
  ) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/alerts')
      .set(auth('super_admin', 'id-super'))
      .send({
        shedCode,
        level: 'severe',
        title,
        message: message ?? `${title}说明`,
        ...(cameraCode ? { cameraCode } : {}),
      });
    expect(response.status).toBe(201);
    return response.body as {
      id: string;
      shedCode: string;
      cameraCode: string | null;
    };
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

  it('returns one alert for the detail page and keeps shed isolation', async () => {
    const created = await createAlert('S01', '高温');
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/alerts/${created.id}`)
      .set(auth('viewer', 'viewer-s01', 'S01'));
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      id: created.id,
      shedCode: 'S01',
      level: 'severe',
      status: 'open',
      title: '高温',
      message: '高温说明',
    });

    const missing = await request(app.getHttpServer())
      .get('/api/v1/alerts/missing-alert')
      .set(auth('super_admin', 'id-super'));
    expect(missing.status).toBe(404);

    const outsider = await request(app.getHttpServer())
      .get(`/api/v1/alerts/${created.id}`)
      .set(auth('shed_manager', 'shed-s02', 'S02'));
    expect(outsider.status).toBe(403);
  });

  it('acks a pending alert and a later read still shows acked', async () => {
    const created = await createAlert('S01', '温度过高告警');
    const ack = await request(app.getHttpServer())
      .post(`/api/v1/alerts/${created.id}/ack`)
      .set(auth('shed_manager', 'shed-a', 'S01'))
      .send({ note: '已确认' });
    expect(ack.status).toBe(201);
    expect(ack.body).toMatchObject({
      id: created.id,
      status: 'acked',
      ackedBy: 'shed-a',
      ackNote: '已确认',
    });
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'alert.ack',
        resource: `alert:${created.id}`,
        detail: { note: '已确认' },
      }),
    );

    const listed = await request(app.getHttpServer())
      .get('/api/v1/alerts?status=acked&pageSize=50')
      .set(auth('shed_manager', 'shed-b', 'S01'));
    expect(listed.status).toBe(200);
    expect(listed.body.items).toEqual([
      expect.objectContaining({
        id: created.id,
        status: 'acked',
        ackNote: '已确认',
      }),
    ]);

    const stillOpen = await request(app.getHttpServer())
      .get('/api/v1/alerts?status=open&pageSize=50')
      .set(auth('shed_manager', 'shed-b', 'S01'));
    expect(stillOpen.body.items).toEqual([]);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/alerts/${created.id}`)
      .set(auth('viewer', 'viewer-s01', 'S01'));
    expect(detail.status).toBe(200);
    expect(detail.body.status).toBe('acked');

    const again = await request(app.getHttpServer())
      .post(`/api/v1/alerts/${created.id}/ack`)
      .set(auth('shed_manager', 'shed-a', 'S01'))
      .send({ note: '再确认一次' });
    expect(again.status).toBe(400);
    expect(alerts.rows[0].status).toBe('acked');
    expect(alerts.rows[0].ackNote).toBe('已确认');
  });

  it('closes a pending alert and a later read still shows closed', async () => {
    const created = await createAlert('S01', '温度过高告警');
    const closed = await request(app.getHttpServer())
      .post(`/api/v1/alerts/${created.id}/close`)
      .set(auth('production_admin', 'producer'))
      .send({ note: '已关闭' });
    expect(closed.status).toBe(201);
    expect(closed.body).toMatchObject({
      id: created.id,
      status: 'closed',
      closeReason: 'resolved',
      closeNote: '已关闭',
      closedBy: 'producer',
    });

    const listed = await request(app.getHttpServer())
      .get('/api/v1/alerts?status=closed&pageSize=50')
      .set(auth('super_admin', 'id-super'));
    expect(listed.status).toBe(200);
    expect(listed.body.items).toEqual([
      expect.objectContaining({
        id: created.id,
        status: 'closed',
        closeReason: 'resolved',
        closeNote: '已关闭',
      }),
    ]);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/alerts/${created.id}`)
      .set(auth('super_admin', 'id-super'));
    expect(detail.body).toMatchObject({
      status: 'closed',
      closeReason: 'resolved',
      closeNote: '已关闭',
    });

    const open = await request(app.getHttpServer())
      .get('/api/v1/alerts?status=open&pageSize=50')
      .set(auth('super_admin', 'id-super'));
    expect(open.body.items).toEqual([]);
  });

  it('filters pending and closed alerts apart and still opens each detail', async () => {
    const pending = await createAlert('S01', '待确认筛选告警', 'CAM-STATUS-01');
    const finished = await createAlert(
      'S01',
      '已关闭筛选告警',
      'CAM-STATUS-02',
    );
    const closed = await request(app.getHttpServer())
      .post(`/api/v1/alerts/${finished.id}/close`)
      .set(auth('production_admin', 'producer'))
      .send({ note: '已关闭' });
    expect(closed.status).toBe(201);
    expect(closed.body.status).toBe('closed');

    const openList = await request(app.getHttpServer())
      .get('/api/v1/alerts?status=open&pageSize=50')
      .set(auth('super_admin', 'id-super'));
    expect(openList.status).toBe(200);
    expect(openList.body.items).toEqual([
      expect.objectContaining({
        id: pending.id,
        status: 'open',
        title: '待确认筛选告警',
        cameraCode: 'CAM-STATUS-01',
      }),
    ]);

    const closedList = await request(app.getHttpServer())
      .get('/api/v1/alerts?status=closed&pageSize=50')
      .set(auth('super_admin', 'id-super'));
    expect(closedList.status).toBe(200);
    expect(closedList.body.items).toEqual([
      expect.objectContaining({
        id: finished.id,
        status: 'closed',
        title: '已关闭筛选告警',
        cameraCode: 'CAM-STATUS-02',
      }),
    ]);

    const all = await request(app.getHttpServer())
      .get('/api/v1/alerts?shedCode=S01&pageSize=50')
      .set(auth('super_admin', 'id-super'));
    expect(all.status).toBe(200);
    expect(all.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: pending.id, status: 'open' }),
        expect.objectContaining({ id: finished.id, status: 'closed' }),
      ]),
    );

    const openDetail = await request(app.getHttpServer())
      .get(`/api/v1/alerts/${pending.id}`)
      .set(auth('super_admin', 'id-super'));
    expect(openDetail.status).toBe(200);
    expect(openDetail.body.status).toBe('open');

    const closedDetail = await request(app.getHttpServer())
      .get(`/api/v1/alerts/${finished.id}`)
      .set(auth('super_admin', 'id-super'));
    expect(closedDetail.status).toBe(200);
    expect(closedDetail.body).toMatchObject({
      status: 'closed',
      closeReason: 'resolved',
      closeNote: '已关闭',
    });
  });

  it('filters the alert list by camera code and keeps detail readable', async () => {
    const east = await createAlert('S01', '东侧过道告警', 'CAM-FILTER-01');
    const west = await createAlert('S01', '西侧过道告警', 'CAM-FILTER-02');
    const plain = await createAlert('S01', '无摄像头');

    const filtered = await request(app.getHttpServer())
      .get('/api/v1/alerts?cameraCode=CAM-FILTER-02&pageSize=50')
      .set(auth('super_admin', 'id-super'));
    expect(filtered.status).toBe(200);
    expect(filtered.body.total).toBe(1);
    expect(filtered.body.items).toEqual([
      expect.objectContaining({
        id: west.id,
        cameraCode: 'CAM-FILTER-02',
        title: '西侧过道告警',
      }),
    ]);

    const padded = await request(app.getHttpServer())
      .get('/api/v1/alerts?cameraCode=%20CAM-FILTER-02%20&pageSize=50')
      .set(auth('super_admin', 'id-super'));
    expect(padded.body.items.map((row: { id: string }) => row.id)).toEqual([
      west.id,
    ]);

    const blank = await request(app.getHttpServer())
      .get('/api/v1/alerts?cameraCode=%20%20&pageSize=50')
      .set(auth('super_admin', 'id-super'));
    expect(blank.body.total).toBe(3);
    expect(blank.body.items.map((row: { id: string }) => row.id)).toEqual(
      expect.arrayContaining([east.id, west.id, plain.id]),
    );

    const restored = await request(app.getHttpServer())
      .get('/api/v1/alerts?pageSize=50')
      .set(auth('super_admin', 'id-super'));
    expect(restored.body.items.map((row: { id: string }) => row.id)).toEqual(
      expect.arrayContaining([east.id, west.id, plain.id]),
    );

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/alerts/${west.id}`)
      .set(auth('super_admin', 'id-super'));
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      id: west.id,
      cameraCode: 'CAM-FILTER-02',
      shedCode: 'S01',
    });

    const outsider = await request(app.getHttpServer())
      .get('/api/v1/alerts?cameraCode=CAM-FILTER-02&pageSize=50')
      .set(auth('shed_manager', 'shed-c', 'S02'));
    expect(outsider.status).toBe(200);
    expect(outsider.body.items).toEqual([]);
  });

  it('filters the alert list by title keyword and keeps detail readable', async () => {
    const east = await createAlert('S01', '东侧标题搜索告警', 'CAM-TITLE-01');
    const west = await createAlert('S01', '西侧过道对照告警', 'CAM-TITLE-02');
    const mentioned = await createAlert(
      'S01',
      '说明不含在标题',
      'CAM-TITLE-03',
      '正文里有东侧标题',
    );
    const latin = await createAlert('S01', 'EastKeyword', 'CAM-TITLE-04');
    const percent = await createAlert('S01', '湿度100%告警', 'CAM-TITLE-05');

    const filtered = await request(app.getHttpServer())
      .get(`/api/v1/alerts?q=${encodeURIComponent('东侧标题')}&pageSize=50`)
      .set(auth('super_admin', 'id-super'));
    expect(filtered.status).toBe(200);
    expect(filtered.body.total).toBe(1);
    expect(filtered.body.items).toEqual([
      expect.objectContaining({
        id: east.id,
        title: '东侧标题搜索告警',
        cameraCode: 'CAM-TITLE-01',
      }),
    ]);

    const padded = await request(app.getHttpServer())
      .get(`/api/v1/alerts?q=${encodeURIComponent('  东侧标题  ')}&pageSize=50`)
      .set(auth('super_admin', 'id-super'));
    expect(padded.body.items.map((row: { id: string }) => row.id)).toEqual([
      east.id,
    ]);

    const folded = await request(app.getHttpServer())
      .get('/api/v1/alerts?q=eastkeyword&pageSize=50')
      .set(auth('super_admin', 'id-super'));
    expect(folded.body.items.map((row: { id: string }) => row.id)).toEqual([
      latin.id,
    ]);

    const literal = await request(app.getHttpServer())
      .get(`/api/v1/alerts?q=${encodeURIComponent('%')}&pageSize=50`)
      .set(auth('super_admin', 'id-super'));
    expect(literal.body.items.map((row: { id: string }) => row.id)).toEqual([
      percent.id,
    ]);

    const blank = await request(app.getHttpServer())
      .get(`/api/v1/alerts?q=${encodeURIComponent('   ')}&pageSize=50`)
      .set(auth('super_admin', 'id-super'));
    expect(blank.body.items.map((row: { id: string }) => row.id)).toEqual(
      expect.arrayContaining([
        east.id,
        west.id,
        mentioned.id,
        latin.id,
        percent.id,
      ]),
    );

    const restored = await request(app.getHttpServer())
      .get('/api/v1/alerts?pageSize=50')
      .set(auth('super_admin', 'id-super'));
    expect(restored.body.items.map((row: { id: string }) => row.id)).toEqual(
      expect.arrayContaining([east.id, west.id, mentioned.id]),
    );

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/alerts/${east.id}`)
      .set(auth('super_admin', 'id-super'));
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      id: east.id,
      title: '东侧标题搜索告警',
      cameraCode: 'CAM-TITLE-01',
      shedCode: 'S01',
    });

    const outsider = await request(app.getHttpServer())
      .get(`/api/v1/alerts?q=${encodeURIComponent('东侧标题')}&pageSize=50`)
      .set(auth('shed_manager', 'shed-c', 'S02'));
    expect(outsider.status).toBe(200);
    expect(outsider.body.items).toEqual([]);
  });

  it('forbids a viewer from confirming a pending alert', async () => {
    const created = await createAlert();
    auditWrite.mockClear();
    const ack = await request(app.getHttpServer())
      .post(`/api/v1/alerts/${created.id}/ack`)
      .set(auth('viewer', 'viewer-s01', 'S01'))
      .send({ note: '已确认' });
    expect(ack.status).toBe(403);
    expect(alerts.rows[0].status).toBe('open');
    expect(auditWrite).not.toHaveBeenCalled();
  });
});
