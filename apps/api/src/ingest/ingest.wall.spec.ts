import { readFileSync } from 'fs';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { AlertEngineService } from '../alerts';
import { IngestTokenGuard } from '../common/guards';
import { configureApp } from '../configure-app';
import { DevicesService } from '../devices';
import { EnvironmentReading } from '../entities/environment-reading.entity';
import { HeartbeatReceipt } from '../entities/heartbeat-receipt.entity';
import { IngestReject } from '../entities/ingest-reject.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import { RedisService } from '../redis';
import { MinioStorageService } from '../storage';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';
import { MqttIngestAdapter } from './mqtt.adapter';

const fixture = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '../../../../packages/contracts/fixtures/recognition.unknown-field.json',
    ),
    'utf8',
  ),
) as { expect: string; body: Record<string, unknown> };

describe('ingest wall', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const rejectRepo = {
      create: jest.fn((row: unknown) => row),
      save: jest.fn(async (row: unknown) => row),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [IngestController],
      providers: [
        IngestService,
        IngestTokenGuard,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'ingestToken' ? 'dev-ingest-token' : undefined,
          },
        },
        {
          provide: getRepositoryToken(RecognitionRecord),
          useValue: { create: jest.fn(), save: jest.fn(), findOne: jest.fn() },
        },
        {
          provide: getRepositoryToken(EnvironmentReading),
          useValue: { create: jest.fn(), save: jest.fn(), findOne: jest.fn() },
        },
        { provide: getRepositoryToken(IngestReject), useValue: rejectRepo },
        {
          provide: getRepositoryToken(HeartbeatReceipt),
          useValue: { create: jest.fn(), save: jest.fn() },
        },
        { provide: RedisService, useValue: {} },
        { provide: MinioStorageService, useValue: {} },
        { provide: DevicesService, useValue: { heartbeat: jest.fn() } },
        { provide: AlertEngineService, useValue: { evaluate: jest.fn() } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('HTTP unknown field returns UNKNOWN_FIELD through IngestService', async () => {
    expect(fixture.expect).toBe('UNKNOWN_FIELD');
    const ingest = app.get(IngestService);
    const spy = jest.spyOn(ingest, 'handle');
    const response = await request(app.getHttpServer())
      .post('/api/v1/ingest/recognition')
      .set('x-ingest-token', 'dev-ingest-token')
      .send(fixture.body);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe(fixture.expect);
    expect(String(response.body.errors)).toContain('未知字段');
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ unexpectedSensor: 1 }),
      'http',
    );
  });

  it('MQTT unknown field returns UNKNOWN_FIELD through IngestService', async () => {
    expect(fixture.expect).toBe('UNKNOWN_FIELD');
    const ingest = app.get(IngestService);
    const spy = jest.spyOn(ingest, 'handle');
    const adapter = new MqttIngestAdapter(
      app.get(ConfigService),
      ingest,
      app.get(DevicesService),
    );
    await adapter.onMessage(
      'mushroom/S01/CAM-S01-01/recognition',
      Buffer.from(JSON.stringify(fixture.body)),
    );
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ unexpectedSensor: 1 }),
      'mqtt',
    );
    await expect(spy.mock.results[0].value).resolves.toMatchObject({
      accepted: false,
      code: 'UNKNOWN_FIELD',
    });
  });
});
