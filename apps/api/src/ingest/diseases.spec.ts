import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Role } from '@mushroom/contracts';
import { NextFunction, Request, Response } from 'express';
import type { Response as SuperResponse } from 'superagent';
import request from 'supertest';
import { AlertEngineService } from '../alerts';
import { AuthUser } from '../common/auth-user';
import { IngestTokenGuard } from '../common/guards';
import { configureApp } from '../configure-app';
import { DevicesService } from '../devices';
import { DiseasesController } from '../diseases/diseases.controller';
import { EnvironmentReading } from '../entities/environment-reading.entity';
import { HeartbeatReceipt } from '../entities/heartbeat-receipt.entity';
import { IngestReject } from '../entities/ingest-reject.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import { RedisService } from '../redis';
import { MinioStorageService } from '../storage';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function row(
  partial: Partial<RecognitionRecord> &
    Pick<RecognitionRecord, 'id' | 'shedCode' | 'diseaseCount'>,
): RecognitionRecord {
  return {
    idempotencyKey: partial.id,
    cameraCode: 'CAM-1',
    recognizedAt: new Date('2026-09-23T01:00:00.000Z'),
    mushroomCount: 10,
    matureCount: 4,
    capDiameters: [],
    avgCapDiameter: null,
    diseaseLevel: partial.diseaseCount > 0 ? 1 : 0,
    snapshotObjectKey: null,
    snapshotUrl: null,
    temperature: null,
    humidity: null,
    co2: null,
    substrateMoisture: null,
    source: 'http',
    rawPayload: null,
    createdAt: new Date('2026-09-23T01:00:00.000Z'),
    ...partial,
  };
}

