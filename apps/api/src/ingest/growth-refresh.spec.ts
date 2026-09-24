import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  shanghaiDayRange,
  shanghaiHourStart,
  shiftShanghaiDate,
  todayShanghai,
} from '@mushroom/contracts';
import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { AlertEngineService } from '../alerts';
import { IngestTokenGuard } from '../common/guards';
import { configureApp } from '../configure-app';
import { DevicesService } from '../devices';
import { DailyAggregate } from '../entities/daily-aggregate.entity';
import { EnvironmentReading } from '../entities/environment-reading.entity';
import { HeartbeatReceipt } from '../entities/heartbeat-receipt.entity';
import { IngestReject } from '../entities/ingest-reject.entity';
import {
  MetricBucketBase,
  MetricBucketDay,
  MetricBucketHour,
} from '../entities/metric-bucket.entity';
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

function ingestProviders(
  applyRecognition: jest.Mock,
  records: object,
  redis: object,
) {
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
    { provide: GrowthTrendService, useValue: { applyRecognition } },
  ];
}

describe('ingest refreshes daily aggregates', () => {
  it('upserts hour and day buckets after a new ingest and skips duplicates', async () => {
    const applyRecognition = jest.fn().mockResolvedValue(undefined);
    const saved: Partial<RecognitionRecord>[] = [];
    const moduleRef = await Test.createTestingModule({
      controllers: [IngestController],
      providers: ingestProviders(
        applyRecognition,
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
          setNx: jest.fn().mockResolvedValueOnce(true).mockResolvedValue(false),
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
    expect(applyRecognition).toHaveBeenCalledWith(
      expect.objectContaining({
        shedCode: golden.body.shedCode,
        cameraCode: golden.body.cameraCode,
        recognizedAt: new Date(String(golden.body.recognizedAt)),
        mushroomCount: golden.body.mushroomCount,
      }),
    );

    const duplicate = await request(app.getHttpServer())
      .post('/api/v1/ingest/recognition')
      .set('x-ingest-token', 'dev-ingest-token')
      .send(golden.body);
    expect(duplicate.body.duplicate).toBe(true);
    expect(applyRecognition).toHaveBeenCalledTimes(1);
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

function memoryRows<T extends { id?: string }>() {
  const rows: T[] = [];
  let seq = 0;
  const matches = (row: T, where?: Record<string, unknown>) => {
    if (!where) return true;
    return Object.entries(where).every(([key, value]) => {
      const current = (row as Record<string, unknown>)[key];
      if (value instanceof Date || current instanceof Date) {
        return (
          new Date(current as string | Date).getTime() ===
          new Date(value as string | Date).getTime()
        );
      }
      return current === value;
    });
  };
  return {
    rows,
    create: (input: Partial<T>) => ({ ...input }) as T,
    find: async (options?: { where?: Record<string, unknown> }) =>
      rows
        .filter((row) => matches(row, options?.where))
        .map((row) => ({ ...row })),
    findOne: async (options?: { where?: Record<string, unknown> }) => {
      const found = rows.find((row) => matches(row, options?.where));
      return found ? { ...found } : null;
    },
    save: async (input: T) => {
      const saved = {
        ...input,
        id: input.id ?? `row-${++seq}`,
      };
      const index = rows.findIndex((row) => row.id === saved.id);
      if (index >= 0) rows[index] = saved;
      else rows.push(saved);
      return { ...saved };
    },
    delete: async () => ({ affected: 0 }),
    createQueryBuilder: () => {
      throw new Error('ingest 增量路径不应重扫明细');
    },
  };
}

describe('ingest backfill updates historical buckets', () => {
  it('corrects the recognizedAt hour and day and does not double count', async () => {
    const day = shiftShanghaiDate(todayShanghai(), -2);
    const recognizedAt = new Date(`${day}T11:15:00+08:00`);
    const laterAt = new Date(recognizedAt.getTime() + 20 * 60 * 1000);
    const hours = memoryRows<MetricBucketBase>();
    const days = memoryRows<MetricBucketBase>();
    const records = memoryRows<RecognitionRecord>();
    const moduleRef = await Test.createTestingModule({
      controllers: [IngestController],
      providers: [
        IngestService,
        GrowthTrendService,
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
        { provide: getRepositoryToken(DailyAggregate), useValue: memoryRows() },
        { provide: getRepositoryToken(MetricBucketHour), useValue: hours },
        { provide: getRepositoryToken(MetricBucketDay), useValue: days },
        {
          provide: RedisService,
          useValue: {
            setNx: jest
              .fn()
              .mockResolvedValueOnce(true)
              .mockResolvedValueOnce(false)
              .mockResolvedValueOnce(true),
          },
        },
        { provide: MinioStorageService, useValue: {} },
        { provide: DevicesService, useValue: { touchCamera: jest.fn() } },
        { provide: AlertEngineService, useValue: { evaluate: jest.fn() } },
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    const first = {
      ...golden.body,
      idempotencyKey: 'backfill-older-1',
      recognizedAt: recognizedAt.toISOString(),
      mushroomCount: 11,
      matureCount: 4,
    };
    const created = await request(app.getHttpServer())
      .post('/api/v1/ingest/recognition')
      .set('x-ingest-token', 'dev-ingest-token')
      .send(first);
    expect(created.status).toBe(201);
    expect(created.body.duplicate).toBe(false);

    const duplicate = await request(app.getHttpServer())
      .post('/api/v1/ingest/recognition')
      .set('x-ingest-token', 'dev-ingest-token')
      .send(first);
    expect(duplicate.body.duplicate).toBe(true);

    const second = await request(app.getHttpServer())
      .post('/api/v1/ingest/recognition')
      .set('x-ingest-token', 'dev-ingest-token')
      .send({
        ...first,
        idempotencyKey: 'backfill-older-2',
        recognizedAt: laterAt.toISOString(),
        mushroomCount: 14,
        matureCount: 6,
      });
    expect(second.body.accepted).toBe(true);
    expect(second.body.duplicate).toBe(false);

    const hourStart = shanghaiHourStart(recognizedAt).getTime();
    const dayStart = shanghaiDayRange(day).start.getTime();
    const todayStart = shanghaiDayRange(todayShanghai()).start.getTime();
    const mushroom = (rows: MetricBucketBase[], cameraCode: string) =>
      rows.find(
        (row) =>
          row.metric === 'mushroom_count' && row.cameraCode === cameraCode,
      );
    const samples = hours.rows.find(
      (row) => row.metric === 'sample_count' && row.cameraCode === 'CAM-S01-01',
    );
    expect(samples?.value).toBe(2);
    expect(samples && new Date(samples.bucketStart).getTime()).toBe(hourStart);
    expect(mushroom(hours.rows, 'CAM-S01-01')?.value).toBe(14);
    expect(mushroom(days.rows, '')?.value).toBe(14);
    expect(new Date(days.rows[0].bucketStart).getTime()).toBe(dayStart);
    expect(
      [...hours.rows, ...days.rows].some(
        (row) => new Date(row.bucketStart).getTime() === todayStart,
      ),
    ).toBe(false);
    await app.close();
  });
});
