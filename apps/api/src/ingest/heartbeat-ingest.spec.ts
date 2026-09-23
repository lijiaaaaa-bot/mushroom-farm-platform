import { readFileSync } from 'fs';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { DevicesService } from '../devices';
import { IngestTokenGuard } from '../common/guards';
import { configureApp } from '../configure-app';
import { Alert } from '../entities/alert.entity';
import { Device } from '../entities/device.entity';
import { Shed } from '../entities/shed.entity';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';

const httpFixture = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '../../../../packages/contracts/fixtures/heartbeat.http.json',
    ),
    'utf8',
  ),
) as { body: Record<string, unknown> };

function memoryDevices() {
  const rows: Device[] = [];
  return {
    rows,
    findOne: async ({ where }: { where: { code?: string } }) =>
      rows.find((row) => row.code === where.code) ?? null,
    find: async () => rows,
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
  };
}

function memorySheds(codes: string[]) {
  const rows = codes.map((code) => ({ code, name: code }));
  return {
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
    find: async () => rows,
    create: (input: Partial<Alert>) => ({ ...input }) as Alert,
    save: async (input: Partial<Alert> | Partial<Alert>[]) => {
      const batch = Array.isArray(input) ? input : [input];
      const saved = batch.map((item) => {
        const next = {
          ...item,
          id: item.id ?? `alert-${rows.length + 1}`,
          createdAt: item.createdAt ?? new Date(),
        } as Alert;
        rows.push(next);
        return next;
      });
      return Array.isArray(input) ? saved : saved[0];
    },
  };
}

describe('HTTP heartbeat ingest', () => {
  let app: INestApplication;
  let devices: ReturnType<typeof memoryDevices>;

  beforeEach(async () => {
    devices = memoryDevices();
    const moduleRef = await Test.createTestingModule({
      controllers: [IngestController],
      providers: [
        DevicesService,
        IngestTokenGuard,
        { provide: getRepositoryToken(Device), useValue: devices },
        {
          provide: getRepositoryToken(Shed),
          useValue: memorySheds(['S01']),
        },
        { provide: getRepositoryToken(Alert), useValue: memoryAlerts() },
        {
          provide: IngestService,
          useValue: {
            handle: jest.fn(),
            handleEnvironment: jest.fn(),
            recordReject: jest.fn(),
            recordHeartbeat: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'ingestToken' ? 'dev-ingest-token' : undefined,
          },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  function postHeartbeat(body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/api/v1/ingest/heartbeat')
      .set('x-ingest-token', 'dev-ingest-token')
      .send(body);
  }

  it('stores the HTTP heartbeat fixture and ignores the same reportedAt', async () => {
    const created = await postHeartbeat(httpFixture.body);

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      accepted: true,
      duplicate: false,
      code: 'EDGE-SIM-BOX',
      shedCode: 'S01',
      onlineStatus: 'online',
      lastHeartbeatAt: '2026-09-23T08:00:00.000Z',
    });
    expect(devices.rows).toHaveLength(1);
    expect(devices.rows[0]).toMatchObject({ type: 'ai_box' });

    const again = await postHeartbeat(httpFixture.body);
    expect(again.status).toBe(201);
    expect(again.body.duplicate).toBe(true);
    expect(devices.rows).toHaveLength(1);
  });

  it('rejects an unknown field and a missing ingest token', async () => {
    const rejected = await postHeartbeat({
      ...httpFixture.body,
      firmware: '1.2.3',
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body.code).toBe('UNKNOWN_FIELD');
    expect(devices.rows).toHaveLength(0);

    const denied = await request(app.getHttpServer())
      .post('/api/v1/ingest/heartbeat')
      .send(httpFixture.body);
    expect(denied.status).toBe(401);
  });
});
