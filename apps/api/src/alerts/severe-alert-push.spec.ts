import { createHmac } from 'node:crypto';
import { INestApplication, Logger } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Role } from '@mushroom/contracts';
import { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { AuditService } from '../audit';
import { AuthUser } from '../common/auth-user';
import { RolesGuard } from '../common/guards';
import { configureApp } from '../configure-app';
import { DevicesService } from '../devices';
import { Alert } from '../entities/alert.entity';
import { AlertRead } from '../entities/alert-read.entity';
import { AlertRule } from '../entities/alert-rule.entity';
import { Device } from '../entities/device.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import { Shed } from '../entities/shed.entity';
import { AlertEngineService } from './alert-engine.service';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import {
  ALERT_WEBHOOK_POST,
  AlertWebhookPost,
  AlertWebhookRequest,
  dingtalkSignedUrl,
  SevereAlertPushService,
} from './severe-alert-push.service';

const ENV_KEYS = [
  'WECOM_WEBHOOK_URL',
  'DINGTALK_WEBHOOK_URL',
  'DINGTALK_WEBHOOK_SECRET',
] as const;

function blankWebhookEnv() {
  const previous: Partial<
    Record<(typeof ENV_KEYS)[number], string | undefined>
  > = {};
  for (const key of ENV_KEYS) {
    previous[key] = process.env[key];
    delete process.env[key];
  }
  return () => {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  };
}

function configOf(values: Record<string, string>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as ConfigService;
}

describe('dingtalkSignedUrl', () => {
  it('appends the DingTalk HMAC sign', () => {
    const secret = 'SEC123';
    const base = 'https://oapi.dingtalk.com/robot/send?access_token=abc';
    const signed = dingtalkSignedUrl(base, secret, 1000);
    const expected = encodeURIComponent(
      createHmac('sha256', secret).update(`1000\n${secret}`).digest('base64'),
    );
    expect(signed).toBe(`${base}&timestamp=1000&sign=${expected}`);
  });
});

describe('SevereAlertPushService', () => {
  let restoreEnv: () => void;
  const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

  beforeEach(() => {
    restoreEnv = blankWebhookEnv();
    errorSpy.mockClear();
  });

  afterEach(() => {
    restoreEnv();
  });

  afterAll(() => {
    errorSpy.mockRestore();
  });

  it('does nothing when both webhook urls are empty', async () => {
    const post = jest.fn();
    const service = new SevereAlertPushService(configOf({}), post);
    await service.pushIfSevere({
      id: 'a1',
      level: 'severe',
      shedCode: 'S01',
      title: '高温',
      message: '超过阈值',
    });
    expect(post).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(service.channels()).toEqual({
      wecomEnabled: false,
      dingtalkEnabled: false,
    });
  });

  it('skips warning and info', async () => {
    const post = jest.fn();
    const service = new SevereAlertPushService(
      configOf({ wecomWebhookUrl: 'https://qyapi.example/hook' }),
      post,
    );
    await service.pushIfSevere({
      level: 'warning',
      shedCode: 'S01',
      title: '一般',
      message: '说明',
    });
    await service.pushIfSevere({
      level: 'info',
      shedCode: 'S01',
      title: '提示',
      message: '说明',
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('posts severe alerts to wecom and dingtalk and still resolves when one fails', async () => {
    const calls: AlertWebhookRequest[] = [];
    const post: AlertWebhookPost = async (req) => {
      calls.push(req);
      if (req.channel === 'wecom') {
        throw new Error(
          'failed https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=secret',
        );
      }
    };
    const service = new SevereAlertPushService(
      configOf({
        wecomWebhookUrl: 'https://qyapi.example/hook',
        dingtalkWebhookUrl: 'https://oapi.example/robot?access_token=abc',
        dingtalkWebhookSecret: 'SEC123',
      }),
      post,
    );
    await expect(
      service.pushIfSevere({
        id: 'alert-9',
        level: 'severe',
        shedCode: 'S01',
        cameraCode: 'CAM-1',
        title: '病害',
        message: '病害数量 6',
      }),
    ).resolves.toBeUndefined();

    expect(calls.map((call) => call.channel).sort()).toEqual([
      'dingtalk',
      'wecom',
    ]);
    const wecom = calls.find((call) => call.channel === 'wecom');
    const dingtalk = calls.find((call) => call.channel === 'dingtalk');
    expect(wecom?.body).toEqual({
      msgtype: 'text',
      text: {
        content: expect.stringContaining('【严重告警】病害'),
      },
    });
    expect(JSON.stringify(wecom?.body)).toContain('棚区 S01 摄像头 CAM-1');
    expect(dingtalk?.url).toContain(
      'https://oapi.example/robot?access_token=abc&timestamp=',
    );
    expect(dingtalk?.url).toContain('sign=');
    expect(dingtalk?.url).not.toContain('SEC123');
    const logged = errorSpy.mock.calls
      .map((call) => String(call[0]))
      .join('\n');
    expect(logged).toContain('channel=wecom');
    expect(logged).toContain('[url]');
    expect(logged).not.toContain('key=secret');
    expect(service.channels()).toEqual({
      wecomEnabled: true,
      dingtalkEnabled: true,
    });
  });

  it('logs a non-ok response from the default poster and does not throw', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    const original = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      const service = new SevereAlertPushService(
        configOf({ wecomWebhookUrl: 'https://qyapi.example/hook' }),
      );
      await expect(
        service.pushIfSevere({
          id: 'a2',
          level: 'severe',
          shedCode: 'S01',
          title: '离线',
          message: '设备离线',
        }),
      ).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledWith(
        'https://qyapi.example/hook',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(
        errorSpy.mock.calls.map((call) => String(call[0])).join('\n'),
      ).toContain('HTTP 500');
    } finally {
      global.fetch = original;
    }
  });

  it('logs and skips a webhook that is not http(s)', async () => {
    const post = jest.fn();
    const service = new SevereAlertPushService(
      configOf({ wecomWebhookUrl: 'ftp://files.example/hook' }),
      post,
    );
    await service.pushIfSevere({
      level: 'severe',
      shedCode: 'S01',
      title: '高温',
      message: '说明',
    });
    expect(post).not.toHaveBeenCalled();
    expect(service.channels().wecomEnabled).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('alert engine severe push', () => {
  it('saves the alert when the webhook poster throws', async () => {
    const saved: Alert[] = [];
    const rules = {
      find: async () => [
        {
          id: 'rule-1',
          enabled: true,
          shedCode: null,
          metric: 'disease_count',
          threshold: 5,
          level: 'severe',
          windowMinutes: 60,
        },
      ],
    };
    const alerts = {
      findOne: async () => null,
      create: (input: Partial<Alert>) => input,
      save: async (input: Partial<Alert>) => {
        const row = { ...input, id: 'alert-engine-1' } as Alert;
        saved.push(row);
        return row;
      },
    };
    const post = jest.fn().mockRejectedValue(new Error('webhook down'));
    const push = new SevereAlertPushService(
      configOf({ wecomWebhookUrl: 'https://qyapi.example/hook' }),
      post,
    );
    const engine = new AlertEngineService(
      rules as never,
      alerts as never,
      {} as never,
      push,
    );
    const record = {
      shedCode: 'S01',
      cameraCode: 'CAM-1',
      mushroomCount: 10,
      matureCount: 1,
      diseaseCount: 6,
      diseaseLevel: 1,
      recognizedAt: new Date('2026-09-23T00:00:00.000Z'),
    } as RecognitionRecord;

    await expect(engine.evaluate(record)).resolves.toBeUndefined();
    expect(saved).toHaveLength(1);
    expect(saved[0].level).toBe('severe');
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'wecom' }),
    );
  });
});

describe('device offline push failure', () => {
  it('still records the offline heartbeat when push rejects', async () => {
    const devices: Device[] = [];
    const alerts: Alert[] = [];
    const push = {
      pushIfSevere: jest.fn().mockRejectedValue(new Error('push down')),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        DevicesService,
        {
          provide: getRepositoryToken(Device),
          useValue: {
            findOne: async ({ where }: { where: { code?: string } }) =>
              devices.find((row) => row.code === where.code) ?? null,
            create: (input: Partial<Device>) => input,
            save: async (input: Partial<Device>) => {
              const row = { ...input, id: 'device-1' } as Device;
              devices.splice(0, devices.length, row);
              return row;
            },
          },
        },
        {
          provide: getRepositoryToken(Shed),
          useValue: {
            findOne: async () => ({ code: 'S01' }),
            create: (input: Partial<Shed>) => input,
            save: async (input: Partial<Shed>) => input,
          },
        },
        {
          provide: getRepositoryToken(Alert),
          useValue: {
            find: async () => alerts.filter((row) => row.status !== 'closed'),
            create: (input: Partial<Alert>) => input,
            save: async (input: Partial<Alert>) => {
              const row = { ...input, id: 'offline-1' } as Alert;
              alerts.push(row);
              return row;
            },
          },
        },
        { provide: SevereAlertPushService, useValue: push },
      ],
    }).compile();
    const service = moduleRef.get(DevicesService);
    const result = await service.heartbeat('S01', 'BOX-1', 'ai_box', false);
    expect(result.accepted).toBe(true);
    expect(alerts).toHaveLength(1);
    expect(push.pushIfSevere).toHaveBeenCalledWith(
      expect.objectContaining({ title: '设备离线', cameraCode: 'BOX-1' }),
    );
    await moduleRef.close();
  });
});

function memoryAlerts() {
  const rows: Alert[] = [];
  return {
    rows,
    create: (input: Partial<Alert>) => input,
    save: async (input: Partial<Alert>) => {
      const saved = {
        ...input,
        id: input.id ?? `alert-${rows.length + 1}`,
        createdAt: input.createdAt ?? new Date(),
      } as Alert;
      const index = rows.findIndex((row) => row.id === saved.id);
      if (index >= 0) rows[index] = saved;
      else rows.push(saved);
      return saved;
    },
    findOne: async (query: { where: { id?: string } }) =>
      rows.find((row) => row.id === query.where.id) ?? null,
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
      id: 'id-super',
      username: 'admin',
      displayName: role,
      role: role as Role,
      shedCodes: [],
    };
  }
  next();
}

describe('severe alert webhook and claim/close', () => {
  let app: INestApplication;
  const alerts = memoryAlerts();
  const post = jest.fn<Promise<void>, [AlertWebhookRequest]>();
  let restoreEnv: () => void;

  beforeEach(async () => {
    restoreEnv = blankWebhookEnv();
    alerts.rows.splice(0, alerts.rows.length);
    post.mockReset();
    post.mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      controllers: [AlertsController],
      providers: [
        AlertsService,
        SevereAlertPushService,
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: getRepositoryToken(AlertRule), useValue: {} },
        { provide: getRepositoryToken(Alert), useValue: alerts },
        { provide: getRepositoryToken(AlertRead), useValue: {} },
        { provide: AuditService, useValue: { write: jest.fn() } },
        {
          provide: ConfigService,
          useValue: configOf({
            wecomWebhookUrl: 'https://qyapi.example/hook',
            dingtalkWebhookUrl: 'https://oapi.example/robot',
          }),
        },
        { provide: ALERT_WEBHOOK_POST, useValue: post },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(assignUser);
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    restoreEnv();
  });

  it('keeps claim and close working when the webhook fails', async () => {
    post.mockRejectedValue(new Error('webhook down'));
    const created = await request(app.getHttpServer())
      .post('/api/v1/alerts')
      .set('x-test-role', 'super_admin')
      .send({
        shedCode: 'S01',
        cameraCode: 'CAM-1',
        level: 'severe',
        title: '高温',
        message: '超过阈值',
      });
    expect(created.status).toBe(201);
    expect(created.body.id).toBeTruthy();
    expect(post).toHaveBeenCalled();
    const callsAfterCreate = post.mock.calls.length;

    const claimed = await request(app.getHttpServer())
      .post(`/api/v1/alerts/${created.body.id}/claim`)
      .set('x-test-role', 'super_admin')
      .send({ note: '我来跟进' });
    expect(claimed.status).toBe(201);
    expect(claimed.body.claimedBy).toBe('admin');

    const closed = await request(app.getHttpServer())
      .post(`/api/v1/alerts/${created.body.id}/close`)
      .set('x-test-role', 'super_admin')
      .send({ note: '已处置' });
    expect(closed.status).toBe(201);
    expect(closed.body.status).toBe('closed');
    expect(closed.body.closeReason).toBe('resolved');
    expect(post.mock.calls.length).toBe(callsAfterCreate);
  });

  it('does not post warning alerts and reports channel flags', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/alerts')
      .set('x-test-role', 'production_admin')
      .send({
        shedCode: 'S01',
        level: 'warning',
        title: '一般高温',
        message: '略高',
      });
    expect(created.status).toBe(201);
    expect(post).not.toHaveBeenCalled();

    const channels = await request(app.getHttpServer())
      .get('/api/v1/alerts/push-channels')
      .set('x-test-role', 'viewer');
    expect(channels.status).toBe(200);
    expect(channels.body).toEqual({
      wecomEnabled: true,
      dingtalkEnabled: true,
    });
  });
});
