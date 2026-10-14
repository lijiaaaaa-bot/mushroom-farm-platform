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
import { Device } from '../entities/device.entity';
import { Shed } from '../entities/shed.entity';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

function memoryDevices() {
  const rows: Device[] = [];
  return {
    rows,
    findOne: async ({ where }: { where: { id?: string; code?: string } }) =>
      rows.find(
        (row) =>
          (where.id === undefined || row.id === where.id) &&
          (where.code === undefined || row.code === where.code),
      ) ?? null,
    find: async (query?: { where?: Partial<Device> }) => {
      const where = query?.where ?? {};
      return rows.filter((row) =>
        Object.entries(where).every(
          ([key, value]) => row[key as keyof Device] === value,
        ),
      );
    },
    create: (input: Partial<Device>) => ({ ...input }) as Device,
    save: async (input: Partial<Device> | Partial<Device>[]) => {
      const batch = Array.isArray(input) ? input : [input];
      const saved = batch.map((item) => {
        const next = {
          parentCode: null,
          onlineStatus: 'offline' as const,
          lastSeenAt: null,
          lastHeartbeatAt: null,
          note: null,
          enabled: true,
          meta: {},
          ...item,
          id: item.id ?? `device-${rows.length + 1}`,
          createdAt: item.createdAt ?? new Date(),
        } as Device;
        const index = rows.findIndex(
          (row) => row.id === next.id || row.code === next.code,
        );
        if (index >= 0) rows[index] = next;
        else rows.push(next);
        return next;
      });
      return Array.isArray(input) ? saved : saved[0];
    },
    createQueryBuilder: () => {
      const filters: Array<(row: Device) => boolean> = [];
      let skip = 0;
      let take = 100;
      const qb = {
        orderBy: () => qb,
        andWhere: (sql: string, params?: Record<string, unknown>) => {
          if (sql === '1 = 0') filters.push(() => false);
          else if (sql === 'd.shedCode IN (:...codes)') {
            const codes = params?.codes as string[];
            filters.push((row) => codes.includes(row.shedCode));
          } else if (sql === 'd.shedCode = :shedCode') {
            filters.push((row) => row.shedCode === params?.shedCode);
          } else if (sql === 'd.type = :type') {
            filters.push((row) => row.type === params?.type);
          } else if (sql === 'd.onlineStatus = :online') {
            filters.push((row) => row.onlineStatus === params?.online);
          } else {
            throw new Error(`unhandled where: ${sql}`);
          }
          return qb;
        },
        skip: (value: number) => {
          skip = value;
          return qb;
        },
        take: (value: number) => {
          take = value;
          return qb;
        },
        getManyAndCount: async () => {
          const matched = rows
            .filter((row) => filters.every((fn) => fn(row)))
            .sort((a, b) => a.code.localeCompare(b.code));
          return [matched.slice(skip, skip + take), matched.length] as const;
        },
      };
      return qb;
    },
  };
}

function memorySheds(codes: string[]) {
  const rows = codes.map((code) => ({ code, name: code }));
  return {
    rows,
    findOne: async ({ where }: { where: { code?: string } }) =>
      rows.find((row) => row.code === where.code) ?? null,
    create: (input: { code: string; name: string }) => input,
    save: async (input: { code: string; name: string }) => {
      rows.push(input);
      return input;
    },
  };
}

