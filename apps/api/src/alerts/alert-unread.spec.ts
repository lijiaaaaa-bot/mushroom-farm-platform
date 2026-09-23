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

class MemoryUnreadQuery {
  private userId: string | null = null;
  private unreadOnly = false;
  private blocked = false;
  private sheds: string[] | null = null;
  private limit: number | null = null;

  constructor(
    private readonly alerts: Alert[],
    private readonly reads: AlertRead[],
  ) {}

  leftJoin(
    _entity: unknown,
    _alias: string,
    condition: string,
    params?: { userId?: string },
  ) {
    if (condition.includes('userId') && params?.userId) {
      this.userId = params.userId;
    }
    return this;
  }

  where(condition: string) {
    if (condition.includes('r.id IS NULL')) this.unreadOnly = true;
    return this;
  }

  andWhere(
    condition: string,
    params?: { codes?: string[]; shedCode?: string },
  ) {
    if (condition.includes('1 = 0')) this.blocked = true;
    if (params?.codes) this.sheds = params.codes;
    if (params?.shedCode) this.sheds = [params.shedCode];
    return this;
  }

  orderBy() {
    return this;
  }

  take(limit: number) {
    this.limit = limit;
    return this;
  }

  skip() {
    return this;
  }

  private match() {
    if (this.blocked) return [] as Alert[];
    let items = [...this.alerts];
    if (this.sheds) {
      const sheds = this.sheds;
      items = items.filter((row) => sheds.includes(row.shedCode));
    }
    if (this.unreadOnly) {
      const userId = this.userId;
      const readIds = new Set(
        this.reads
          .filter((row) => row.userId === userId)
          .map((row) => row.alertId),
      );
      items = items.filter((row) => !readIds.has(row.id));
    }
    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return items;
  }

  async getMany() {
    const items = this.match();
    return this.limit === null ? items : items.slice(0, this.limit);
  }

  async getCount() {
    return this.match().length;
  }
}

function memoryAlerts(reads: AlertRead[]) {
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
    createQueryBuilder: () => new MemoryUnreadQuery(rows, reads),
  };
}

