import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Role } from '@mushroom/contracts';
import { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { getMetadataArgsStorage, QueryFailedError } from 'typeorm';
import { AuditService } from '../audit';
import { AuthUser } from '../common/auth-user';
import { RolesGuard } from '../common/guards';
import { configureApp } from '../configure-app';
import { Alert } from '../entities/alert.entity';
import { AlertRead } from '../entities/alert-read.entity';
import { AlertRule } from '../entities/alert-rule.entity';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';

type EntityClass = abstract new (...args: never[]) => object;

/** 与 Postgres 对未标注列的默认一致：string / 未写 type → character varying。 */
export function columnPostgresType(
  target: EntityClass,
  propertyName: string,
): string | null {
  const column = getMetadataArgsStorage().columns.find(
    (item) => item.target === target && item.propertyName === propertyName,
  );
  if (!column) return null;
  const type = column.options.type;
  if (type === 'uuid') return 'uuid';
  if (
    type === undefined ||
    type === String ||
    type === 'varchar' ||
    type === 'character varying'
  ) {
    return 'character varying';
  }
  return String(type);
}

/**
 * 内存查询替身复现 Postgres 的列对列比较：varchar = uuid 在 getCount 前失败。
 * 参数比较（r.userId = :userId）不在此列。
 */
export function assertPostgresColumnEquality(
  condition: string,
  typeOf: (alias: string, property: string) => string | null,
) {
  const comparison =
    /\b([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)\s*=\s*([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)/g;
  for (const match of condition.matchAll(comparison)) {
    const left = typeOf(match[1], match[2]);
    const right = typeOf(match[3], match[4]);
    if (!left || !right || left === right) continue;
    if (
      (left === 'uuid' && right === 'character varying') ||
      (left === 'character varying' && right === 'uuid')
    ) {
      throw new QueryFailedError(
        condition,
        [],
        new Error('operator does not exist: character varying = uuid'),
      );
    }
  }
}

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
    assertPostgresColumnEquality(condition, (alias, property) => {
      if (alias === 'a') return columnPostgresType(Alert, property);
      if (alias === 'r') return columnPostgresType(AlertRead, property);
      return null;
    });
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
    findOne: async (query: { where: { userId?: string; alertId?: string } }) =>
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
        (row) => row.userId === saved.userId && row.alertId === saved.alertId,
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

  it('counts unread alerts when alert_reads.alert_id is uuid', async () => {
    expect(columnPostgresType(AlertRead, 'alertId')).toBe('uuid');
    expect(columnPostgresType(Alert, 'id')).toBe('uuid');
    const created = await createAlert('S01', '未读计数');
    const body = await unread('viewer', 'id-view', 'S01');
    expect(body.unreadCount).toBe(1);
    expect(body.items).toEqual([
      expect.objectContaining({
        id: created.id,
        level: 'severe',
        shedCode: 'S01',
        title: '未读计数',
      }),
    ]);
  });

  it('rejects a varchar = uuid unread join before getCount', () => {
    expect(() =>
      assertPostgresColumnEquality(
        'r.alertId = a.id AND r.userId = :userId',
        (alias, property) => {
          if (alias === 'r' && property === 'alertId') {
            return 'character varying';
          }
          if (alias === 'a' && property === 'id') return 'uuid';
          return null;
        },
      ),
    ).toThrow(/operator does not exist: character varying = uuid/);
  });

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

describe('alert_reads.alert_id migrations', () => {
  const migrationsDir = join(__dirname, '../../../../infra/migrations');
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(join(migrationsDir, name), 'utf8'),
    }));

  function alertIdTypeAfterMigrations() {
    let type: string | null = null;
    for (const file of files) {
      if (/CREATE TABLE IF NOT EXISTS alert_reads\b/i.test(file.sql)) {
        const created = file.sql.match(
          /alert_id\s+(uuid|varchar|character varying)\b/i,
        );
        type = created ? created[1].toLowerCase() : null;
      }
      if (
        /ALTER\s+COLUMN\s+alert_id\s+TYPE\s+uuid\b/i.test(file.sql) &&
        /::uuid/.test(file.sql)
      ) {
        type = 'uuid';
      }
    }
    return type;
  }

  it('creates alert_id as uuid and upgrades old varchar columns', () => {
    const create = files.find((file) => file.name === '002_alert_reads.sql');
    const upgrade = files.find(
      (file) => file.name === '007_alert_reads_alert_id_uuid.sql',
    );
    expect(create?.sql).toMatch(/alert_id uuid NOT NULL/);
    expect(create?.sql).not.toMatch(/alert_id varchar/);
    expect(upgrade?.sql).toMatch(/IF col_type = 'uuid' THEN\s+RETURN;/);
    const guardAt = upgrade?.sql.indexOf("IF col_type = 'uuid'") ?? -1;
    const deleteAt = upgrade?.sql.search(/DELETE FROM alert_reads/i) ?? -1;
    const alterAt =
      upgrade?.sql.search(
        /ALTER TABLE alert_reads\s+ALTER COLUMN alert_id TYPE uuid USING btrim\(alert_id\)::uuid/i,
      ) ?? -1;
    expect(guardAt).toBeGreaterThan(-1);
    expect(deleteAt).toBeGreaterThan(guardAt);
    expect(alterAt).toBeGreaterThan(deleteAt);
    expect(upgrade?.sql).toContain("btrim(alert_id) = ''");
    expect(upgrade?.sql).toContain(
      "btrim(alert_id) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'",
    );
    expect(alertIdTypeAfterMigrations()).toBe('uuid');
    expect(
      readFileSync(join(__dirname, 'alerts.service.ts'), 'utf8'),
    ).toContain('r.alertId = a.id');
  });
});
