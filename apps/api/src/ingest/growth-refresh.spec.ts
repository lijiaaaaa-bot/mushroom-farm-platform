import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { shanghaiDate } from '@mushroom/contracts';
import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { AlertEngineService } from '../alerts';
import { IngestTokenGuard } from '../common/guards';
import { configureApp } from '../configure-app';
import { DevicesService } from '../devices';
import { EnvironmentReading } from '../entities/environment-reading.entity';
import { HeartbeatReceipt } from '../entities/heartbeat-receipt.entity';
import { IngestReject } from '../entities/ingest-reject.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import { GrowthTrendService } from '../growth';
import { RedisService } from '../redis';
import { MinioStorageService } from '../storage';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';

const golden = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '../../../../packages/contracts/fixtures/recognition.golden.json',
    ),
    'utf8',
  ),
) as { body: Record<string, unknown> };

function ingestProviders(refreshDay: jest.Mock, records: object, redis: object) {
  return [
    IngestService,
    IngestTokenGuard,
    {
      provide: ConfigService,
      useValue: {
        get: (key: string) =>
          key === 'ingestToken' ? 'dev-ingest-token' : undefined,
      },
    },
    { provide: getRepositoryToken(RecognitionRecord), useValue: records },
    { provide: getRepositoryToken(EnvironmentReading), useValue: {} },
    {
      provide: getRepositoryToken(IngestReject),
      useValue: {
        create: (row: unknown) => row,
        save: async (row: unknown) => row,
      },
    },
    { provide: getRepositoryToken(HeartbeatReceipt), useValue: {} },
    { provide: RedisService, useValue: redis },
    { provide: MinioStorageService, useValue: {} },
    { provide: DevicesService, useValue: { touchCamera: jest.fn() } },
    { provide: AlertEngineService, useValue: { evaluate: jest.fn() } },
    { provide: GrowthTrendService, useValue: { refreshDay } },
  ];
}

describe('ingest refreshes daily aggregates', () => {
  it('refreshes the recognition day after a new ingest and skips duplicates', async () => {
    const refreshDay = jest.fn().mockResolvedValue([]);
    const saved: Partial<RecognitionRecord>[] = [];
    const moduleRef = await Test.createTestingModule({
      controllers: [IngestController],
      providers: ingestProviders(
        refreshDay,
        {
          create: (row: Partial<RecognitionRecord>) => row,
          save: async (row: Partial<RecognitionRecord>) => {
            const stored = { ...row, id: 'rec-1' };
            saved.push(stored);
            return stored;
          },
          findOne: async () => (saved[0] ? saved[0] : null),
        },
        {
          setNx: jest
            .fn()
            .mockResolvedValueOnce(true)
            .mockResolvedValue(false),
        },
      ),
    }).compile();
    const app: INestApplication = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    const created = await request(app.getHttpServer())
      .post('/api/v1/ingest/recognition')
      .set('x-ingest-token', 'dev-ingest-token')
      .send(golden.body);
    expect(created.status).toBe(201);
    expect(created.body.accepted).toBe(true);
    expect(refreshDay).toHaveBeenCalledWith(
      shanghaiDate(new Date(String(golden.body.recognizedAt))),
    );

    const duplicate = await request(app.getHttpServer())
      .post('/api/v1/ingest/recognition')
      .set('x-ingest-token', 'dev-ingest-token')
      .send(golden.body);
    expect(duplicate.body.duplicate).toBe(true);
    expect(refreshDay).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('keeps the recognition when the daily refresh fails', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [IngestController],
      providers: ingestProviders(
        jest.fn().mockRejectedValue(new Error('db')),
        {
          create: (row: Partial<RecognitionRecord>) => row,
          save: async (row: Partial<RecognitionRecord>) => ({
            ...row,
            id: 'rec-1',
          }),
          findOne: async () => null,
        },
        { setNx: async () => true },
      ),
    }).compile();
    const app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    const created = await request(app.getHttpServer())
      .post('/api/v1/ingest/recognition')
      .set('x-ingest-token', 'dev-ingest-token')
      .send(golden.body);
    expect(created.status).toBe(201);
    expect(created.body.accepted).toBe(true);
    await app.close();
  });
});
