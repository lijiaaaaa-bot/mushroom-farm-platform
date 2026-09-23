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
    findOne: async ({ where }: { where: { code?: string } }) =>
      rows.find((row) => row.code === where.code) ?? null,
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
  const rows: Alert[] = [];
  return {
    rows,
    find: async (query?: { where?: Partial<Alert> }) => {
      const where = query?.where ?? {};
      return rows.filter((row) =>
        Object.entries(where).every(
          ([key, value]) => row[key as keyof Alert] === value,
        ),
      );
    },
    create: (input: Partial<Alert>) => ({ ...input }) as Alert,
    save: async (input: Partial<Alert> | Partial<Alert>[]) => {
      const batch = Array.isArray(input) ? input : [input];
      const saved = batch.map((item) => {
        const next = {
          ...item,
          id: item.id ?? `alert-${rows.length + 1}`,
          createdAt: item.createdAt ?? new Date(),
        } as Alert;
        const index = rows.findIndex((row) => row.id === next.id);
        if (index >= 0) rows[index] = next;
        else rows.push(next);
        return next;
      });
      return Array.isArray(input) ? saved : saved[0];
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
    const rawSheds = req.header('x-test-sheds');
    req.user = {
      id: `id-${role}`,
      username: role,
      displayName: role,
      role: role as Role,
      shedCodes:
        rawSheds === undefined
          ? ['S01']
          : rawSheds
              .split(',')
              .map((code) => code.trim())
              .filter(Boolean),
    };
  }
  next();
}

