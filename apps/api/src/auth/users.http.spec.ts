import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
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
import { User } from '../entities/user.entity';
import { UsersController } from './users.controller';

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

function memoryUsers(rows: User[]) {
  return {
    rows,
    findOne: async ({ where }: { where: { username?: string } }) =>
      rows.find((row) => row.username === where.username) ?? null,
    find: async () =>
      rows
        .slice()
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    create: (input: Partial<User>) => ({ ...input }),
    save: async (input: Partial<User>) => {
      const saved = {
        ...input,
        id: input.id ?? `user-${rows.length + 1}`,
        createdAt: input.createdAt ?? new Date(),
      } as User;
      const index = rows.findIndex((row) => row.id === saved.id);
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

describe('users rbac', () => {
  let app: INestApplication;
  const audit = memoryAudit();
  let users: ReturnType<typeof memoryUsers>;

  beforeEach(async () => {
    audit.rows.splice(0, audit.rows.length);
    const passwordHash = await bcrypt.hash('Old@123456', 4);
    users = memoryUsers([
      {
        id: 'user-admin',
        username: 'admin',
        passwordHash,
        displayName: '系统管理员',
        role: 'super_admin',
        shedCodes: [],
        enabled: true,
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
      },
      {
        id: 'user-viewer',
        username: 'viewer',
        passwordHash,
        displayName: '旧查看',
        role: 'viewer',
        shedCodes: ['S02'],
        enabled: false,
        createdAt: new Date('2026-09-02T00:00:00.000Z'),
      },
    ]);
    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        AuditService,
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: getRepositoryToken(User), useValue: users },
        { provide: getRepositoryToken(AuditLog), useValue: audit },
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

  it('lists users for super_admin and hides the password hash', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('x-test-role', 'super_admin');

    expect(response.status).toBe(200);
    expect(response.body.map((row: { username: string }) => row.username)).toEqual([
      'admin',
      'viewer',
    ]);
    expect(JSON.stringify(response.body)).not.toContain('password');
    expect(JSON.stringify(response.body)).not.toContain(users.rows[0].passwordHash);
  });

  it.each(['production_admin', 'shed_manager', 'viewer'] as const)(
    'rejects %s on GET and POST /users',
    async (role) => {
      const listed = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('x-test-role', role);
      expect(listed.status).toBe(403);

      const created = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('x-test-role', role)
        .send({
          username: 'other',
          password: 'Other@123456',
          displayName: '其他人',
          role: 'viewer',
          shedCodes: ['S01'],
        });
      expect(created.status).toBe(403);
      expect(users.rows.map((row) => row.username)).toEqual(['admin', 'viewer']);
    },
  );

  it('creates a user and resets an existing one only when asked', async () => {
    const conflict = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('x-test-role', 'super_admin')
      .send({
        username: 'viewer',
        password: 'Viewer@123456',
        displayName: '只读查看',
        role: 'viewer',
        shedCodes: ['S01'],
      });
    expect(conflict.status).toBe(409);
    expect(conflict.body.message).toBe('用户名已存在');
    expect(users.rows).toHaveLength(2);

    const reset = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('x-test-role', 'super_admin')
      .send({
        username: 'viewer',
        password: 'Viewer@123456',
        displayName: '只读查看',
        role: 'viewer',
        shedCodes: ['S01'],
        resetPassword: true,
      });
    expect(reset.status).toBe(201);
    expect(reset.body).toMatchObject({
      id: 'user-viewer',
      username: 'viewer',
      displayName: '只读查看',
      role: 'viewer',
      shedCodes: ['S01'],
    });
    expect(JSON.stringify(reset.body)).not.toContain('Viewer@123456');
    const viewer = users.rows.find((row) => row.username === 'viewer');
    expect(viewer?.enabled).toBe(true);
    expect(viewer?.shedCodes).toEqual(['S01']);
    expect(await bcrypt.compare('Viewer@123456', viewer!.passwordHash)).toBe(true);
    expect(users.rows).toHaveLength(2);
    expect(audit.rows.map((row) => row.action)).toEqual(['user.update']);

    const created = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('x-test-role', 'super_admin')
      .send({
        username: 'night',
        password: 'Night@123456',
        displayName: '夜班查看',
        role: 'viewer',
        shedCodes: ['S03'],
      });
    expect(created.status).toBe(201);
    expect(created.body.username).toBe('night');
    expect(users.rows).toHaveLength(3);
    expect(audit.rows.map((row) => row.action)).toEqual(['user.update', 'user.create']);
  });
});