function memoryRecords(rows: RecognitionRecord[]) {
  return {
    findOne: async ({ where }: { where: { id?: string } }) =>
      rows.find((item) => item.id === where.id) ?? null,
    createQueryBuilder: () => {
      const filters: Array<(item: RecognitionRecord) => boolean> = [];
      let skip = 0;
      let take = rows.length;
      const qb = {
        orderBy: () => qb,
        andWhere: (sql: string, params?: Record<string, unknown>) => {
          if (sql === '1 = 0') filters.push(() => false);
          else if (sql === 'r.shedCode IN (:...codes)') {
            const codes = params?.codes as string[];
            filters.push((item) => codes.includes(item.shedCode));
          } else if (sql === 'r.shedCode = :shedCode') {
            filters.push((item) => item.shedCode === params?.shedCode);
          } else if (sql === 'r.cameraCode = :cameraCode') {
            filters.push((item) => item.cameraCode === params?.cameraCode);
          } else if (sql === 'r.recognizedAt >= :from') {
            const from = params?.from as Date;
            filters.push((item) => item.recognizedAt >= from);
          } else if (sql === 'r.recognizedAt <= :to') {
            const to = params?.to as Date;
            filters.push((item) => item.recognizedAt <= to);
          } else if (sql === 'r.diseaseCount > 0') {
            filters.push((item) => item.diseaseCount > 0);
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
            .filter((item) => filters.every((fn) => fn(item)))
            .sort(
              (a, b) => b.recognizedAt.getTime() - a.recognizedAt.getTime(),
            );
          return [matched.slice(skip, skip + take), matched.length] as const;
        },
      };
      return qb;
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

describe('disease list and snapshot access', () => {
  let app: INestApplication;
  const readObject = jest.fn(async (key: string) =>
    key.endsWith('.jpg') ? JPEG : null,
  );
  const records = memoryRecords([
    row({
      id: 'd-s01',
      shedCode: 'S01',
      diseaseCount: 2,
      diseaseLevel: 1,
      recognizedAt: new Date('2026-09-23T02:00:00.000Z'),
      snapshotObjectKey: 'snapshots/S01/2026-09-23/CAM-1/1.jpg',
    }),
    row({
      id: 'd-s02',
      shedCode: 'S02',
      diseaseCount: 3,
      diseaseLevel: 2,
      cameraCode: 'CAM-2',
      recognizedAt: new Date('2026-09-23T03:00:00.000Z'),
      snapshotUrl: 'https://example.test/shot.png',
    }),
    row({
      id: 'healthy',
      shedCode: 'S01',
      diseaseCount: 0,
      recognizedAt: new Date('2026-09-23T04:00:00.000Z'),
    }),
  ]);

  beforeEach(async () => {
    readObject.mockClear();
    const moduleRef = await Test.createTestingModule({
      controllers: [IngestController, DiseasesController],
      providers: [
        IngestService,
        IngestTokenGuard,
        {
          provide: ConfigService,
          useValue: { get: () => undefined },
        },
        { provide: getRepositoryToken(RecognitionRecord), useValue: records },
        { provide: getRepositoryToken(EnvironmentReading), useValue: {} },
        { provide: getRepositoryToken(IngestReject), useValue: {} },
        { provide: getRepositoryToken(HeartbeatReceipt), useValue: {} },
        { provide: RedisService, useValue: {} },
        {
          provide: MinioStorageService,
          useValue: { readObject },
        },
        { provide: DevicesService, useValue: {} },
        { provide: AlertEngineService, useValue: {} },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(assignUser);
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    if (app) await app.close();
  });

  it('filters diseaseCount > 0 on the recognition list', async () => {
    const filtered = await request(app.getHttpServer())
      .get('/api/v1/ingest/recognitions')
      .query({ diseased: '1', pageSize: '50' })
      .set('x-test-role', 'super_admin');
    const all = await request(app.getHttpServer())
      .get('/api/v1/ingest/recognitions')
      .query({ pageSize: '50' })
      .set('x-test-role', 'super_admin');

    expect(filtered.status).toBe(200);
    expect(filtered.body.items.map((item: { id: string }) => item.id)).toEqual([
      'd-s02',
      'd-s01',
    ]);
    expect(filtered.body.total).toBe(2);
    expect(all.body.items.map((item: { id: string }) => item.id)).toContain(
      'healthy',
    );
    expect(all.body.total).toBe(3);
  });

  it('lists diseased rows from GET /diseases for a super admin', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/diseases')
      .query({ pageSize: '50' })
      .set('x-test-role', 'super_admin');

    expect(response.status).toBe(200);
    expect(response.body.items.map((item: { id: string }) => item.id)).toEqual([
      'd-s02',
      'd-s01',
    ]);
    expect(
      response.body.items.every(
        (item: { diseaseCount: number }) => item.diseaseCount > 0,
      ),
    ).toBe(true);
  });

  it('keeps shed managers inside their sheds on the disease list and snapshot', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/diseases')
      .query({ pageSize: '50' })
      .set('x-test-role', 'shed_manager');
    const own = await request(app.getHttpServer())
      .get('/api/v1/ingest/recognitions/d-s01/snapshot')
      .set('x-test-role', 'shed_manager')
      .buffer(true)
      .parse(binaryParser);
    const other = await request(app.getHttpServer())
      .get('/api/v1/ingest/recognitions/d-s02/snapshot')
      .set('x-test-role', 'shed_manager');

    expect(list.status).toBe(200);
    expect(list.body.items.map((item: { id: string }) => item.id)).toEqual([
      'd-s01',
    ]);
    expect(own.status).toBe(200);
    expect(own.headers['content-type']).toMatch(/image\/jpeg/);
    expect(Buffer.from(own.body)).toEqual(JPEG);
    expect(other.status).toBe(403);
    expect(readObject).toHaveBeenCalledWith(
      'snapshots/S01/2026-09-23/CAM-1/1.jpg',
    );
    expect(readObject).not.toHaveBeenCalledWith(expect.stringContaining('S02'));
  });

  it('returns an empty disease list when a viewer has no sheds', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/diseases')
      .set('x-test-role', 'viewer')
      .set('x-test-sheds', '');

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([]);
    expect(response.body.total).toBe(0);
  });

  it('proxies a snapshot URL when the object key is absent', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: async () =>
        PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength),
    } as unknown as globalThis.Response);

    const response = await request(app.getHttpServer())
      .get('/api/v1/ingest/recognitions/d-s02/snapshot')
      .set('x-test-role', 'super_admin')
      .buffer(true)
      .parse(binaryParser);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/image\/png/);
    expect(Buffer.from(response.body)).toEqual(PNG);
    expect(readObject).not.toHaveBeenCalled();
  });

  it('returns 404 when the record has no snapshot', async () => {
    const missing = await request(app.getHttpServer())
      .get('/api/v1/ingest/recognitions/missing/snapshot')
      .set('x-test-role', 'super_admin');
    const empty = await request(app.getHttpServer())
      .get('/api/v1/ingest/recognitions/healthy/snapshot')
      .set('x-test-role', 'super_admin');

    expect(missing.status).toBe(404);
    expect(empty.status).toBe(404);
    expect(empty.body.message).toBe('无抓拍');
    expect(readObject).not.toHaveBeenCalled();
  });
});

function binaryParser(
  res: SuperResponse,
  callback: (error: Error | null, body: Buffer) => void,
) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer | string) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  res.on('end', () => callback(null, Buffer.concat(chunks)));
  res.on('error', (error: Error) => callback(error, Buffer.alloc(0)));
}
