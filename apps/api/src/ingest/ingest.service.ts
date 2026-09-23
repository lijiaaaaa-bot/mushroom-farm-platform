import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { ListQuery, parsePage } from '../common/pagination';
import { ShedScope } from '../common/shed-scope';
import {
  IDEMPOTENCY_TTL_SECONDS,
  averageDiameter,
  buildIdempotencyKey,
  parseRecognitionIngress,
} from '@mushroom/contracts';
import { IngestReject } from '../entities/ingest-reject.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import { RedisService } from '../redis';
import { MinioStorageService } from '../storage';
import { AlertEngineService } from '../alerts';
import { DevicesService } from '../devices';
import { AuthUser } from '../common/auth-user';

export interface IngestResult {
  accepted: boolean;
  duplicate?: boolean;
  id?: string;
  code?: string;
  errors?: string[];
  snapshotStored?: boolean;
}

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    @InjectRepository(RecognitionRecord)
    private readonly records: Repository<RecognitionRecord>,
    @InjectRepository(IngestReject)
    private readonly rejects: Repository<IngestReject>,
    private readonly redis: RedisService,
    private readonly storage: MinioStorageService,
    private readonly devices: DevicesService,
    private readonly alerts: AlertEngineService,
  ) {}

  async handle(raw: unknown, source: 'http' | 'mqtt'): Promise<IngestResult> {
    const parsed = parseRecognitionIngress(raw);
    if (!parsed.ok) {
      await this.rejects.save(
        this.rejects.create({
          source,
          errors: parsed.errors,
          payload: redactIngress(raw),
        }),
      );
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
