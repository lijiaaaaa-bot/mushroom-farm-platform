import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Role } from '@mushroom/contracts';
import bcrypt from 'bcryptjs';
import { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { FindOperator } from 'typeorm';
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
import { LoginLogsController } from './login-logs.controller';

function memoryUsers(rows: User[]) {
  return {
    findOne: async ({ where }: { where: { username: string } }) =>
      rows.find((row) => row.username === where.username) ?? null,
  };
}

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

function memoryLoginLogs() {
  const rows: LoginLog[] = [];
  return {
    rows,
    create: (input: Partial<LoginLog>) => ({ ...input }),
    save: async (input: Partial<LoginLog>) => {
      const saved = {
        ...input,
        id: input.id ?? `login-${rows.length + 1}`,
        createdAt: input.createdAt ?? new Date(),
      } as LoginLog;
      rows.push(saved);
      return saved;
    },
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
        LoginLog[],
        number,
      ];
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

describe('login logs', () => {
  let app: INestApplication;
  const logs = memoryLoginLogs();
  const audit = memoryAudit();
  let users: User[];

  beforeEach(async () => {
    logs.rows.splice(0, logs.rows.length);
    audit.rows.splice(0, audit.rows.length);
    const passwordHash = await bcrypt.hash('Secret@123', 4);
    users = [
      {
        id: 'user-admin',
        username: 'admin',
        passwordHash,
        displayName: '超管',
        role: 'super_admin',
        shedCodes: [],
        enabled: true,
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
      },
      {
        id: 'user-disabled',
        username: 'disabled',
        passwordHash,
        displayName: '停用',
        role: 'viewer',
        shedCodes: ['S01'],
        enabled: false,
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    ];
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController, LoginLogsController],
      providers: [
        AuthService,
        LoginLogService,
        AuditService,
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: getRepositoryToken(User), useValue: memoryUsers(users) },
        { provide: getRepositoryToken(LoginLog), useValue: logs },
        { provide: getRepositoryToken(AuditLog), useValue: audit },
        {
          provide: JwtService,
          useValue: { signAsync: async () => 'token-admin' },
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

  it('records a failed login with the attempted username, ip, and user-agent', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('User-Agent', 'shed-console/1')
      .send({ username: 'missing', password: 'nope' });

    expect(response.status).toBe(401);
    expect(logs.rows).toHaveLength(1);
    expect(logs.rows[0]).toMatchObject({
      userId: null,
      username: 'missing',
      result: 'failure',
      userAgent: 'shed-console/1',
    });
    expect(logs.rows[0].ip).toEqual(expect.any(String));
    expect(audit.rows.map((row) => row.action)).toEqual(['auth.login_failed']);
    expect(JSON.stringify(logs.rows[0])).not.toContain('nope');
  });

  it('records success and lists it for super_admin and production_admin', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('User-Agent', 'shed-console/1')
      .send({ username: 'admin', password: 'Secret@123' });

    expect(response.status).toBe(201);
    expect(response.body.accessToken).toBe('token-admin');
    expect(logs.rows[0]).toMatchObject({
      userId: 'user-admin',
      username: 'admin',
      result: 'success',
      userAgent: 'shed-console/1',
    });

    const listed = await request(app.getHttpServer())
      .get('/api/v1/login-logs')
      .set('x-test-role', 'super_admin');
    expect(listed.status).toBe(200);
    expect(listed.body.total).toBe(1);
    expect(listed.body.items[0]).toMatchObject({
      username: 'admin',
      result: 'success',
      userAgent: 'shed-console/1',
    });

    const producer = await request(app.getHttpServer())
      .get('/api/v1/login-logs?username=admin')
      .set('x-test-role', 'production_admin');
    expect(producer.status).toBe(200);
    expect(producer.body.items).toHaveLength(1);
  });

  it('hides login logs from shed managers and viewers', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: 'Secret@123' });

    for (const role of ['shed_manager', 'viewer'] as const) {
      const response = await request(app.getHttpServer())
        .get('/api/v1/login-logs')
        .set('x-test-role', role);
      expect(response.status).toBe(403);
    }
  });

  it('filters by username and time, and rejects a bad time bound', async () => {
    logs.rows.push(
      {
        id: 'login-old',
        userId: 'user-admin',
        username: 'admin',
        result: 'success',
        ip: '10.0.0.1',
        userAgent: 'old',
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
      },
      {
        id: 'login-new',
        userId: null,
        username: 'missing',
        result: 'failure',
        ip: '10.0.0.2',
        userAgent: 'new',
        createdAt: new Date('2026-09-20T00:00:00.000Z'),
      },
    );

    const filtered = await request(app.getHttpServer())
      .get('/api/v1/login-logs')
      .query({
        username: 'missing',
        from: '2026-09-10T00:00:00.000Z',
        to: '2026-09-30T00:00:00.000Z',
      })
      .set('x-test-role', 'super_admin');
    expect(filtered.status).toBe(200);
    expect(filtered.body.items.map((row: LoginLog) => row.id)).toEqual([
      'login-new',
    ]);

    const bad = await request(app.getHttpServer())
      .get('/api/v1/login-logs')
      .query({ from: 'not-a-date' })
      .set('x-test-role', 'super_admin');
    expect(bad.status).toBe(400);
  });

  it('records a disabled account as failure and keeps the known user id', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: 'disabled', password: 'Secret@123' });
    expect(response.status).toBe(401);
    expect(logs.rows[0]).toMatchObject({
      userId: 'user-disabled',
      username: 'disabled',
      result: 'failure',
    });
  });
});
