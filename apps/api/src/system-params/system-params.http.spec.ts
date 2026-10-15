import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  Role,
  parseSystemParams,
  parseSystemParamsPatchResult,
} from '@mushroom/contracts';
import { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { AuditService } from '../audit';
import { AuthUser } from '../common/auth-user';
import { RolesGuard } from '../common/guards';
import { configureApp } from '../configure-app';
import { SystemParam } from '../entities/system-param.entity';
import { SystemParamsController } from './system-params.controller';
import { SystemParamsService } from './system-params.service';

function memoryParams() {
  let row: SystemParam | null = null;
  return {
    get row() {
      return row;
    },
    findOne: async () => row,
    create: (input: Partial<SystemParam>) => ({ ...input }) as SystemParam,
    save: async (input: SystemParam) => {
      row = {
        id: 1,
        imageRetentionDays: input.imageRetentionDays,
        timeseriesRetentionDays: input.timeseriesRetentionDays,
        alertUnreadPollSeconds: input.alertUnreadPollSeconds,
        updatedAt: input.updatedAt ?? null,
        updatedBy: input.updatedBy ?? null,
      };
      return row;
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
      username: role === 'super_admin' ? 'admin' : role,
      displayName: role,
      role: role as Role,
      shedCodes: ['S01'],
    };
  }
  next();
}

describe('system params', () => {
  let app: INestApplication;
  let rows: ReturnType<typeof memoryParams>;
  const audit = { write: jest.fn().mockResolvedValue(undefined) };

  beforeEach(async () => {
    rows = memoryParams();
    audit.write.mockClear();
    const moduleRef = await Test.createTestingModule({
      controllers: [SystemParamsController],
      providers: [
        SystemParamsService,
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: getRepositoryToken(SystemParam), useValue: rows },
        { provide: AuditService, useValue: audit },
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

  it('returns the contract defaults before anyone saves', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/system-params')
      .set('x-test-role', 'super_admin');

    expect(response.status).toBe(200);
    expect(parseSystemParams(response.body).ok).toBe(true);
    expect(response.body).toEqual({
      imageRetentionDays: 30,
      timeseriesRetentionDays: 90,
      alertUnreadPollSeconds: 15,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it('writes the unread poll and keeps the two retention days', async () => {
    const patched = await request(app.getHttpServer())
      .patch('/api/v1/system-params')
      .set('x-test-role', 'super_admin')
      .send({ alertUnreadPollSeconds: 45 });

    expect(patched.status).toBe(200);
    expect(parseSystemParamsPatchResult(patched.body).ok).toBe(true);
    expect(patched.body.alertUnreadPollSeconds).toBe(45);
    expect(patched.body.imageRetentionDays).toBe(30);
    expect(patched.body.timeseriesRetentionDays).toBe(90);
    expect(patched.body.updatedBy).toBe('admin');
    expect(patched.body.changes).toEqual([
      {
        key: 'alertUnreadPollSeconds',
        label: '告警未读轮询',
        beforeText: '15 秒',
        afterText: '45 秒',
      },
    ]);
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'system_params.update',
        resource: 'system_params',
      }),
    );

    const listed = await request(app.getHttpServer())
      .get('/api/v1/system-params')
      .set('x-test-role', 'super_admin');
    expect(listed.status).toBe(200);
    expect(listed.body.alertUnreadPollSeconds).toBe(45);
    expect(listed.body.imageRetentionDays).toBe(30);
    expect(listed.body.timeseriesRetentionDays).toBe(90);
    expect(rows.row?.alertUnreadPollSeconds).toBe(45);
  });

  it('rejects an unchanged value, an empty body, and a secret field', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/system-params')
      .set('x-test-role', 'super_admin')
      .send({ alertUnreadPollSeconds: 45 });
    audit.write.mockClear();

    const same = await request(app.getHttpServer())
      .patch('/api/v1/system-params')
      .set('x-test-role', 'super_admin')
      .send({ alertUnreadPollSeconds: 45 });
    expect(same.status).toBe(400);
    expect(same.body.message).toBe('没有改动');

    const empty = await request(app.getHttpServer())
      .patch('/api/v1/system-params')
      .set('x-test-role', 'super_admin')
      .send({});
    expect(empty.status).toBe(400);

    const secret = await request(app.getHttpServer())
      .patch('/api/v1/system-params')
      .set('x-test-role', 'super_admin')
      .send({ alertUnreadPollSeconds: 30, password: 'secret' });
    expect(secret.status).toBe(400);
    expect(JSON.stringify(secret.body)).not.toContain('secret');
    expect(audit.write).not.toHaveBeenCalled();
    expect(rows.row?.alertUnreadPollSeconds).toBe(45);
  });

  it.each(['production_admin', 'shed_manager', 'viewer'] as const)(
    'rejects %s on GET and PATCH /system-params',
    async (role) => {
      const listed = await request(app.getHttpServer())
        .get('/api/v1/system-params')
        .set('x-test-role', role);
      expect(listed.status).toBe(403);

      const patched = await request(app.getHttpServer())
        .patch('/api/v1/system-params')
        .set('x-test-role', role)
        .send({ imageRetentionDays: 7 });
      expect(patched.status).toBe(403);
      expect(rows.row).toBeNull();
      expect(audit.write).not.toHaveBeenCalled();
    },
  );
});