function memoryReads() {
  const rows: AlertRead[] = [];
  return {
    rows,
    create: (input: Partial<AlertRead>) => input,
    findOne: async (query: {
      where: { userId?: string; alertId?: string };
    }) =>
      rows.find(
        (row) =>
          row.userId === query.where.userId &&
          row.alertId === query.where.alertId,
      ) ?? null,
    save: async (input: Partial<AlertRead>) => {
      const saved = {
        id: input.id ?? `read-${rows.length + 1}`,
        userId: input.userId ?? '',
        alertId: input.alertId ?? '',
        readAt: input.readAt ?? new Date(),
      } as AlertRead;
      const index = rows.findIndex(
        (row) =>
          row.userId === saved.userId && row.alertId === saved.alertId,
      );
      if (index >= 0) rows[index] = saved;
      else rows.push(saved);
      return saved;
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
      shedCodes: sheds ? sheds.split(',').filter((code) => code.length > 0) : [],
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

describe('alert unread HTTP', () => {
  let app: INestApplication;
  const reads = memoryReads();
  const alerts = memoryAlerts(reads.rows);

  beforeEach(async () => {
    alerts.rows.splice(0, alerts.rows.length);
    reads.rows.splice(0, reads.rows.length);
    const moduleRef = await Test.createTestingModule({
      controllers: [AlertsController],
      providers: [
        AlertsService,
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: getRepositoryToken(AlertRule), useValue: {} },
        { provide: getRepositoryToken(Alert), useValue: alerts },
        { provide: getRepositoryToken(AlertRead), useValue: reads },
        { provide: AuditService, useValue: { write: jest.fn() } },
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

  async function createAlert(shedCode: string, title: string) {
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
    return response.body as { id: string; shedCode: string; title: string };
  }

  async function unread(role: string, id: string, sheds = '') {
    const response = await request(app.getHttpServer())
      .get('/api/v1/alerts/unread')
      .set(auth(role, id, sheds));
    expect(response.status).toBe(200);
    return response.body as {
      unreadCount: number;
      items: { id: string; level: string; shedCode: string; title: string }[];
    };
  }

  it('raises unread counts for in-scope roles after an alert is created', async () => {
    expect(await unread('production_admin', 'id-producer')).toMatchObject({
      unreadCount: 0,
      items: [],
    });
    expect(await unread('shed_manager', 'id-s01', 'S01')).toMatchObject({
      unreadCount: 0,
    });
    expect(await unread('shed_manager', 'id-s02', 'S02')).toMatchObject({
      unreadCount: 0,
    });

    const created = await createAlert('S01', '一号棚高温');

    const producer = await unread('production_admin', 'id-producer');
    expect(producer.unreadCount).toBe(1);
    expect(producer.items).toEqual([
      expect.objectContaining({
        id: created.id,
        level: 'severe',
        shedCode: 'S01',
        title: '一号棚高温',
      }),
    ]);
    expect(await unread('shed_manager', 'id-s01', 'S01')).toMatchObject({
      unreadCount: 1,
    });
    expect(await unread('shed_manager', 'id-s02', 'S02')).toMatchObject({
      unreadCount: 0,
      items: [],
    });
    expect(await unread('viewer', 'id-view', 'S01')).toMatchObject({
      unreadCount: 1,
    });

    await createAlert('S02', '二号棚高温');
    expect(await unread('production_admin', 'id-producer')).toMatchObject({
      unreadCount: 2,
    });
    const lead = await unread('shed_manager', 'id-s01', 'S01');
    expect(lead.unreadCount).toBe(1);
    expect(lead.items.map((item) => item.shedCode)).toEqual(['S01']);
    expect(await unread('shed_manager', 'id-s02', 'S02')).toMatchObject({
      unreadCount: 1,
    });
    expect(await unread('viewer', 'id-none', '')).toMatchObject({
      unreadCount: 0,
      items: [],
    });
  });

  it('marks one or all read for the current user and keeps other sheds out', async () => {
    const first = await createAlert('S01', '一号棚高温');
    const second = await createAlert('S02', '二号棚高温');

    const denied = await request(app.getHttpServer())
      .post(`/api/v1/alerts/${second.id}/read`)
      .set(auth('shed_manager', 'id-s01', 'S01'));
    expect(denied.status).toBe(403);
    expect(await unread('shed_manager', 'id-s02', 'S02')).toMatchObject({
      unreadCount: 1,
    });

    const marked = await request(app.getHttpServer())
      .post(`/api/v1/alerts/${first.id}/read`)
      .set(auth('shed_manager', 'id-s01', 'S01'));
    expect(marked.status).toBe(200);
    expect(marked.body).toEqual({ id: first.id, read: true });
    expect(await unread('shed_manager', 'id-s01', 'S01')).toMatchObject({
      unreadCount: 0,
      items: [],
    });
    expect(await unread('production_admin', 'id-producer')).toMatchObject({
      unreadCount: 2,
    });

    const again = await request(app.getHttpServer())
      .post(`/api/v1/alerts/${first.id}/read`)
      .set(auth('shed_manager', 'id-s01', 'S01'));
    expect(again.status).toBe(200);
    expect(reads.rows.filter((row) => row.userId === 'id-s01')).toHaveLength(1);

    const all = await request(app.getHttpServer())
      .post('/api/v1/alerts/read-all')
      .set(auth('production_admin', 'id-producer'));
    expect(all.status).toBe(200);
    expect(all.body).toEqual({ marked: 2 });
    expect(await unread('production_admin', 'id-producer')).toMatchObject({
      unreadCount: 0,
      items: [],
    });
    const otherShed = await unread('shed_manager', 'id-s02', 'S02');
    expect(otherShed.unreadCount).toBe(1);
    expect(otherShed.items[0]).toMatchObject({
      id: second.id,
      shedCode: 'S02',
    });
  });
});