function memoryAlerts() {
  return {
    find: async () => [],
    create: (row: unknown) => row,
    save: async (row: unknown) => row,
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

describe('camera registration', () => {
  let app: INestApplication;
  let devices: ReturnType<typeof memoryDevices>;

  beforeEach(async () => {
    devices = memoryDevices();
    const moduleRef = await Test.createTestingModule({
      controllers: [DevicesController],
      providers: [
        DevicesService,
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: getRepositoryToken(Device), useValue: devices },
        { provide: getRepositoryToken(Shed), useValue: memorySheds(['S01']) },
        { provide: getRepositoryToken(Alert), useValue: memoryAlerts() },
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

  it('creates a camera, lists it, and keeps an edited note after reload', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/devices')
      .set('x-test-role', 'production_admin')
      .send({
        code: 'CAM-REG-01',
        name: '东侧过道',
        type: 'camera',
        shedCode: 'S01',
        note: '靠门',
      });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      code: 'CAM-REG-01',
      name: '东侧过道',
      type: 'camera',
      shedCode: 'S01',
      note: '靠门',
      onlineStatus: 'offline',
    });

    const listed = await request(app.getHttpServer())
      .get('/api/v1/devices')
      .query({ type: 'camera' })
      .set('x-test-role', 'production_admin');
    expect(listed.status).toBe(200);
    expect(listed.body.items).toEqual([
      expect.objectContaining({
        id: created.body.id,
        code: 'CAM-REG-01',
        note: '靠门',
      }),
    ]);

    const patched = await request(app.getHttpServer())
      .patch(`/api/v1/devices/${created.body.id}`)
      .set('x-test-role', 'super_admin')
      .send({ note: '靠门，已核对' });
    expect(patched.status).toBe(200);
    expect(patched.body.note).toBe('靠门，已核对');

    const again = await request(app.getHttpServer())
      .get('/api/v1/devices')
      .query({ type: 'camera' })
      .set('x-test-role', 'viewer');
    expect(again.body.items[0].note).toBe('靠门，已核对');
    expect(again.body.items[0].onlineStatus).toBe('offline');
  });

  it('clears a blank note and does not drop the note on heartbeat', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/devices')
      .set('x-test-role', 'super_admin')
      .send({
        code: ' CAM-REG-02 ',
        name: ' 西侧 ',
        type: 'camera',
        shedCode: 'S01',
        note: '  临时  ',
      });
    expect(created.status).toBe(201);
    expect(created.body.code).toBe('CAM-REG-02');
    expect(created.body.name).toBe('西侧');
    expect(created.body.note).toBe('临时');

    const cleared = await request(app.getHttpServer())
      .patch(`/api/v1/devices/${created.body.id}`)
      .set('x-test-role', 'production_admin')
      .send({ note: '   ' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.note).toBeNull();

    await request(app.getHttpServer())
      .patch(`/api/v1/devices/${created.body.id}`)
      .set('x-test-role', 'production_admin')
      .send({ note: '留下' });

    const service = app.get(DevicesService);
    const beat = await service.heartbeat(
      'S01',
      'CAM-REG-02',
      'camera',
      true,
      '2026-10-14T02:00:00.000Z',
    );
    expect(beat.onlineStatus).toBe('online');
    expect(devices.rows.find((row) => row.code === 'CAM-REG-02')).toMatchObject(
      {
        note: '留下',
        onlineStatus: 'online',
      },
    );
  });

  it('reads one camera by id and keeps other sheds out', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/devices')
      .set('x-test-role', 'production_admin')
      .send({
        code: 'CAM-ALERT-01',
        name: '温度告警镜头',
        type: 'camera',
        shedCode: 'S01',
        note: '镜头码对照告警',
      });
    expect(created.status).toBe(201);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/devices/${created.body.id}`)
      .set('x-test-role', 'viewer');
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      id: created.body.id,
      code: 'CAM-ALERT-01',
      name: '温度告警镜头',
      type: 'camera',
      shedCode: 'S01',
      note: '镜头码对照告警',
      onlineStatus: 'offline',
    });

    const missing = await request(app.getHttpServer())
      .get('/api/v1/devices/missing-device')
      .set('x-test-role', 'viewer');
    expect(missing.status).toBe(404);

    const other = await request(app.getHttpServer())
      .post('/api/v1/devices')
      .set('x-test-role', 'production_admin')
      .send({
        code: 'CAM-S02-01',
        name: '二棚镜头',
        type: 'camera',
        shedCode: 'S02',
      });
    expect(other.status).toBe(201);
    const blocked = await request(app.getHttpServer())
      .get(`/api/v1/devices/${other.body.id}`)
      .set('x-test-role', 'shed_manager');
    expect(blocked.status).toBe(403);
  });

  it('lists a newly created camera and returns the same row from its detail', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/devices')
      .set('x-test-role', 'production_admin')
      .send({
        code: 'CAM-NEW-01',
        name: '新增镜头',
        type: 'camera',
        shedCode: 'S01',
        note: '新增可演示',
      });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      code: 'CAM-NEW-01',
      name: '新增镜头',
      type: 'camera',
      shedCode: 'S01',
      note: '新增可演示',
      onlineStatus: 'offline',
      lastHeartbeatAt: null,
      lastSeenAt: null,
    });

    const list = await request(app.getHttpServer())
      .get('/api/v1/devices?pageSize=100')
      .set('x-test-role', 'production_admin');
    expect(list.status).toBe(200);
    const row = list.body.items.find(
      (item: { code?: string }) => item.code === 'CAM-NEW-01',
    );
    expect(row).toMatchObject({
      id: created.body.id,
      code: 'CAM-NEW-01',
      name: '新增镜头',
      type: 'camera',
      shedCode: 'S01',
      note: '新增可演示',
      onlineStatus: 'offline',
    });

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/devices/${created.body.id}`)
      .set('x-test-role', 'production_admin');
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      id: row.id,
      code: row.code,
      name: row.name,
      type: row.type,
      shedCode: row.shedCode,
      note: row.note,
      onlineStatus: row.onlineStatus,
      lastHeartbeatAt: row.lastHeartbeatAt ?? null,
      lastSeenAt: row.lastSeenAt ?? null,
    });
  });

  it('rejects a duplicate code and blocks roles that cannot register', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/devices')
      .set('x-test-role', 'super_admin')
      .send({
        code: 'CAM-REG-01',
        name: '东侧过道',
        type: 'camera',
        shedCode: 'S01',
      })
      .expect(201);

    const duplicate = await request(app.getHttpServer())
      .post('/api/v1/devices')
      .set('x-test-role', 'super_admin')
      .send({
        code: 'CAM-REG-01',
        name: '另一台',
        type: 'camera',
        shedCode: 'S01',
      });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.message).toBe('设备编码已存在');
    expect(
      devices.rows.filter((row) => row.code === 'CAM-REG-01'),
    ).toHaveLength(1);

    const viewer = await request(app.getHttpServer())
      .post('/api/v1/devices')
      .set('x-test-role', 'viewer')
      .send({
        code: 'CAM-REG-03',
        name: '查看员',
        type: 'camera',
        shedCode: 'S01',
      });
    expect(viewer.status).toBe(403);

    const lead = await request(app.getHttpServer())
      .patch(`/api/v1/devices/${devices.rows[0].id}`)
      .set('x-test-role', 'shed_manager')
      .send({ note: '不该写入' });
    expect(lead.status).toBe(403);
    expect(devices.rows[0].note).toBeNull();
  });

  it('edits a camera note and status, then list and detail show them', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/devices')
      .set('x-test-role', 'production_admin')
      .send({
        code: 'CAM-EDIT-01',
        name: '可编辑镜头',
        type: 'camera',
        shedCode: 'S01',
        note: '编辑前',
      });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      code: 'CAM-EDIT-01',
      name: '可编辑镜头',
      note: '编辑前',
      onlineStatus: 'offline',
      lastHeartbeatAt: null,
    });

    const patched = await request(app.getHttpServer())
      .patch(`/api/v1/devices/${created.body.id}`)
      .set('x-test-role', 'super_admin')
      .send({ note: '备注已改', onlineStatus: 'online' });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({
      id: created.body.id,
      code: 'CAM-EDIT-01',
      name: '可编辑镜头',
      note: '备注已改',
      onlineStatus: 'online',
      lastHeartbeatAt: null,
      lastSeenAt: null,
    });

    const listed = await request(app.getHttpServer())
      .get('/api/v1/devices')
      .query({ pageSize: 100 })
      .set('x-test-role', 'viewer');
    expect(listed.status).toBe(200);
    expect(listed.body.items).toEqual([
      expect.objectContaining({
        id: created.body.id,
        code: 'CAM-EDIT-01',
        note: '备注已改',
        onlineStatus: 'online',
      }),
    ]);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/devices/${created.body.id}`)
      .set('x-test-role', 'viewer');
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      id: created.body.id,
      note: '备注已改',
      onlineStatus: 'online',
      lastHeartbeatAt: null,
    });

    const service = app.get(DevicesService);
    await service.markStaleOffline(new Date('2026-10-14T03:00:00.000Z'));
    expect(devices.rows[0]).toMatchObject({
      onlineStatus: 'online',
      note: '备注已改',
      lastHeartbeatAt: null,
    });

    const invalid = await request(app.getHttpServer())
      .patch(`/api/v1/devices/${created.body.id}`)
      .set('x-test-role', 'super_admin')
      .send({ onlineStatus: 'asleep' });
    expect(invalid.status).toBe(400);
    expect(devices.rows[0].onlineStatus).toBe('online');

    const denied = await request(app.getHttpServer())
      .patch(`/api/v1/devices/${created.body.id}`)
      .set('x-test-role', 'viewer')
      .send({ note: '不该写入', onlineStatus: 'offline' });
    expect(denied.status).toBe(403);
    expect(devices.rows[0].note).toBe('备注已改');
    expect(devices.rows[0].onlineStatus).toBe('online');

    await service.heartbeat(
      'S01',
      'CAM-EDIT-01',
      'camera',
      true,
      '2026-10-14T02:00:00.000Z',
    );
    expect(devices.rows[0].note).toBe('备注已改');
    expect(devices.rows[0].onlineStatus).toBe('online');
    expect(devices.rows[0].lastHeartbeatAt).toEqual(
      new Date('2026-10-14T02:00:00.000Z'),
    );

    await service.markStaleOffline(new Date('2026-10-14T02:06:00.000Z'));
    expect(devices.rows[0].onlineStatus).toBe('offline');
    expect(devices.rows[0].note).toBe('备注已改');
  });

  it('deactivates a camera and keeps it on the list and the detail', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/devices')
      .set('x-test-role', 'production_admin')
      .send({
        code: 'CAM-STOP-01',
        name: '可停用镜头',
        type: 'camera',
        shedCode: 'S01',
        note: '停用前',
      });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      code: 'CAM-STOP-01',
      name: '可停用镜头',
      note: '停用前',
      onlineStatus: 'offline',
      enabled: true,
      lastHeartbeatAt: null,
    });

    const stopped = await request(app.getHttpServer())
      .patch(`/api/v1/devices/${created.body.id}`)
      .set('x-test-role', 'super_admin')
      .send({ enabled: false });
    expect(stopped.status).toBe(200);
    expect(stopped.body).toMatchObject({
      id: created.body.id,
      code: 'CAM-STOP-01',
      name: '可停用镜头',
      note: '停用前',
      onlineStatus: 'offline',
      enabled: false,
      lastHeartbeatAt: null,
      lastSeenAt: null,
    });

    const listed = await request(app.getHttpServer())
      .get('/api/v1/devices')
      .query({ pageSize: 100 })
      .set('x-test-role', 'viewer');
    expect(listed.status).toBe(200);
    expect(listed.body.items).toEqual([
      expect.objectContaining({
        id: created.body.id,
        code: 'CAM-STOP-01',
        note: '停用前',
        onlineStatus: 'offline',
        enabled: false,
      }),
    ]);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/devices/${created.body.id}`)
      .set('x-test-role', 'viewer');
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      id: created.body.id,
      note: '停用前',
      onlineStatus: 'offline',
      enabled: false,
      lastHeartbeatAt: null,
    });

    const invalid = await request(app.getHttpServer())
      .patch(`/api/v1/devices/${created.body.id}`)
      .set('x-test-role', 'super_admin')
      .send({ enabled: 'off' });
    expect(invalid.status).toBe(400);
    expect(devices.rows[0].enabled).toBe(false);
    expect(devices.rows[0].note).toBe('停用前');

    const denied = await request(app.getHttpServer())
      .patch(`/api/v1/devices/${created.body.id}`)
      .set('x-test-role', 'viewer')
      .send({ enabled: true });
    expect(denied.status).toBe(403);
    const lead = await request(app.getHttpServer())
      .patch(`/api/v1/devices/${created.body.id}`)
      .set('x-test-role', 'shed_manager')
      .send({ enabled: true });
    expect(lead.status).toBe(403);
    expect(devices.rows[0].enabled).toBe(false);

    const service = app.get(DevicesService);
    await service.heartbeat(
      'S01',
      'CAM-STOP-01',
      'camera',
      true,
      '2026-10-14T02:00:00.000Z',
    );
    expect(devices.rows[0].enabled).toBe(false);
    expect(devices.rows[0].onlineStatus).toBe('online');
    expect(devices.rows[0].note).toBe('停用前');

    const enabled = await request(app.getHttpServer())
      .patch(`/api/v1/devices/${created.body.id}`)
      .set('x-test-role', 'production_admin')
      .send({ enabled: true });
    expect(enabled.status).toBe(200);
    expect(enabled.body.enabled).toBe(true);
    expect(enabled.body.onlineStatus).toBe('online');
    expect(enabled.body.note).toBe('停用前');
  });
});
