import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ObjectLiteral, QueryFailedError, Repository } from 'typeorm';
import { ListQuery, parsePage } from '../common/pagination';
import { ShedScope } from '../common/shed-scope';
import {
  DISEASE_ENV_WINDOW_MINUTES,
  IDEMPOTENCY_TTL_SECONDS,
  averageDiameter,
  buildEnvironmentIdempotencyKey,
  buildIdempotencyKey,
  parseEnvironmentIngress,
  parseRecognitionIngress,
} from '@mushroom/contracts';
import { EnvironmentReading } from '../entities/environment-reading.entity';
import { HeartbeatReceipt } from '../entities/heartbeat-receipt.entity';
import { IngestChannel, IngestReject } from '../entities/ingest-reject.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import { RedisService } from '../redis';
import { MinioStorageService } from '../storage';
import { AlertEngineService } from '../alerts';
import { DevicesService } from '../devices';
import { GrowthTrendService } from '../growth';
import { AuthUser } from '../common/auth-user';

export interface IngestResult {
  accepted: boolean;
  duplicate?: boolean;
  id?: string;
  code?: string;
  errors?: string[];
  snapshotStored?: boolean;
}

export interface IngestObservabilityChannel {
  channel: IngestChannel;
  transport: 'http' | 'mqtt';
  accepted: number;
  rejected: number;
  latencyP50Ms: number | null;
  latencyLatestMs: number | null;
}

export interface IngestObservabilityError {
  id: string;
  channel: IngestChannel;
  transport: 'http' | 'mqtt';
  shedCode: string | null;
  code: string | null;
  errors: string[];
  createdAt: string;
}

export interface IngestObservability {
  windowMinutes: number;
  from: string;
  accepted: number;
  rejected: number;
  latencyP50Ms: number | null;
  latencyLatestMs: number | null;
  channels: IngestObservabilityChannel[];
  recentErrors: IngestObservabilityError[];
}

const OBSERVABILITY_CHANNELS: Array<[IngestChannel, 'http' | 'mqtt']> = [
  ['recognition', 'http'],
  ['recognition', 'mqtt'],
  ['environment', 'http'],
  ['environment', 'mqtt'],
  ['heartbeat', 'http'],
  ['heartbeat', 'mqtt'],
];

