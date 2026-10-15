import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Role } from '@mushroom/contracts';
import { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { FindOperator } from 'typeorm';
import { AuthUser } from '../common/auth-user';
import { RolesGuard } from '../common/guards';
import { configureApp } from '../configure-app';
import { AuditLog } from '../entities/audit-log.entity';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

function matchesWhen(createdAt: Date, operator: FindOperator<Date>) {
  const time = createdAt.getTime();
  if (operator.type === 'between' && Array.isArray(operator.value)) {
    const [start, end] = operator.value as Date[];
    return time >= start.getTime() && time <= end.getTime();
  }
  if (operator.type === 'moreThanOrEqual') {
    return time >= new Date(operator.value).getTime();
  }
  if (operator.type === 'lessThanOrEqual') {
    return time <= new Date(operator.value).getTime();
  }
  return true;
}

function memoryLogs() {
  const rows: AuditLog[] = [];
  return {
    rows,
    findAndCount: async (options?: {
      where?: { username?: string; createdAt?: FindOperator<Date> };
      skip?: number;
      take?: number;
    }) => {
      let matched = [...rows];
      if (options?.where?.username) {
        matched = matched.filter(
          (row) => row.username === options.where?.username,
        );
      }
      if (options?.where?.createdAt) {
        matched = matched.filter((row) =>
          matchesWhen(row.createdAt, options.where!.createdAt!),
        );
      }
      matched.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const skip = options?.skip ?? 0;
      const take = options?.take ?? matched.length;
      return [matched.slice(skip, skip + take), matched.length] as [
        AuditLog[],
        number,
      ];
    },
  };
}

function row(
  partial: Partial<AuditLog> & Pick<AuditLog, 'id' | 'username' | 'createdAt'>,
): AuditLog {
  return {
    userId: partial.userId ?? null,
    action: partial.action ?? 'harvest.correct',
    resource: partial.resource ?? `recognition:${partial.id}`,
    detail: partial.detail ?? null,
    ip: partial.ip ?? null,
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

describe('audit log filters', () => {
  let app: INestApplication;
  const logs = memoryLogs();

  beforeEach(async () => {
    logs.rows.splice(0, logs.rows.length);
    logs.rows.push(
      row({
        id: 'audit-old',
        username: 'audit-action-old',
        createdAt: new Date('2026-10-15T01:00:00.000Z'),
        resource: 'recognition:audit-action-old',
      }),
      row({
        id: 'audit-new',
        username: 'audit-action-new',
        createdAt: new Date('2026-10-15T04:00:00.000Z'),
        resource: 'recognition:audit-action-new',
      }),
      row({
        id: 'audit-edge',
        username: 'audit-action-new',
        createdAt: new Date('2026-10-15T04:30:00.000Z'),
        resource: 'recognition:audit-action-edge',
      }),
    );
    const moduleRef = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [
        AuditService,
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: getRepositoryToken(AuditLog), useValue: logs },
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

  it('lists every row when username and time are omitted', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/audit-logs')
      .set('x-test-role', 'super_admin');
    expect(response.status).toBe(200);
    expect(response.body.total).toBe(3);
    expect(response.body.items.map((item: AuditLog) => item.id)).toEqual([
      'audit-edge',
      'audit-new',
      'audit-old',
    ]);
  });

  it('matches the username exactly and keeps either time end optional and inclusive', async () => {
    const named = await request(app.getHttpServer())
      .get('/api/v1/audit-logs')
      .query({ username: 'audit-action-old' })
      .set('x-test-role', 'production_admin');
    expect(named.status).toBe(200);
    expect(named.body.items.map((item: AuditLog) => item.id)).toEqual([
      'audit-old',
    ]);

    const prefix = await request(app.getHttpServer())
      .get('/api/v1/audit-logs')
      .query({ username: 'audit-action' })
      .set('x-test-role', 'super_admin');
    expect(prefix.body.total).toBe(0);

    const blank = await request(app.getHttpServer())
      .get('/api/v1/audit-logs')
      .query({ username: '   ' })
      .set('x-test-role', 'super_admin');
    expect(blank.body.total).toBe(3);

    const fromOnly = await request(app.getHttpServer())
      .get('/api/v1/audit-logs')
      .query({ from: '2026-10-15T04:00:00.000Z' })
      .set('x-test-role', 'super_admin');
    expect(fromOnly.body.items.map((item: AuditLog) => item.id)).toEqual([
      'audit-edge',
      'audit-new',
    ]);

    const toOnly = await request(app.getHttpServer())
      .get('/api/v1/audit-logs')
      .query({ to: '2026-10-15T04:00:00.000Z' })
      .set('x-test-role', 'super_admin');
    expect(toOnly.body.items.map((item: AuditLog) => item.id)).toEqual([
      'audit-new',
      'audit-old',
    ]);

    const both = await request(app.getHttpServer())
      .get('/api/v1/audit-logs')
      .query({
        username: 'audit-action-new',
        from: '2026-10-15T04:00:00.000Z',
        to: '2026-10-15T04:00:00.000Z',
      })
      .set('x-test-role', 'super_admin');
    expect(both.body.items.map((item: AuditLog) => item.id)).toEqual([
      'audit-new',
    ]);
  });

  it('rejects an invalid bound and a start after the end', async () => {
    const bad = await request(app.getHttpServer())
      .get('/api/v1/audit-logs')
      .query({ from: 'not-a-date' })
      .set('x-test-role', 'super_admin');
    expect(bad.status).toBe(400);
    expect(bad.body.message).toBe('开始时间无效');

    const reversed = await request(app.getHttpServer())
      .get('/api/v1/audit-logs')
      .query({
        from: '2026-10-15T05:00:00.000Z',
        to: '2026-10-15T01:00:00.000Z',
      })
      .set('x-test-role', 'super_admin');
    expect(reversed.status).toBe(400);
    expect(reversed.body.message).toBe('时间筛选无效');
  });

  it('hides the list from shed managers and viewers', async () => {
    for (const role of ['shed_manager', 'viewer'] as const) {
      const response = await request(app.getHttpServer())
        .get('/api/v1/audit-logs')
        .query({ username: 'audit-action-old' })
        .set('x-test-role', role);
      expect(response.status).toBe(403);
    }
  });
});
