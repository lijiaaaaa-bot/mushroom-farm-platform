import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FindManyOptions } from 'typeorm';
import { Role, parseBackupStatus } from '@mushroom/contracts';
import { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { AuthUser } from '../common/auth-user';
import { RolesGuard } from '../common/guards';
import { configureApp } from '../configure-app';
import { PostgresBackupRun } from '../entities/postgres-backup-run.entity';
import { BACKUP_RUNNER, BackupRunResult } from './backup.runner';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';

function memoryRuns() {
  const rows: PostgresBackupRun[] = [];
  return {
    rows,
    create: (input: Partial<PostgresBackupRun>) => ({ ...input }),
    save: async (input: Partial<PostgresBackupRun>) => {
      const saved = {
        ...input,
        id: input.id ?? `run-${rows.length + 1}`,
      } as PostgresBackupRun;
      rows.push(saved);
      return saved;
    },
    find: async (options?: FindManyOptions<PostgresBackupRun>) => {
      const where = options?.where as { status?: PostgresBackupRun['status'] } | undefined;
      let list = rows.slice();
      if (where?.status) list = list.filter((row) => row.status === where.status);
      list.sort((a, b) => b.finishedAt.getTime() - a.finishedAt.getTime());
      return list.slice(0, options?.take ?? list.length);
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

describe('postgres backup status', () => {
  let app: INestApplication;
  let runs: ReturnType<typeof memoryRuns>;
  const queue: BackupRunResult[] = [];

  beforeEach(async () => {
    queue.splice(0, queue.length);
    runs = memoryRuns();
    const moduleRef = await Test.createTestingModule({
      controllers: [BackupController],
      providers: [
        BackupService,
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: getRepositoryToken(PostgresBackupRun), useValue: runs },
        {
          provide: BACKUP_RUNNER,
          useValue: async () => {
            const next = queue.shift();
            if (!next) throw new Error('no scripted backup');
            return next;
          },
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

  it('reads an empty status for super_admin', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/backups/status')
      .set('x-test-role', 'super_admin');

    expect(response.status).toBe(200);
    const parsed = parseBackupStatus(response.body);
    expect(parsed.ok).toBe(true);
    expect(response.body).toEqual({
      lastSuccessAt: null,
      lastRunAt: null,
      lastStatus: 'never',
      lastFileName: null,
      lastBytes: null,
      lastError: null,
      triggeredBy: null,
    });
  });

  it('records a successful run and keeps that time when the next run fails', async () => {
    queue.push({
      exitCode: 0,
      file: '/var/backups/mushroom-20261015T030000Z.sql',
      bytes: 128,
    });
    const success = await request(app.getHttpServer())
      .post('/api/v1/backups/run')
      .set('x-test-role', 'super_admin');

    expect(success.status).toBe(201);
    expect(parseBackupStatus(success.body).ok).toBe(true);
    expect(success.body.lastStatus).toBe('success');
    expect(success.body.lastSuccessAt).toBe(success.body.lastRunAt);
    expect(success.body.lastFileName).toBe('mushroom-20261015T030000Z.sql');
    expect(success.body.lastBytes).toBe(128);
    expect(success.body.lastError).toBeNull();
    expect(success.body.triggeredBy).toBe('admin');
    expect(JSON.stringify(success.body)).not.toContain('/var/backups');
    expect(JSON.stringify(success.body)).not.toContain('password');

    queue.push({
      exitCode: 1,
      file: '/var/backups/mushroom-20261015T040000Z.sql',
      errorMessage: 'failed postgres://mushroom:secret@127.0.0.1:5432/mushroom',
    });
    const failed = await request(app.getHttpServer())
      .post('/api/v1/backups/run')
      .set('x-test-role', 'super_admin');

    expect(failed.status).toBe(201);
    expect(parseBackupStatus(failed.body).ok).toBe(true);
    expect(failed.body.lastStatus).toBe('failed');
    expect(failed.body.lastSuccessAt).toBe(success.body.lastSuccessAt);
    expect(Date.parse(failed.body.lastRunAt)).toBeGreaterThanOrEqual(
      Date.parse(success.body.lastRunAt),
    );
    expect(failed.body.lastFileName).toBe('mushroom-20261015T040000Z.sql');
    expect(failed.body.lastBytes).toBeNull();
    expect(failed.body.lastError).toContain('postgresql://…');
    expect(JSON.stringify(failed.body)).not.toContain('secret');
    expect(runs.rows).toHaveLength(2);

    const listed = await request(app.getHttpServer())
      .get('/api/v1/backups/status')
      .set('x-test-role', 'super_admin');
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual(failed.body);
  });

  it.each(['production_admin', 'shed_manager', 'viewer'] as const)(
    'rejects %s on GET and POST /backups',
    async (role) => {
      const listed = await request(app.getHttpServer())
        .get('/api/v1/backups/status')
        .set('x-test-role', role);
      expect(listed.status).toBe(403);

      queue.push({ exitCode: 0, file: '/tmp/mushroom.sql', bytes: 1 });
      const started = await request(app.getHttpServer())
        .post('/api/v1/backups/run')
        .set('x-test-role', role);
      expect(started.status).toBe(403);
      expect(runs.rows).toHaveLength(0);
      expect(queue).toHaveLength(1);
    },
  );

  it('rejects a request without a role', async () => {
    const listed = await request(app.getHttpServer()).get('/api/v1/backups/status');
    expect(listed.status).toBe(403);
    const started = await request(app.getHttpServer()).post('/api/v1/backups/run');
    expect(started.status).toBe(403);
    expect(runs.rows).toHaveLength(0);
  });
});
