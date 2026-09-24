import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  shanghaiDate,
  shanghaiDayRange,
  shanghaiHourStart,
  todayShanghai,
} from '@mushroom/contracts';
import { AuthUser } from '../common/auth-user';
import { ShedScope } from '../common/shed-scope';
import { DailyAggregate } from '../entities/daily-aggregate.entity';
import {
  MetricBucketBase,
  MetricBucketDay,
  MetricBucketHour,
} from '../entities/metric-bucket.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import {
  AggregateSource,
  DailyAggregateDraft,
  aggregateDay,
  shiftShanghaiDay,
} from './growth-trend.aggregate';
import {
  BucketView,
  RecognitionDelta,
  bucketKey,
  dailyDraftsFromBuckets,
  foldBuckets,
  applyRecognitionToBuckets,
} from './metric-bucket.apply';

export interface GrowthPoint {
  day: string;
  mushroomCount: number;
  capDiameterMean: number | null;
  sampleCount: number;
}

export interface GrowthTrendSeries {
  days: 7 | 30;
  from: string;
  to: string;
  mushroomCount: 'latest_per_camera';
  capDiameter: 'mean';
  sheds: Array<{
    shedCode: string;
    points: GrowthPoint[];
    cameras: Array<{ cameraCode: string; points: GrowthPoint[] }>;
  }>;
}

@Injectable()
export class GrowthTrendService {
  private readonly logger = new Logger(GrowthTrendService.name);