describe('device heartbeat and offline alerts', () => {
  let app: INestApplication;
  let devices: ReturnType<typeof memoryDevices>;
  let alerts: ReturnType<typeof memoryAlerts>;

  beforeEach(async () => {
    devices = memoryDevices();
    alerts = memoryAlerts();
    const moduleRef = await Test.createTestingModule({
      controllers: [DevicesController],
      providers: [
        DevicesService,
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: getRepositoryToken(Device), useValue: devices },
        {
          provide: getRepositoryToken(Shed),
          useValue: memorySheds(['S01', 'S02']),
        },
        { provide: getRepositoryToken(Alert), useValue: alerts },
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

  it('stores one device row and treats the same reportedAt as a duplicate', async () => {
    const service = app.get(DevicesService);
    const created = await service.heartbeat(
      'S01',
      'EDGE-SIM-BOX',
      'ai_box',
      true,
      '2026-09-23T08:00:00.000Z',
    );

    expect(created).toMatchObject({
      accepted: true,
      duplicate: false,
      code: 'EDGE-SIM-BOX',
      shedCode: 'S01',
      onlineStatus: 'online',
      lastHeartbeatAt: '2026-09-23T08:00:00.000Z',
    });
    expect(devices.rows).toHaveLength(1);
    expect(devices.rows[0]).toMatchObject({
      type: 'ai_box',
      onlineStatus: 'online',
    });

    const again = await service.heartbeat(
      'S01',
      'EDGE-SIM-BOX',
      'ai_box',
      true,
      '2026-09-23T08:00:00.000Z',
    );
    expect(again.duplicate).toBe(true);
    expect(devices.rows).toHaveLength(1);
    expect(alerts.rows).toHaveLength(0);
  });

  it('opens one device-offline alert after the timeout and closes it on the next heartbeat', async () => {
    const service = app.get(DevicesService);
    const reportedAt = '2026-09-23T00:00:00.000Z';
    await service.heartbeat('S01', 'BOX-1', 'ai_box', true, reportedAt);

    await service.markStaleOffline(new Date('2026-09-23T00:04:00.000Z'));
    expect(devices.rows[0].onlineStatus).toBe('online');
    expect(alerts.rows).toHaveLength(0);

    await service.markStaleOffline(new Date('2026-09-23T00:05:00.001Z'));
    expect(devices.rows[0].onlineStatus).toBe('offline');
    expect(alerts.rows).toHaveLength(1);
    expect(alerts.rows[0]).toMatchObject({
      metric: 'device_offline',
      title: '设备离线',
      level: 'warning',
      status: 'open',
      shedCode: 'S01',
      cameraCode: 'BOX-1',
    });

    await service.markStaleOffline(new Date('2026-09-23T00:10:00.000Z'));
    expect(alerts.rows).toHaveLength(1);

    const stale = await service.heartbeat(
      'S01',
      'BOX-1',
      'ai_box',
      true,
      '2026-09-22T23:59:00.000Z',
    );
    expect(stale.duplicate).toBe(true);
    expect(devices.rows[0].onlineStatus).toBe('offline');
    expect(alerts.rows[0].status).toBe('open');

    const recovered = await service.heartbeat(
      'S01',
      'BOX-1',
      'ai_box',
      true,
      '2026-09-23T00:11:00.000Z',
    );
    expect(recovered).toMatchObject({
      duplicate: false,
      onlineStatus: 'online',
      lastHeartbeatAt: '2026-09-23T00:11:00.000Z',
    });
    expect(alerts.rows[0]).toMatchObject({
      status: 'closed',
      closedBy: 'system',
      closeNote: '心跳恢复，自动关闭',
    });
  });

  it('opens an alert when the device reports offline and does not alert a camera that never heartbeated', async () => {
    const service = app.get(DevicesService);
    await service.heartbeat(
      'S01',
      'SENSOR-1',
      'sensor',
      false,
      '2026-09-23T01:00:00.000Z',
    );
    expect(devices.rows[0].onlineStatus).toBe('offline');
    expect(alerts.rows).toHaveLength(1);
    expect(alerts.rows[0].title).toBe('设备离线');

    await service.heartbeat(
      'S01',
      'SENSOR-1',
      'sensor',
      true,
      '2026-09-23T01:05:00.000Z',
    );
    expect(alerts.rows[0].status).toBe('closed');

    devices.rows.push({
      id: 'cam-1',
      code: 'CAM-1',
      name: '摄像头',
      type: 'camera',
      shedCode: 'S01',
      parentCode: null,
      onlineStatus: 'online',
      lastSeenAt: new Date('2026-09-23T00:00:00.000Z'),
      lastHeartbeatAt: null,
      meta: {},
      createdAt: new Date('2026-09-23T00:00:00.000Z'),
    });
    await service.markStaleOffline(new Date('2026-09-23T00:06:00.000Z'));
    const camera = devices.rows.find((row) => row.code === 'CAM-1');
    expect(camera?.onlineStatus).toBe('offline');
    expect(
      alerts.rows.filter((row) => row.cameraCode === 'CAM-1'),
    ).toHaveLength(0);
  });

  it('lists online status and last heartbeat inside the caller shed scope', async () => {
    const service = app.get(DevicesService);
    await service.heartbeat(
      'S01',
      'BOX-S01',
      'ai_box',
      true,
      '2026-09-23T02:00:00.000Z',
    );
    await service.heartbeat(
      'S02',
      'BOX-S02',
      'sensor',
      true,
      '2026-09-23T02:05:00.000Z',
    );

    const all = await request(app.getHttpServer())
      .get('/api/v1/devices')
      .set('x-test-role', 'super_admin');
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(2);
    expect(all.body.items[0]).toMatchObject({
      code: 'BOX-S01',
      onlineStatus: 'online',
      lastHeartbeatAt: '2026-09-23T02:00:00.000Z',
    });

    const producer = await request(app.getHttpServer())
      .get('/api/v1/devices')
      .set('x-test-role', 'production_admin');
    expect(producer.body.total).toBe(2);

    const manager = await request(app.getHttpServer())
      .get('/api/v1/devices')
      .set('x-test-role', 'shed_manager')
      .set('x-test-sheds', 'S01');
    expect(manager.status).toBe(200);
    expect(manager.body.total).toBe(1);
    expect(manager.body.items.map((row: { code: string }) => row.code)).toEqual(
      ['BOX-S01'],
    );

    const viewer = await request(app.getHttpServer())
      .get('/api/v1/devices')
      .set('x-test-role', 'viewer')
      .set('x-test-sheds', '');
    expect(viewer.body).toMatchObject({ total: 0, items: [] });

    const denied = await request(app.getHttpServer())
      .get('/api/v1/devices')
      .query({ shedCode: 'S02' })
      .set('x-test-role', 'shed_manager')
      .set('x-test-sheds', 'S01');
    expect(denied.status).toBe(403);
  });
});