const DEFAULT_WINDOW_MINUTES = 60;
const MAX_WINDOW_MINUTES = 24 * 60;
const RECENT_ERROR_LIMIT = 20;

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    @InjectRepository(RecognitionRecord)
    private readonly records: Repository<RecognitionRecord>,
    @InjectRepository(EnvironmentReading)
    private readonly readings: Repository<EnvironmentReading>,
    @InjectRepository(IngestReject)
    private readonly rejects: Repository<IngestReject>,
    @InjectRepository(HeartbeatReceipt)
    private readonly heartbeats: Repository<HeartbeatReceipt>,
    private readonly redis: RedisService,
    private readonly storage: MinioStorageService,
    private readonly devices: DevicesService,
    private readonly alerts: AlertEngineService,
    @Optional()
    @Inject(GrowthTrendService)
    private readonly growth?: GrowthTrendService,
  ) {}

  async handle(raw: unknown, source: 'http' | 'mqtt'): Promise<IngestResult> {
    const parsed = parseRecognitionIngress(raw);
    if (!parsed.ok) {
      await this.recordReject({
        source,
        channel: 'recognition',
        code: parsed.code,
        errors: parsed.errors,
        payload: raw,
      });
      this.logger.warn(`丢弃${source}上报：${parsed.errors.join('；')}`);
      return { accepted: false, code: parsed.code, errors: parsed.errors };
    }
    const canonical = parsed.value;
    const idempotencyKey =
      canonical.idempotencyKey ||
      buildIdempotencyKey({
        shedCode: canonical.shedCode,
        cameraCode: canonical.cameraCode,
        recognizedAt: canonical.recognizedAt,
      });
    const redisFresh = await this.redis.setNx(
      `ingest:idemp:${idempotencyKey}`,
      IDEMPOTENCY_TTL_SECONDS,
    );
    if (redisFresh === false) {
      const existing = await this.records.findOne({
        where: { idempotencyKey },
      });
      if (existing) return { accepted: true, duplicate: true, id: existing.id };
    }
    const recognizedAt = new Date(canonical.recognizedAt);
    let snapshotObjectKey: string | null = null;
    let snapshotUrl = canonical.snapshotUrl ?? null;
    let snapshotStored = false;
    try {
      const bytes = await this.readImage(
        canonical.snapshotBase64,
        canonical.snapshotUrl,
      );
      if (bytes) {
        const stored = await this.storage.putSnapshot(
          canonical.shedCode,
          canonical.cameraCode,
          recognizedAt,
          bytes,
        );
        if (stored) {
          snapshotObjectKey = stored.objectKey;
          snapshotUrl = stored.url;
          snapshotStored = true;
        }
      }
    } catch (error) {
      this.logger.warn(
        `抓拍存储失败，识别记录仍入库：${(error as Error).message}`,
      );
    }
    try {
      const saved = await this.records.save(
        this.records.create({
          idempotencyKey,
          shedCode: canonical.shedCode,
          cameraCode: canonical.cameraCode,
          recognizedAt,
          mushroomCount: canonical.mushroomCount,
          matureCount: canonical.matureCount,
          capDiameters: canonical.capDiameters,
          avgCapDiameter: averageDiameter(canonical.capDiameters),
          diseaseCount: canonical.diseaseCount,
          diseaseLevel: canonical.diseaseLevel,
          snapshotObjectKey,
          snapshotUrl,
          temperature: canonical.temperature ?? null,
          humidity: canonical.humidity ?? null,
          co2: canonical.co2 ?? null,
          substrateMoisture: canonical.substrateMoisture ?? null,
          source,
          rawPayload: redactIngress(raw),
        }),
      );
      await this.devices.touchCamera(saved.shedCode, saved.cameraCode);
      await this.alerts.evaluate(saved);
      try {
        await this.growth?.applyRecognition({
          id: saved.id,
          shedCode: saved.shedCode,
          cameraCode: saved.cameraCode,
          recognizedAt: saved.recognizedAt,
          mushroomCount: saved.mushroomCount,
          avgCapDiameter: saved.avgCapDiameter,
        });
      } catch (refreshError) {
        this.logger.warn(
          `指标桶更新失败，识别记录已入库：${(refreshError as Error).message}`,
        );
      }
      return { accepted: true, duplicate: false, id: saved.id, snapshotStored };
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const existing = await this.records.findOne({
          where: { idempotencyKey },
        });
        return { accepted: true, duplicate: true, id: existing?.id };
      }
      throw error;
    }
  }

  async handleEnvironment(
    raw: unknown,
    source: 'http' | 'mqtt',
  ): Promise<IngestResult> {
    const parsed = parseEnvironmentIngress(raw);
    if (!parsed.ok) {
      await this.recordReject({
        source,
        channel: 'environment',
        code: parsed.code,
        errors: parsed.errors,
        payload: raw,
      });
      this.logger.warn(`丢弃${source}环境上报：${parsed.errors.join('；')}`);
      return { accepted: false, code: parsed.code, errors: parsed.errors };
    }
    const canonical = parsed.value;
    const idempotencyKey =
      canonical.idempotencyKey ||
      buildEnvironmentIdempotencyKey({
        shedCode: canonical.shedCode,
        sensorCode: canonical.sensorCode,
        observedAt: canonical.observedAt,
      });
    const redisFresh = await this.redis.setNx(
      `ingest:env:idemp:${idempotencyKey}`,
      IDEMPOTENCY_TTL_SECONDS,
    );
    if (redisFresh === false) {
      const existing = await this.readings.findOne({
        where: { idempotencyKey },
      });
      if (existing) return { accepted: true, duplicate: true, id: existing.id };
    }
    try {
      const saved = await this.readings.save(
        this.readings.create({
          idempotencyKey,
          shedCode: canonical.shedCode,
          sensorCode: canonical.sensorCode,
          observedAt: new Date(canonical.observedAt),
          temperature: canonical.temperature ?? null,
          humidity: canonical.humidity ?? null,
          co2: canonical.co2 ?? null,
          substrateMoisture: canonical.substrateMoisture ?? null,
          source,
          rawPayload: raw,
        }),
      );
      try {
        await this.devices.heartbeat(
          saved.shedCode,
          saved.sensorCode,
          'sensor',
          true,
        );
      } catch (error) {
        this.logger.warn(
          `环境读数已入库，传感器心跳未更新：${(error as Error).message}`,
        );
      }
      return { accepted: true, duplicate: false, id: saved.id };
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const existing = await this.readings.findOne({
          where: { idempotencyKey },
        });
        return { accepted: true, duplicate: true, id: existing?.id };
      }
      throw error;
    }
  }

  async recordReject(input: {
    source: 'http' | 'mqtt';
    channel: IngestChannel;
    code?: string;
    errors: string[];
    payload?: unknown;
    shedCode?: string | null;
  }): Promise<void> {
    const shedCode =
      input.shedCode !== undefined
        ? input.shedCode
        : shedFromPayload(input.payload);
    await this.rejects.save(
      this.rejects.create({
        source: input.source,
        channel: input.channel,
        shedCode,
        code: input.code ?? null,
        errors: input.errors,
        payload:
          input.channel === 'recognition'
            ? redactIngress(input.payload)
            : (input.payload ?? null),
      }),
    );
  }

  async recordHeartbeat(input: {
    source: 'http' | 'mqtt';
    shedCode: string;
    deviceCode: string;
    duplicate: boolean;
    reportedAt?: string;
  }): Promise<void> {
    await this.heartbeats.save(
      this.heartbeats.create({
        source: input.source,
        shedCode: input.shedCode,
        deviceCode: input.deviceCode,
        duplicate: input.duplicate,
        latencyMs: heartbeatLatencyMs(input.reportedAt),
      }),
    );
  }

  async observability(
    user: AuthUser,
    windowMinutes?: string | number,
  ): Promise<IngestObservability> {
    const minutes = parseWindowMinutes(windowMinutes);
    const since = new Date(Date.now() - minutes * 60_000);
    const scope = ShedScope.fromUser(user);
    const [recognitions, readings, beats, errors] = await Promise.all([
      this.loadSince(this.records, 'r', since, scope),
      this.loadSince(this.readings, 'e', since, scope),
      this.loadSince(this.heartbeats, 'h', since, scope),
      this.loadSince(this.rejects, 'j', since, scope),
    ]);
    const buckets = new Map<string, LatencyBucket>(
      OBSERVABILITY_CHANNELS.map(([channel, transport]) => [
        bucketKey(channel, transport),
        { channel, transport, accepted: 0, rejected: 0, samples: [] },
      ]),
    );
    for (const row of recognitions) {
      addAccepted(
        buckets,
        'recognition',
        row.source,
        row.createdAt,
        latencyBetween(row.createdAt, row.recognizedAt),
      );
    }
    for (const row of readings) {
      addAccepted(
        buckets,
        'environment',
        row.source,
        row.createdAt,
        latencyBetween(row.createdAt, row.observedAt),
      );
    }
    for (const row of beats) {
      addAccepted(
        buckets,
        'heartbeat',
        row.source,
        row.createdAt,
        row.latencyMs,
      );
    }
    for (const row of errors) {
      const bucket = buckets.get(bucketKey(row.channel, row.source));
      if (bucket) bucket.rejected += 1;
    }
    const channels = OBSERVABILITY_CHANNELS.map(([channel, transport]) => {
      const bucket = buckets.get(bucketKey(channel, transport))!;
      const stats = percentile50(bucket.samples);
      return {
        channel,
        transport,
        accepted: bucket.accepted,
        rejected: bucket.rejected,
        latencyP50Ms: stats.p50,
        latencyLatestMs: stats.latest,
      };
    });
    const allSamples = [...buckets.values()].flatMap(
      (bucket) => bucket.samples,
    );
    const totals = percentile50(allSamples);
    return {
      windowMinutes: minutes,
      from: since.toISOString(),
      accepted: channels.reduce((sum, row) => sum + row.accepted, 0),
      rejected: channels.reduce((sum, row) => sum + row.rejected, 0),
      latencyP50Ms: totals.p50,
      latencyLatestMs: totals.latest,
      channels,
      recentErrors: errors.slice(0, RECENT_ERROR_LIMIT).map((row) => ({
        id: row.id,
        channel: row.channel,
        transport: row.source,
        shedCode: row.shedCode,
        code: row.code,
        errors: row.errors,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  private async loadSince<T extends ObjectLiteral>(
    repo: Repository<T>,
    alias: string,
    since: Date,
    scope: ShedScope,
    take?: number,
  ): Promise<T[]> {
    const qb = repo
      .createQueryBuilder(alias)
      .where(`${alias}.createdAt >= :since`, { since });
    if (scope.codes) {
      if (!scope.codes.length) qb.andWhere('1 = 0');
      else
        qb.andWhere(`${alias}.shedCode IN (:...codes)`, { codes: scope.codes });
    }
    qb.orderBy(`${alias}.createdAt`, 'DESC');
    if (take) qb.take(take);
    return qb.getMany();
  }

  async list(user: AuthUser, query: ListQuery) {
    const scope = ShedScope.fromUser(user);
    if (query.shedCode) scope.assert(query.shedCode);
    const page = parsePage(query);
    const qb = this.records
      .createQueryBuilder('r')
      .orderBy('r.recognizedAt', 'DESC');
    if (scope.codes) {
      if (!scope.codes.length) qb.andWhere('1 = 0');
      else qb.andWhere('r.shedCode IN (:...codes)', { codes: scope.codes });
    }
    if (query.shedCode)
      qb.andWhere('r.shedCode = :shedCode', { shedCode: query.shedCode });
    if (query.cameraCode) {
      qb.andWhere('r.cameraCode = :cameraCode', {
        cameraCode: query.cameraCode,
      });
    }
    if (query.from)
      qb.andWhere('r.recognizedAt >= :from', { from: new Date(query.from) });
    if (query.to)
      qb.andWhere('r.recognizedAt <= :to', { to: new Date(query.to) });
    if (isDiseasedQuery(query.diseased)) qb.andWhere('r.diseaseCount > 0');
    const [items, total] = await qb
      .skip(page.skip)
      .take(page.pageSize)
      .getManyAndCount();
    return { items, total, page: page.page, pageSize: page.pageSize };
  }

  async listEnvironment(user: AuthUser, query: ListQuery) {
    const scope = ShedScope.fromUser(user);
    if (query.shedCode) scope.assert(query.shedCode);
    const page = parsePage(query);
    const qb = this.readings
      .createQueryBuilder('e')
      .orderBy('e.observedAt', 'DESC');
    if (scope.codes) {
      if (!scope.codes.length) qb.andWhere('1 = 0');
      else qb.andWhere('e.shedCode IN (:...codes)', { codes: scope.codes });
    }
    if (query.shedCode)
      qb.andWhere('e.shedCode = :shedCode', { shedCode: query.shedCode });
    if (query.from)
      qb.andWhere('e.observedAt >= :from', { from: new Date(query.from) });
    if (query.to)
      qb.andWhere('e.observedAt <= :to', { to: new Date(query.to) });
    const [items, total] = await qb
      .skip(page.skip)
      .take(page.pageSize)
      .getManyAndCount();
    return { items, total, page: page.page, pageSize: page.pageSize };
  }

  async diseaseEnvironment(
    user: AuthUser,
    id: string,
    options: {
      beforeMinutes?: number;
      afterMinutes?: number;
      sensorCode?: string;
    },
  ) {
    const record = await this.records.findOne({ where: { id } });
    if (!record) throw new NotFoundException('病害记录不存在');
    ShedScope.fromUser(user).assert(record.shedCode);

    const beforeMinutes = options.beforeMinutes ?? DISEASE_ENV_WINDOW_MINUTES;
    const afterMinutes = options.afterMinutes ?? DISEASE_ENV_WINDOW_MINUTES;
    const recognizedAt = new Date(record.recognizedAt);
    const start = new Date(recognizedAt.getTime() - beforeMinutes * 60_000);
    const end = new Date(recognizedAt.getTime() + afterMinutes * 60_000);
    const sensorCode = options.sensorCode?.trim() || null;

    const qb = this.readings
      .createQueryBuilder('e')
      .where('e.shedCode = :shedCode', { shedCode: record.shedCode })
      .andWhere('e.observedAt >= :start', { start })
      .andWhere('e.observedAt <= :end', { end })
      .orderBy('e.observedAt', 'ASC');
    if (sensorCode) {
      qb.andWhere('e.sensorCode = :sensorCode', { sensorCode });
    }
    const readings = await qb.getMany();
    return {
      recognition: {
        id: record.id,
        shedCode: record.shedCode,
        cameraCode: record.cameraCode,
        recognizedAt,
        diseaseLevel: record.diseaseLevel,
        diseaseCount: record.diseaseCount,
      },
      window: { start, end, beforeMinutes, afterMinutes },
      alignment: { shedCode: record.shedCode, sensorCode },
      readings: readings.map((item) => ({
        id: item.id,
        shedCode: item.shedCode,
        sensorCode: item.sensorCode,
        observedAt: item.observedAt,
        temperature: item.temperature,
        humidity: item.humidity,
        co2: item.co2,
        substrateMoisture: item.substrateMoisture,
      })),
      empty: readings.length === 0,
      emptyReason: readings.length === 0 ? '该时间窗内无环境读数' : null,
    };
  }

  async readSnapshot(
    user: AuthUser,
    id: string,
  ): Promise<{ body: Buffer; contentType: string }> {
    const record = await this.records.findOne({ where: { id } });
    if (!record) throw new NotFoundException('识别记录不存在');
    ShedScope.fromUser(user).assert(record.shedCode);
    const fromObject = record.snapshotObjectKey
      ? await this.storage.readObject(record.snapshotObjectKey)
      : null;
    if (fromObject?.length) {
      return {
        body: fromObject,
        contentType: snapshotContentType(
          record.snapshotObjectKey,
          record.snapshotUrl,
        ),
      };
    }
    if (record.snapshotUrl && isHttpUrl(record.snapshotUrl)) {
      const bytes = await this.readImage(undefined, record.snapshotUrl);
      if (bytes?.length) {
        return {
          body: bytes,
          contentType: snapshotContentType(null, record.snapshotUrl),
        };
      }
    }
    throw new NotFoundException(
      record.snapshotObjectKey || record.snapshotUrl ? '抓拍不可用' : '无抓拍',
    );
  }

  private async readImage(
    base64?: string,
    url?: string,
  ): Promise<Buffer | null> {
    if (base64) return Buffer.from(base64, 'base64');
    if (!url) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return null;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 8 * 1024 * 1024) return null;
      return bytes;
    } catch (error) {
      this.logger.warn(`抓拍下载失败：${(error as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    const driver = error.driverError as { code?: string };
    return driver?.code === '23505';
  }
}

interface LatencySample {
  at: number;
  latencyMs: number;
}

interface LatencyBucket {
  channel: IngestChannel;
  transport: 'http' | 'mqtt';
  accepted: number;
  rejected: number;
  samples: LatencySample[];
}

function bucketKey(channel: IngestChannel, transport: 'http' | 'mqtt'): string {
  return `${channel}:${transport}`;
}

function addAccepted(
  buckets: Map<string, LatencyBucket>,
  channel: IngestChannel,
  transport: 'http' | 'mqtt',
  at: Date,
  latencyMs: number | null,
) {
  const bucket = buckets.get(bucketKey(channel, transport));
  if (!bucket) return;
  bucket.accepted += 1;
  if (latencyMs !== null && Number.isFinite(latencyMs)) {
    bucket.samples.push({ at: at.getTime(), latencyMs });
  }
}

function latencyBetween(received: Date, event: Date): number | null {
  if (!received || !event) return null;
  const latency = received.getTime() - event.getTime();
  if (!Number.isFinite(latency)) return null;
  return Math.max(0, latency);
}

function heartbeatLatencyMs(reportedAt?: string): number | null {
  if (!reportedAt) return null;
  const at = new Date(reportedAt);
  if (Number.isNaN(at.getTime())) return null;
  return Math.max(0, Date.now() - at.getTime());
}

function percentile50(samples: LatencySample[]): {
  p50: number | null;
  latest: number | null;
} {
  if (!samples.length) return { p50: null, latest: null };
  const latest = samples.reduce((best, item) =>
    item.at >= best.at ? item : best,
  ).latencyMs;
  const sorted = samples.map((item) => item.latencyMs).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const p50 =
    sorted.length % 2 === 1
      ? sorted[mid]
      : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  return { p50, latest };
}

function parseWindowMinutes(raw?: string | number): number {
  if (raw === undefined || raw === '') return DEFAULT_WINDOW_MINUTES;
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_WINDOW_MINUTES;
  return Math.min(MAX_WINDOW_MINUTES, Math.max(1, Math.floor(value)));
}

function shedFromPayload(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const value = body.shedCode ?? body['棚区编号'];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function isDiseasedQuery(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function snapshotContentType(key: string | null, url: string | null): string {
  const name = `${key ?? ''} ${url ?? ''}`.toLowerCase();
  if (name.includes('.png')) return 'image/png';
  if (name.includes('.webp')) return 'image/webp';
  if (name.includes('.gif')) return 'image/gif';
  return 'image/jpeg';
}

function redactIngress(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const clone: Record<string, unknown> = {
    ...(raw as Record<string, unknown>),
  };
  for (const key of ['snapshotBase64', '抓拍图Base64', 'AI抓拍图', '抓拍图']) {
    const value = clone[key];
    if (
      typeof value === 'string' &&
      value.length > 256 &&
      !/^https?:\/\//i.test(value)
    ) {
      clone[key] = `[redacted ${value.length} chars]`;
    }
  }
  return clone;
}