  constructor(
    @InjectRepository(DailyAggregate)
    private readonly aggregates: Repository<DailyAggregate>,
    @InjectRepository(RecognitionRecord)
    private readonly records: Repository<RecognitionRecord>,
    @InjectRepository(MetricBucketHour)
    private readonly hourBuckets: Repository<MetricBucketHour>,
    @InjectRepository(MetricBucketDay)
    private readonly dayBuckets: Repository<MetricBucketDay>,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async scheduled() {
    const result = await this.rebuildRecent();
    this.logger.log(`生长趋势日聚合：${JSON.stringify(result)}`);
    return result;
  }

  async rebuildRecent(now = new Date()) {
    const today = todayShanghai(now);
    const yesterday = shiftShanghaiDay(today, -1);
    const days = [yesterday, today];
    let upserted = 0;
    for (const day of days) {
      upserted += (await this.refreshDay(day)).length;
    }
    return { days, upserted };
  }

  async refreshDay(day: string) {
    const { start, end } = shanghaiDayRange(day);
    const rows = await this.records
      .createQueryBuilder('r')
      .where('r.recognizedAt >= :start AND r.recognizedAt < :end', {
        start,
        end,
      })
      .getMany();
    const points = await this.applyRecords(day, rows);
    await this.rebuildMetricBuckets(start, end, rows);
    return points;
  }

  /**
   * 识别入库后的写路径：按 recognizedAt 的上海小时和上海日增量 upsert。
   * 不扫描当日明细。同一幂等键只能调用一次。
   */
  async applyRecognition(input: RecognitionDelta): Promise<void> {
    const recognizedAt = new Date(input.recognizedAt);
    const record: RecognitionDelta = { ...input, recognizedAt };
    const day = shanghaiDate(recognizedAt);
    const dayStart = shanghaiDayRange(day).start;
    const hourStart = shanghaiHourStart(recognizedAt);
    await this.upsertBucket(this.hourBuckets, record, hourStart);
    const dayRows = await this.upsertBucket(this.dayBuckets, record, dayStart);
    await this.mergeDaily(day, dayRows);
  }

  async applyRecords(day: string, records: AggregateSource[]) {
    const points = aggregateDay(day, records);
    await this.persist(day, points);
    return points;
  }

  async series(
    user: AuthUser,
    query: { days?: string; shedCode?: string; cameraCode?: string },
  ): Promise<GrowthTrendSeries> {
    const days = parseWindow(query.days);
    const scope = ShedScope.fromUser(user);
    const shedCode = blank(query.shedCode);
    const cameraCode = blank(query.cameraCode);
    if (shedCode) scope.assert(shedCode);
    const to = todayShanghai();
    const from = shiftShanghaiDay(to, -(days - 1));
    const empty: GrowthTrendSeries = {
      days,
      from,
      to,
      mushroomCount: 'latest_per_camera',
      capDiameter: 'mean',
      sheds: [],
    };
    if (scope.codes && scope.codes.length === 0) return empty;

    const qb = this.aggregates
      .createQueryBuilder('a')
      .where('a.day >= :from AND a.day <= :to', { from, to })
      .orderBy('a.day', 'ASC')
      .addOrderBy('a.shedCode', 'ASC');
    if (scope.codes) {
      qb.andWhere('a.shedCode IN (:...codes)', { codes: scope.codes });
    }
    if (shedCode) qb.andWhere('a.shedCode = :shedCode', { shedCode });
    let rows = await qb.getMany();
    if (cameraCode) {
      const shedsWithCamera = new Set(
        rows
          .filter(
            (row) => row.grain === 'camera' && row.cameraCode === cameraCode,
          )
          .map((row) => row.shedCode),
      );
      rows = rows.filter(
        (row) =>
          (row.grain === 'camera' && row.cameraCode === cameraCode) ||
          (row.grain === 'shed' && shedsWithCamera.has(row.shedCode)),
      );
    }
    return { ...empty, sheds: groupSheds(rows) };
  }

  private async upsertBucket(
    repo: Repository<MetricBucketHour> | Repository<MetricBucketDay>,
    record: RecognitionDelta,
    bucketStart: Date,
  ): Promise<BucketView[]> {
    const existing = await repo.find({
      where: { shedCode: record.shedCode, bucketStart },
    });
    const { rows, dirty } = applyRecognitionToBuckets(
      existing.map(toBucketView),
      record,
      bucketStart,
    );
    const byKey = new Map(existing.map((row) => [bucketKey(row), row]));
    for (const view of dirty) {
      const prev = byKey.get(bucketKey(view));
      if (prev) {
        prev.value = view.value;
        prev.sampleCount = view.sampleCount;
        prev.valueSum = view.valueSum;
        prev.latestAt = view.latestAt;
        await repo.save(prev);
      } else {
        await repo.save(repo.create(view));
      }
    }
    return rows;
  }

  private async mergeDaily(day: string, rows: BucketView[]) {
    const drafts = dailyDraftsFromBuckets(day, rows);
    if (!drafts.length) return;
    const shedCode = drafts[0].shedCode;
    const existing = (await this.aggregates.find({ where: { day } })).filter(
      (row) => row.shedCode === shedCode,
    );
    await this.writeDaily(day, drafts, existing, false);
  }

  private async rebuildMetricBuckets(
    start: Date,
    end: Date,
    records: AggregateSource[],
  ) {
    const dayRows = foldBuckets(records, start);
    const byHour = new Map<number, AggregateSource[]>();
    for (const record of records) {
      const hour = shanghaiHourStart(new Date(record.recognizedAt)).getTime();
      const list = byHour.get(hour) ?? [];
      list.push(record);
      byHour.set(hour, list);
    }
    const hourRows: BucketView[] = [];
    for (const [time, list] of byHour) {
      hourRows.push(...foldBuckets(list, new Date(time)));
    }
    const storedDays = await this.dayBuckets.find({
      where: { bucketStart: start },
    });
    const storedHours = await this.hourBuckets
      .createQueryBuilder('b')
      .where('b.bucketStart >= :start AND b.bucketStart < :end', {
        start,
        end,
      })
      .getMany();
    await this.replaceBucketRows(this.dayBuckets, storedDays, dayRows);
    await this.replaceBucketRows(this.hourBuckets, storedHours, hourRows);
  }

  private async replaceBucketRows(
    repo: Repository<MetricBucketHour> | Repository<MetricBucketDay>,
    existing: MetricBucketBase[],
    next: BucketView[],
  ) {
    const wanted = new Set(next.map((row) => bucketKey(row)));
    for (const row of existing) {
      if (!wanted.has(bucketKey(row))) await repo.delete({ id: row.id });
    }
    const byKey = new Map(existing.map((row) => [bucketKey(row), row]));
    for (const view of next) {
      const prev = byKey.get(bucketKey(view));
      if (prev && wanted.has(bucketKey(view))) {
        prev.value = view.value;
        prev.sampleCount = view.sampleCount;
        prev.valueSum = view.valueSum;
        prev.latestAt = view.latestAt;
        await repo.save(prev);
      } else {
        await repo.save(repo.create(view));
      }
    }
  }

  private async persist(day: string, points: DailyAggregateDraft[]) {
    const existing = await this.aggregates.find({ where: { day } });
    await this.writeDaily(day, points, existing, true);
  }

  private async writeDaily(
    day: string,
    points: DailyAggregateDraft[],
    existing: DailyAggregate[],
    replaceMissing: boolean,
  ) {
    const keyOf = (row: {
      grain: string;
      shedCode: string;
      cameraCode: string;
    }) => `${row.grain}|${row.shedCode}|${row.cameraCode}`;
    const next = new Set(points.map(keyOf));
    if (replaceMissing) {
      for (const row of existing) {
        if (!next.has(keyOf(row))) await this.aggregates.delete({ id: row.id });
      }
    }
    const byKey = new Map(existing.map((row) => [keyOf(row), row]));
    for (const point of points) {
      const prev = byKey.get(keyOf(point));
      if (prev && next.has(keyOf(point))) {
        prev.mushroomCount = point.mushroomCount;
        prev.capDiameterMean = point.capDiameterMean;
        prev.sampleCount = point.sampleCount;
        await this.aggregates.save(prev);
      } else {
        await this.aggregates.save(this.aggregates.create({ ...point, day }));
      }
    }
  }
}

function toBucketView(row: MetricBucketBase): BucketView {
  return {
    shedCode: row.shedCode,
    cameraCode: row.cameraCode,
    bucketStart: new Date(row.bucketStart),
    metric: row.metric,
    value: row.value,
    sampleCount: row.sampleCount,
    valueSum: row.valueSum,
    latestAt: row.latestAt ? new Date(row.latestAt) : null,
  };
}

function parseWindow(days?: string): 7 | 30 {
  if (days === undefined || days === '') return 7;
  if (days === '7') return 7;
  if (days === '30') return 30;
  throw new BadRequestException('天数只支持 7 或 30');
}

function blank(value?: string): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

interface ShedBucket {
  points: GrowthPoint[];
  cameras: Map<string, GrowthPoint[]>;
}

function emptyBucket(): ShedBucket {
  return { points: [], cameras: new Map<string, GrowthPoint[]>() };
}

function groupSheds(rows: DailyAggregate[]): GrowthTrendSeries['sheds'] {
  const sheds = new Map<string, ShedBucket>();
  for (const row of rows) {
    const bucket = sheds.get(row.shedCode) ?? emptyBucket();
    const point: GrowthPoint = {
      day: row.day,
      mushroomCount: row.mushroomCount,
      capDiameterMean: row.capDiameterMean,
      sampleCount: row.sampleCount,
    };
    if (row.grain === 'shed') bucket.points.push(point);
    else if (row.cameraCode) {
      const list = bucket.cameras.get(row.cameraCode) ?? [];
      list.push(point);
      bucket.cameras.set(row.cameraCode, list);
    }
    sheds.set(row.shedCode, bucket);
  }
  return [...sheds.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([shedCode, bucket]) => ({
      shedCode,
      points: bucket.points,
      cameras: [...bucket.cameras.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([cameraCode, points]) => ({ cameraCode, points })),
    }));
}
