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
import { Shed } from '../entities/shed.entity';
import { ShedsController } from './sheds.controller';
import { ShedsService } from './sheds.service';

const WRITE_ROLES = ['super_admin', 'production_admin'] as const;
const READ_ROLES = ['shed_manager', 'viewer'] as const;

function shed(partial: Partial<Shed> & Pick<Shed, 'id' | 'code'>): Shed {
  return {
    name: partial.code,
    location: null,
    enabled: true,
    mapX: null,
    mapY: null,
    createdAt: new Date('2026-09-23T00:00:00.000Z'),
    ...partial,
  };
}

function memorySheds(initial: Shed[]) {
  const rows = initial.map((row) => ({ ...row }));
  return {
    rows,
    createQueryBuilder() {
      let codes: string[] | null = null;
      const qb = {
        orderBy() {
          return qb;
        },
        andWhere(_sql: string, params?: { codes?: string[] }) {
          if (params?.codes) codes = params.codes;
          return qb;
        },
        async getMany() {
          const visible = codes
            ? rows.filter((row) => codes?.includes(row.code))
            : rows;
          return visible
            .slice()
            .sort((a, b) => a.code.localeCompare(b.code))
            .map((row) => ({ ...row }));
        },
      };
      return qb;
    },
    async findOne({ where }: { where: { id: string } }) {
      const found = rows.find((row) => row.id === where.id);
      return found ? { ...found } : null;
    },
    async save(input: Shed) {
      const index = rows.findIndex((row) => row.id === input.id);
      const saved = { ...input };
      if (index >= 0) rows[index] = saved;
      else rows.push(saved);
      return { ...saved };
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

describe('shed layout HTTP', () => {
  let app: INestApplication;
  let sheds: ReturnType<typeof memorySheds>;

  beforeEach(async () => {
    sheds = memorySheds([
      shed({ id: 'shed-1', code: 'S01', name: '一号棚', location: '东区' }),
      shed({ id: 'shed-2', code: 'S02', name: '二号棚', location: '西区' }),
    ]);
    const moduleRef = await Test.createTestingModule({
      controllers: [ShedsController],
      providers: [
        ShedsService,
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: getRepositoryToken(Shed), useValue: sheds },
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
    '%s can patch shed coordinates and read them back from the list',
    async (role) => {
      const patched = await request(app.getHttpServer())
        .patch('/api/v1/sheds/shed-1')
        .set('x-test-role', role)
        .send({ mapX: 32, mapY: 48 });

      expect(patched.status).toBe(200);
      expect(patched.body).toMatchObject({
        id: 'shed-1',
        code: 'S01',
        mapX: 32,
        mapY: 48,
      });

      const listed = await request(app.getHttpServer())
        .get('/api/v1/sheds')
        .set('x-test-role', role);

      expect(listed.status).toBe(200);
      expect(listed.body).toEqual([
        expect.objectContaining({ code: 'S01', mapX: 32, mapY: 48 }),
        expect.objectContaining({ code: 'S02', mapX: null, mapY: null }),
      ]);
    },
  );

  it('keeps shed isolation after coordinates change', async () => {
    const patched = await request(app.getHttpServer())
      .patch('/api/v1/sheds/shed-2')
      .set('x-test-role', 'production_admin')
      .send({ mapX: 70, mapY: 30 });
    expect(patched.status).toBe(200);

    const adminList = await request(app.getHttpServer())
      .get('/api/v1/sheds')
      .set('x-test-role', 'super_admin');
    expect(adminList.status).toBe(200);
    expect(adminList.body).toEqual([
      expect.objectContaining({ code: 'S01', mapX: null, mapY: null }),
      expect.objectContaining({ code: 'S02', mapX: 70, mapY: 30 }),
    ]);

    for (const role of READ_ROLES) {
      const scoped = await request(app.getHttpServer())
        .get('/api/v1/sheds')
        .set('x-test-role', role);
      expect(scoped.status).toBe(200);
      expect(scoped.body.map((row: { code: string }) => row.code)).toEqual([
        'S01',
      ]);
      const denied = await request(app.getHttpServer())
        .patch('/api/v1/sheds/shed-1')
        .set('x-test-role', role)
        .send({ mapX: 1, mapY: 1 });
      expect(denied.status).toBe(403);
    }

    expect(sheds.rows.find((row) => row.code === 'S01')).toMatchObject({
      mapX: null,
      mapY: null,
    });
    expect(sheds.rows.find((row) => row.code === 'S02')).toMatchObject({
      mapX: 70,
      mapY: 30,
    });
  });

  it('rejects coordinates outside 0–100 and leaves the row unchanged', async () => {
    const response = await request(app.getHttpServer())
      .patch('/api/v1/sheds/shed-1')
      .set('x-test-role', 'super_admin')
      .send({ mapX: 120, mapY: 10 });

    expect(response.status).toBe(400);
    expect(sheds.rows.find((row) => row.id === 'shed-1')).toMatchObject({
      mapX: null,
      mapY: null,
    });
  });

  it('clears coordinates when the patch sends null', async () => {
    sheds.rows[0].mapX = 25;
    sheds.rows[0].mapY = 40;

    const response = await request(app.getHttpServer())
      .patch('/api/v1/sheds/shed-1')
      .set('x-test-role', 'super_admin')
      .send({ mapX: null, mapY: null });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ mapX: null, mapY: null });

    const listed = await request(app.getHttpServer())
      .get('/api/v1/sheds')
      .set('x-test-role', 'super_admin');
    expect(listed.body[0]).toMatchObject({
      code: 'S01',
      mapX: null,
      mapY: null,
    });
  });
});
