import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Role } from '@mushroom/contracts';
import bcrypt from 'bcryptjs';
import { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { AuditService } from '../audit';
import { AuthUser } from '../common/auth-user';
import { RolesGuard } from '../common/guards';
import { configureApp } from '../configure-app';
import { AuditLog } from '../entities/audit-log.entity';
import { LoginLog } from '../entities/login-log.entity';
import { User } from '../entities/user.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginLogService } from './login-log.service';

const ROLES = [
  'super_admin',
  'production_admin',
  'shed_manager',
  'viewer',
] as const;

function memoryAudit() {
  const rows: AuditLog[] = [];
  return {
    rows,
    create: (input: Partial<AuditLog>) => ({ ...input }),
    save: async (input: Partial<AuditLog>) => {
      const saved = {
        ...input,
        id: input.id ?? `audit-${rows.length + 1}`,
        createdAt: input.createdAt ?? new Date(),
      } as AuditLog;
      rows.push(saved);
      return saved;
    },
  };
}

function memoryLogs() {
  return {
    create: (input: Partial<LoginLog>) => ({ ...input }),
    save: async (input: Partial<LoginLog>) => input,
  };
}

function memoryUsers(rows: User[]) {
  return {
    rows,
    findOne: async ({ where }: { where: { username?: string; id?: string } }) =>
      rows.find((row) => {
        if (where.id !== undefined && row.id !== where.id) return false;
        if (where.username !== undefined && row.username !== where.username) {
          return false;
        }
        return where.id !== undefined || where.username !== undefined;
      }) ?? null,
    save: async (input: User) => {
      const index = rows.findIndex((row) => row.id === input.id);
      if (index >= 0) rows[index] = input;
      else rows.push(input);
      return input;
    },
  };
}

function assignUser(
  req: Request & { user?: AuthUser },
  _res: Response,
  next: NextFunction,
) {
  const named = req.header('x-test-user');
  if (named === 'ghost') {
    req.user = {
      id: 'missing',
      username: 'ghost',
      displayName: 'ghost',
      role: 'viewer',
      shedCodes: [],
    };
    next();
    return;
  }
  if (named === 'disabled') {
    req.user = {
      id: 'id-disabled',
      username: 'disabled',
      displayName: '停用',
      role: 'viewer',
      shedCodes: ['S01'],
    };
    next();
    return;
  }
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

describe('change own password', () => {
  let app: INestApplication;
  const audit = memoryAudit();
  let users: ReturnType<typeof memoryUsers>;

  beforeEach(async () => {
    audit.rows.splice(0, audit.rows.length);
    const passwordHash = await bcrypt.hash('Old@123456', 4);
    users = memoryUsers([
      ...ROLES.map(
        (role) =>
          ({
            id: `id-${role}`,
            username: role,
            passwordHash,
            displayName: role,
            role,
            shedCodes: ['S01'],
            enabled: true,
            createdAt: new Date('2026-09-01T00:00:00.000Z'),
          }) as User,
      ),
      {
        id: 'id-disabled',
        username: 'disabled',
        passwordHash,
        displayName: '停用',
        role: 'viewer',
        shedCodes: ['S01'],
        enabled: false,
        createdAt: new Date('2026-09-02T00:00:00.000Z'),
      },
    ]);
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        LoginLogService,
        AuditService,
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: getRepositoryToken(User), useValue: users },
        { provide: getRepositoryToken(LoginLog), useValue: memoryLogs() },
        { provide: getRepositoryToken(AuditLog), useValue: audit },
        {
          provide: JwtService,
          useValue: { signAsync: async () => 'token-next' },
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

  it('lets each role replace only their own password', async () => {
    for (const role of ROLES) {
      const before = new Map(
        users.rows.map((row) => [row.username, row.passwordHash]),
      );
      const next = `New@${role}1`;
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .set('x-test-role', role)
        .send({ currentPassword: 'Old@123456', newPassword: next });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ username: role, changed: true });
      expect(JSON.stringify(response.body)).not.toMatch(/password/i);
      const self = users.rows.find((row) => row.username === role);
      expect(await bcrypt.compare(next, self!.passwordHash)).toBe(true);
      expect(await bcrypt.compare('Old@123456', self!.passwordHash)).toBe(
        false,
      );
      for (const row of users.rows) {
        if (row.username === role) continue;
        expect(row.passwordHash).toBe(before.get(row.username));
      }
    }
    expect(audit.rows.map((row) => row.action)).toEqual(
      ROLES.map(() => 'auth.password_change'),
    );
    for (const row of audit.rows) {
      expect(JSON.stringify(row.detail)).not.toMatch(/Old@|New@/);
      expect(row.detail).toEqual({ username: row.username });
    }
  });

  it('rejects the old password at login and accepts the new one', async () => {
    const changed = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('x-test-role', 'viewer')
      .send({ currentPassword: 'Old@123456', newPassword: 'PwdNew@123456' });
    expect(changed.status).toBe(200);

    const stale = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: 'viewer', password: 'Old@123456' });
    expect(stale.status).toBe(401);
    expect(stale.body.message).toBe('用户名或密码错误');

    const fresh = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: 'viewer', password: 'PwdNew@123456' });
    expect(fresh.status).toBe(201);
    expect(fresh.body.accessToken).toBe('token-next');
    expect(fresh.body.user.username).toBe('viewer');
  });

  it('keeps the hash when the current password is wrong or unchanged', async () => {
    const before = users.rows.find(
      (row) => row.username === 'viewer',
    )!.passwordHash;
    const wrong = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('x-test-role', 'viewer')
      .send({ currentPassword: 'Wrong@123456', newPassword: 'PwdNew@123456' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.message).toBe('当前密码不正确');

    const same = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('x-test-role', 'viewer')
      .send({ currentPassword: 'Old@123456', newPassword: 'Old@123456' });
    expect(same.status).toBe(400);
    expect(same.body.message).toBe('新密码不能与当前密码相同');
    expect(
      users.rows.find((row) => row.username === 'viewer')!.passwordHash,
    ).toBe(before);
    expect(audit.rows).toHaveLength(0);
  });

  it('rejects a short password, an extra field, a disabled account, and a missing user', async () => {
    const short = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('x-test-role', 'viewer')
      .send({ currentPassword: 'Old@123456', newPassword: 'short' });
    expect(short.status).toBe(400);
    expect(short.body.code).toBe('VALIDATION_FAILED');

    const extra = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('x-test-role', 'viewer')
      .send({
        currentPassword: 'Old@123456',
        newPassword: 'PwdNew@123456',
        username: 'admin',
      });
    expect(extra.status).toBe(400);
    expect(extra.body.code).toBe('UNKNOWN_FIELD');

    const disabled = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('x-test-user', 'disabled')
      .send({ currentPassword: 'Old@123456', newPassword: 'PwdNew@123456' });
    expect(disabled.status).toBe(400);
    expect(disabled.body.message).toBe('账号已停用');

    const missing = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('x-test-user', 'ghost')
      .send({ currentPassword: 'Old@123456', newPassword: 'PwdNew@123456' });
    expect(missing.status).toBe(404);

    const anonymous = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: 'Old@123456', newPassword: 'PwdNew@123456' });
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.message).toBe('请先登录');
    expect(audit.rows).toHaveLength(0);
  });
});
