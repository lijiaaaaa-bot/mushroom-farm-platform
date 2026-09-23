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

const WRITE_ROLES = ['super_admin', 'production_admin'] as const;
const READ_ROLES = ['shed_manager', 'viewer'] as const;

function memoryRules() {
  const rows: AlertRule[] = [];
  return {
    rows,
    find: async () =>
      [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    findOne: async ({ where }: { where: { id: string } }) =>
      rows.find((row) => row.id === where.id) ?? null,
    create: (input: Partial<AlertRule>) => input,
    save: async (input: Partial<AlertRule>) => {
      if (input.id) {
        const index = rows.findIndex((row) => row.id === input.id);
        if (index >= 0) {
          rows[index] = input as AlertRule;
          return rows[index];
        }
      }
      const saved = {
        ...input,
        id: input.id ?? `rule-${rows.length + 1}`,
        createdAt: input.createdAt ?? new Date(),
      } as AlertRule;
      rows.push(saved);
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

describe('alert-rules HTTP', () => {
  let app: INestApplication;
  const rules = memoryRules();
  const body = {
    name: '高温规则',
    metric: 'temperature_high',
    threshold: 35,
    level: 'warning',
    windowMinutes: 60,
  };

  beforeEach(async () => {
    rules.rows.splice(0, rules.rows.length);
    const moduleRef = await Test.createTestingModule({
      controllers: [AlertsController],
      providers: [
        AlertsService,
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: getRepositoryToken(AlertRule), useValue: rules },
        { provide: getRepositoryToken(Alert), useValue: {} },
        { provide: getRepositoryToken(AlertRead), useValue: {} },
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

  it.each(WRITE_ROLES)(
    '%s can create a rule, patch it, and list the new values',
    async (role) => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/alert-rules')
        .set('x-test-role', role)
        .send(body);

      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        name: '高温规则',
        metric: 'temperature_high',
        threshold: 35,
        level: 'warning',
        enabled: true,
        windowMinutes: 60,
      });

      const patched = await request(app.getHttpServer())
        .patch(`/api/v1/alert-rules/${created.body.id}`)
        .set('x-test-role', role)
        .send({
          enabled: false,
          threshold: 41,
          level: 'severe',
          windowMinutes: 30,
        });

      expect(patched.status).toBe(200);
      expect(patched.body).toMatchObject({
        id: created.body.id,
        enabled: false,
        threshold: 41,
        level: 'severe',
        windowMinutes: 30,
      });

      const listed = await request(app.getHttpServer())
        .get('/api/v1/alert-rules')
        .set('x-test-role', role);

      expect(listed.status).toBe(200);
      expect(listed.body).toEqual([
        expect.objectContaining({
          id: created.body.id,
          name: '高温规则',
          enabled: false,
          threshold: 41,
          level: 'severe',
          windowMinutes: 30,
        }),
      ]);
    },
  );

  it.each(READ_ROLES)('%s cannot create or patch alert rules', async (role) => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/alert-rules')
      .set('x-test-role', 'super_admin')
      .send(body);
    expect(created.status).toBe(201);

    const deniedCreate = await request(app.getHttpServer())
      .post('/api/v1/alert-rules')
      .set('x-test-role', role)
      .send({ ...body, name: '越权规则' });
    expect(deniedCreate.status).toBe(403);

    const deniedPatch = await request(app.getHttpServer())
      .patch(`/api/v1/alert-rules/${created.body.id}`)
      .set('x-test-role', role)
      .send({ enabled: false, threshold: 1 });
    expect(deniedPatch.status).toBe(403);

    const listed = await request(app.getHttpServer())
      .get('/api/v1/alert-rules')
      .set('x-test-role', 'super_admin');
    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0]).toMatchObject({
      id: created.body.id,
      name: '高温规则',
      enabled: true,
      threshold: 35,
    });
  });

  it('rejects a rule whose metric is not in the contract', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/alert-rules')
      .set('x-test-role', 'super_admin')
      .send({ ...body, metric: 'not-a-metric' });

    expect(response.status).toBe(400);
    expect(rules.rows).toHaveLength(0);
  });
});
