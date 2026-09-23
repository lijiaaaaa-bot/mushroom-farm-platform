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
import { Device } from '../entities/device.entity';
import { Shed } from '../entities/shed.entity';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

const IMPORT_ROLES = [
  'super_admin',
  'production_admin',
  'shed_manager',
] as const;

function memoryDevices() {
  const rows: Device[] = [];
  return {
    rows,
    findOne: async ({ where }: { where: { code?: string } }) =>
      rows.find((row) => row.code === where.code) ?? null,
    create: (input: Partial<Device>) => input,
    save: async (input: Partial<Device>) => {
      const saved = {
        parentCode: null,
        onlineStatus: 'offline' as const,
        lastSeenAt: null,
        meta: {},
        ...input,
        id: input.id ?? `device-${rows.length + 1}`,
        createdAt: input.createdAt ?? new Date(),
      } as Device;
      rows.push(saved);
      return saved;
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

describe('device batch import HTTP', () => {
  let app: INestApplication;
  let devices: ReturnType<typeof memoryDevices>;
  let sheds: ReturnType<typeof memorySheds>;
  const audit = { write: jest.fn() };

  beforeEach(async () => {
    devices = memoryDevices();
    sheds = memorySheds(['S01', 'S02']);
    audit.write.mockReset();
    const moduleRef = await Test.createTestingModule({
      controllers: [DevicesController],
      providers: [
        DevicesService,
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: getRepositoryToken(Device), useValue: devices },
        { provide: getRepositoryToken(Shed), useValue: sheds },
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

  it.each(IMPORT_ROLES)(
    '%s imports a legal batch and defaults a blank type to camera',
    async (role) => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/devices/import')
        .set('x-test-role', role)
        .send({
          rows: [
            { code: 'CAM-1', name: '东摄像头', shedCode: 'S01' },
            {
              code: 'BOX-1',
              name: '一号盒',
              shedCode: 'S01',
              type: 'ai_box',
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        successCount: 2,
        failCount: 0,
        skippedCount: 0,
        errors: [],
        skipped: [],
      });
      expect(devices.rows.map((row) => [row.code, row.type, row.name])).toEqual(
        [
          ['CAM-1', 'camera', '东摄像头'],
          ['BOX-1', 'ai_box', '一号盒'],
        ],
      );
      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'device.import',
          detail: { successCount: 2, failCount: 0, skippedCount: 0 },
        }),
      );
    },
  );

  it('skips an existing device code and does not change its name', async () => {
    devices.rows.push({
      id: 'existing',
      code: 'CAM-1',
      name: '旧名称',
      type: 'camera',
      shedCode: 'S01',
      parentCode: null,
      onlineStatus: 'offline',
      lastSeenAt: null,
      meta: {},
      createdAt: new Date(),
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/devices/import')
      .set('x-test-role', 'production_admin')
      .send({
        rows: [
          { code: 'CAM-1', name: '新名称', shedCode: 'S01' },
          { code: 'CAM-2', name: '西摄像头', shedCode: 'S01' },
          { code: 'CAM-2', name: '重复', shedCode: 'S01' },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      successCount: 1,
      failCount: 0,
      skippedCount: 2,
    });
    expect(response.body.skipped).toEqual([
      { row: 1, reason: '设备编码已存在，已跳过' },
      { row: 3, reason: '设备编码已存在，已跳过' },
    ]);
    const kept = devices.rows.find((row) => row.code === 'CAM-1');
    expect(kept?.name).toBe('旧名称');
    expect(devices.rows.filter((row) => row.code === 'CAM-2')).toHaveLength(1);
    expect(devices.rows.find((row) => row.code === 'CAM-2')?.name).toBe(
      '西摄像头',
    );
  });

  it('fails a missing shed on that row and still imports the others', async () => {
    const csv = [
      '设备编码,棚编码,名称,类型',
      'CAM-3,S01,"东,摄像头",摄像头',
      'CAM-X,S99,无棚,',
      'CAM-4,S02,西摄像头,传感器',
    ].join('\n');

    const response = await request(app.getHttpServer())
      .post('/api/v1/devices/import')
      .set('x-test-role', 'super_admin')
      .send({ csv });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      successCount: 2,
      failCount: 1,
      skippedCount: 0,
      errors: [{ row: 2, reason: '棚不存在' }],
    });
    expect(devices.rows.map((row) => [row.code, row.name, row.type])).toEqual([
      ['CAM-3', '东,摄像头', 'camera'],
      ['CAM-4', '西摄像头', 'sensor'],
    ]);
    expect(sheds.rows.map((row) => row.code)).toEqual(['S01', 'S02']);
  });

  it('accepts a multipart CSV and continues after a bad row', async () => {
    const csv = 'code,shedCode,name\nCAM-5,S01,南摄像头\n,S01,缺编码\n';
    const response = await request(app.getHttpServer())
      .post('/api/v1/devices/import')
      .set('x-test-role', 'production_admin')
      .attach('file', Buffer.from(csv), 'cameras.csv');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      successCount: 1,
      failCount: 1,
      errors: [{ row: 2, reason: '缺少设备编码' }],
    });
    expect(devices.rows.map((row) => row.code)).toEqual(['CAM-5']);
  });

  it('fails only the shed a manager cannot access', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/devices/import')
      .set('x-test-role', 'shed_manager')
      .send({
        rows: [
          { code: 'CAM-1', name: '本棚', shedCode: 'S01' },
          { code: 'CAM-9', name: '他棚', shedCode: 'S02' },
          { code: 'BAD', name: '坏类型', shedCode: 'S01', type: 'drone' },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      successCount: 1,
      failCount: 2,
      skippedCount: 0,
    });
    expect(response.body.errors).toEqual([
      { row: 2, reason: '无权访问该棚区' },
      { row: 3, reason: '设备类型无效' },
    ]);
    expect(devices.rows.map((row) => row.code)).toEqual(['CAM-1']);
    expect(devices.rows.some((row) => row.shedCode === 'S02')).toBe(false);
  });

  it('rejects viewers and does not write devices', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/devices/import')
      .set('x-test-role', 'viewer')
      .send({
        rows: [{ code: 'CAM-1', name: '东摄像头', shedCode: 'S01' }],
      });

    expect(response.status).toBe(403);
    expect(devices.rows).toHaveLength(0);
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('rejects a CSV that is missing a required column', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/devices/import')
      .set('x-test-role', 'super_admin')
      .send({ csv: '设备编码,名称\nCAM-1,东摄像头\n' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      'CSV 缺少必填列：设备编码、棚编码、名称',
    );
    expect(devices.rows).toHaveLength(0);
  });
});
