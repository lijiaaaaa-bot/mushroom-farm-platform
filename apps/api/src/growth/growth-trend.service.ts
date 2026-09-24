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
import {
  MetricBucketBase,
  MetricBucketDay,
  MetricBucketHour,
} from '../entities/metric-bucket.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import { shiftShanghaiDay } from './growth-trend.aggregate';
import {
  BucketView,
  EnvironmentDelta,
  RecognitionDelta,
  RECOGNITION_METRICS,
  ENVIRONMENT_METRICS,
  METRIC_CAP_DIAMETER_MEAN,
  METRIC_DISEASE_COUNT,
  METRIC_ENV_CO2,
  METRIC_ENV_HUMIDITY,
  METRIC_ENV_MOISTURE,
  METRIC_ENV_TEMPERATURE,
  METRIC_MATURE_COUNT,
  METRIC_MUSHROOM_COUNT,
  METRIC_SAMPLE_COUNT,
  bucketKey,
  foldBuckets,
  applyEnvironmentToBuckets,
  applyRecognitionToBuckets,
} from './metric-bucket.apply';

export interface GrowthPoint {
  day: string;
  mushroomCount: number;
  capDiameterMean: number | null;
  sampleCount: number;
}

export interface HourPoint {
  hour: string;
  mushroomCount: number;
  capDiameterMean: number | null;
  sampleCount: number;
}

export interface EnvironmentHourPoint {
  hour: string;
  temperature: number | null;
  humidity: number | null;
  co2: number | null;
  substrateMoisture: number | null;
}

export interface TodaySnapshot {
  mushroomCount: number;
  matureCount: number;
  harvestableCameras: number;
}

export interface TrendDayRollup {
  day: string;
  mushroom: number;
  mature: number;
  disease: number;
}

export interface EnvironmentMeans {
  avgTemp: number | null;
  avgHumidity: number | null;
  avgCo2: number | null;
  avgSubstrateMoisture: number | null;
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
    this.logger.log(`生长趋势桶回写：${JSON.stringify(result)}`);
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

  /**
   * 采摘修正与小时 cron 用：重扫该上海日的识别明细，回写识别指标的小时桶和日桶。
   * 不写 daily_aggregates。环境桶留在原行。
   */
  async refreshDay(day: string) {
    const { start, end } = shanghaiDayRange(day);
    const rows = await this.records
      .createQueryBuilder('r')
      .where('r.recognizedAt >= :start AND r.recognizedAt < :end', {
        start,
        end,
      })
      .getMany();
    return this.rebuildMetricBuckets(start, end, rows);
  }

  /**
   * 识别入库后的写路径：按 recognizedAt 的上海小时和上海日增量 upsert。
   * 不扫描当日明细。同一幂等键只能调用一次。
   */
  async applyRecognition(input: RecognitionDelta): Promise<void> {
    const recognizedAt = new Date(input.recognizedAt);
    const record: RecognitionDelta = { ...input, recognizedAt };
    const dayStart = shanghaiDayRange(shanghaiDate(recognizedAt)).start;
    const hourStart = shanghaiHourStart(recognizedAt);
    await this.upsertBucket(this.hourBuckets, record, hourStart);
    await this.upsertBucket(this.dayBuckets, record, dayStart);
  }

  /**
   * 环境入库后的写路径：按 observedAt 的上海小时和上海日增量 upsert。
   * 不扫描环境明细。同一幂等键只能调用一次。
   */
  async applyEnvironment(input: EnvironmentDelta): Promise<void> {
    const observedAt = new Date(input.observedAt);
    const reading: EnvironmentDelta = { ...input, observedAt };
    const dayStart = shanghaiDayRange(shanghaiDate(observedAt)).start;
    const hourStart = shanghaiHourStart(observedAt);
    await this.upsertEnvironment(this.hourBuckets, reading, hourStart);
    await this.upsertEnvironment(this.dayBuckets, reading, dayStart);
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

    const rows = await this.loadWindow(
      this.dayBuckets,
      shanghaiDayRange(from).start,
      shanghaiDayRange(to).end,
      [METRIC_MUSHROOM_COUNT, METRIC_CAP_DIAMETER_MEAN, METRIC_SAMPLE_COUNT],
      scope,
      shedCode,
    );
    return {
      ...empty,
      sheds: groupGrowth(filterCamera(rows, cameraCode), (start) =>
        shanghaiDate(start),
      ),
    };
  }

  async hourlySeries(
    user: AuthUser,
    query: { hours?: string; shedCode?: string; cameraCode?: string },
    now = new Date(),
  ) {
    const hours = parseHours(query.hours);
    const scope = ShedScope.fromUser(user);
    const shedCode = blank(query.shedCode);
    const cameraCode = blank(query.cameraCode);
    if (shedCode) scope.assert(shedCode);
    const endHour = shanghaiHourStart(now);
    const start = new Date(endHour.getTime() - (hours - 1) * 3_600_000);
    const end = new Date(endHour.getTime() + 3_600_000);
    const empty = {
      hours,
      from: start.toISOString(),
      to: endHour.toISOString(),
      mushroomCount: 'latest_per_camera' as const,
      capDiameter: 'mean' as const,
      sheds: [] as Array<{
        shedCode: string;
        points: HourPoint[];
        cameras: Array<{ cameraCode: string; points: HourPoint[] }>;
      }>,
    };
    if (scope.codes && scope.codes.length === 0) return empty;
    const rows = await this.loadWindow(
      this.hourBuckets,
      start,
      end,
      [METRIC_MUSHROOM_COUNT, METRIC_CAP_DIAMETER_MEAN, METRIC_SAMPLE_COUNT],
      scope,
      shedCode,
    );
    const sheds = groupGrowth(filterCamera(rows, cameraCode), (bucket) =>
      bucket.toISOString(),
    ).map((shed) => ({
      shedCode: shed.shedCode,
      points: shed.points.map((point) => ({
        hour: point.day,
        mushroomCount: point.mushroomCount,
        capDiameterMean: point.capDiameterMean,
        sampleCount: point.sampleCount,
      })),
      cameras: shed.cameras.map((camera) => ({
        cameraCode: camera.cameraCode,
        points: camera.points.map((point) => ({
          hour: point.day,
          mushroomCount: point.mushroomCount,
          capDiameterMean: point.capDiameterMean,
          sampleCount: point.sampleCount,
        })),
      })),
    }));
    return { ...empty, sheds };
  }

  async environmentSeries(
    user: AuthUser,
    query: { hours?: string; shedCode?: string },
    now = new Date(),
  ) {
    const hours = parseHours(query.hours);
    const scope = ShedScope.fromUser(user);
    const shedCode = blank(query.shedCode);
    if (shedCode) scope.assert(shedCode);
    const endHour = shanghaiHourStart(now);
    const start = new Date(endHour.getTime() - (hours - 1) * 3_600_000);
    const end = new Date(endHour.getTime() + 3_600_000);
    const empty = {
      hours,
      from: start.toISOString(),
      to: endHour.toISOString(),
      points: [] as EnvironmentHourPoint[],
      sheds: [] as Array<{ shedCode: string; points: EnvironmentHourPoint[] }>,
    };
    if (scope.codes && scope.codes.length === 0) return empty;
    const rows = await this.loadWindow(
      this.hourBuckets,
      start,
      end,
      [...ENVIRONMENT_METRICS],
      scope,
      shedCode,
    );
    const shedRows = rows.filter((row) => row.cameraCode === '');
    const sheds = groupEnvironment(shedRows);
    return {
      ...empty,
      sheds,
      points: meanEnvironmentHours(sheds),
    };
  }

  async diseasePeaks(
    user: AuthUser,
    query: { grain?: string; shedCode?: string },
    now = new Date(),
  ) {
    const grain = parseGrain(query.grain);
    const scope = ShedScope.fromUser(user);
    const shedCode = blank(query.shedCode);
    if (shedCode) scope.assert(shedCode);
    const window = diseaseWindow(grain, now);
    const empty = {
      grain,
      from: window.start.toISOString(),
      to: window.labelEnd,
      byTime: [] as Array<{ bucketStart: string; diseaseCount: number }>,
      byShed: [] as Array<{ shedCode: string; diseaseCount: number }>,
      peak: null as { bucketStart: string; diseaseCount: number } | null,
    };
    if (scope.codes && scope.codes.length === 0) return empty;
    const repo = grain === 'hour' ? this.hourBuckets : this.dayBuckets;
    const rows = (
      await this.loadWindow(
        repo,
        window.start,
        window.end,
        [METRIC_DISEASE_COUNT],
        scope,
        shedCode,
      )
    ).filter((row) => row.cameraCode === '');
    const byTimeMap = new Map<string, number>();
    const byShedMap = new Map<string, number>();
    for (const row of rows) {
      const stamp = new Date(row.bucketStart).toISOString();
      byTimeMap.set(stamp, (byTimeMap.get(stamp) ?? 0) + (row.value ?? 0));
      byShedMap.set(
        row.shedCode,
        (byShedMap.get(row.shedCode) ?? 0) + (row.value ?? 0),
      );
    }
    const byTime = [...byTimeMap.entries()]
      .map(([bucketStart, diseaseCount]) => ({ bucketStart, diseaseCount }))
      .sort((a, b) => a.bucketStart.localeCompare(b.bucketStart));
    const byShed = [...byShedMap.entries()]
      .map(([code, diseaseCount]) => ({
        shedCode: code,
        diseaseCount,
      }))
      .sort(
        (a, b) =>
          b.diseaseCount - a.diseaseCount ||
          a.shedCode.localeCompare(b.shedCode),
      );
    const peak = byTime.reduce<{
      bucketStart: string;
      diseaseCount: number;
    } | null>(
      (best, row) =>
        !best || row.diseaseCount > best.diseaseCount ? row : best,
      null,
    );
    return { ...empty, byTime, byShed, peak };
  }

  async todaySnapshot(
    scope: ShedScope,
    now = new Date(),
  ): Promise<TodaySnapshot> {
    if (scope.codes && scope.codes.length === 0) {
      return { mushroomCount: 0, matureCount: 0, harvestableCameras: 0 };
    }
    const day = todayShanghai(now);
    const { start, end } = shanghaiDayRange(day);
    const rows = await this.loadWindow(
      this.dayBuckets,
      start,
      end,
      [METRIC_MUSHROOM_COUNT, METRIC_MATURE_COUNT],
      scope,
    );
    const shed = (metric: string) =>
      rows
        .filter((row) => row.cameraCode === '' && row.metric === metric)
        .reduce((sum, row) => sum + (row.value ?? 0), 0);
    const harvestableCameras = rows.filter(
      (row) =>
        row.cameraCode !== '' &&
        row.metric === METRIC_MATURE_COUNT &&
        (row.value ?? 0) > 0,
    ).length;
    return {
      mushroomCount: Math.round(shed(METRIC_MUSHROOM_COUNT)),
      matureCount: Math.round(shed(METRIC_MATURE_COUNT)),
      harvestableCameras,
    };
  }

  async trendFromDayBuckets(
    scope: ShedScope,
    now = new Date(),
  ): Promise<TrendDayRollup[]> {
    if (scope.codes && scope.codes.length === 0) return [];
    const to = todayShanghai(now);
    const from = shiftShanghaiDay(to, -6);
    const rows = await this.loadWindow(
      this.dayBuckets,
      shanghaiDayRange(from).start,
      shanghaiDayRange(to).end,
      [METRIC_MUSHROOM_COUNT, METRIC_MATURE_COUNT, METRIC_DISEASE_COUNT],
      scope,
    );
    const byDay = new Map<string, TrendDayRollup>();
    for (const row of rows) {
      if (row.cameraCode !== '') continue;
      const day = shanghaiDate(new Date(row.bucketStart));
      const slot = byDay.get(day) ?? {
        day,
        mushroom: 0,
        mature: 0,
        disease: 0,
      };
      const value = Math.round(row.value ?? 0);
      if (row.metric === METRIC_MUSHROOM_COUNT) slot.mushroom += value;
      if (row.metric === METRIC_MATURE_COUNT) slot.mature += value;
      if (row.metric === METRIC_DISEASE_COUNT) slot.disease += value;
      byDay.set(day, slot);
    }
    return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  }

  async latestEnvironment(
    scope: ShedScope,
    now = new Date(),
  ): Promise<EnvironmentMeans> {
    const blankMeans: EnvironmentMeans = {
      avgTemp: null,
      avgHumidity: null,
      avgCo2: null,
      avgSubstrateMoisture: null,
    };
    if (scope.codes && scope.codes.length === 0) return blankMeans;
    const endHour = shanghaiHourStart(now);
    const end = new Date(endHour.getTime() + 3_600_000);
    const start = new Date(end.getTime() - 24 * 3_600_000);
    const rows = (
      await this.loadWindow(
        this.hourBuckets,
        start,
        end,
        [...ENVIRONMENT_METRICS],
        scope,
      )
    ).filter((row) => row.cameraCode === '');
    const mean = (metric: string) => {
      const latest = new Map<string, BucketView>();
      for (const row of rows) {
        if (row.metric !== metric || row.value === null) continue;
        const prev = latest.get(row.shedCode);
        if (
          !prev ||
          new Date(row.bucketStart).getTime() >=
            new Date(prev.bucketStart).getTime()
        ) {
          latest.set(row.shedCode, row);
        }
      }
      const values = [...latest.values()].map((row) => row.value as number);
      if (!values.length) return null;
      return (
        Math.round(
          (values.reduce((sum, value) => sum + value, 0) / values.length) * 10,
        ) / 10
      );
    };
    return {
      avgTemp: mean(METRIC_ENV_TEMPERATURE),
      avgHumidity: mean(METRIC_ENV_HUMIDITY),
      avgCo2: mean(METRIC_ENV_CO2),
      avgSubstrateMoisture: mean(METRIC_ENV_MOISTURE),
    };
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

  private async upsertEnvironment(
    repo: Repository<MetricBucketHour> | Repository<MetricBucketDay>,
    reading: EnvironmentDelta,
    bucketStart: Date,
  ): Promise<void> {
    const existing = await repo.find({
      where: { shedCode: reading.shedCode, bucketStart },
    });
    const { dirty } = applyEnvironmentToBuckets(
      existing.map(toBucketView),
      reading,
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
  }

  private async loadWindow(
    repo: Repository<MetricBucketHour> | Repository<MetricBucketDay>,
    start: Date,
    end: Date,
    metrics: string[],
    scope: ShedScope,
    shedCode?: string,
  ): Promise<BucketView[]> {
    if (scope.codes && scope.codes.length === 0) return [];
    const qb = repo
      .createQueryBuilder('b')
      .where('b.bucketStart >= :start AND b.bucketStart < :end', { start, end })
      .andWhere('b.metric IN (:...metrics)', { metrics });
    if (scope.codes) {
      qb.andWhere('b.shedCode IN (:...codes)', { codes: scope.codes });
    }
    if (shedCode) qb.andWhere('b.shedCode = :shedCode', { shedCode });
    const rows = await qb.getMany();
    return rows.map(toBucketView);
  }

  private async rebuildMetricBuckets(
    start: Date,
    end: Date,
    records: RecognitionDelta[],
  ): Promise<BucketView[]> {
    const dayRows = foldBuckets(records, start);
    const byHour = new Map<number, RecognitionDelta[]>();
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
    return dayRows;
  }

  private async replaceBucketRows(
    repo: Repository<MetricBucketHour> | Repository<MetricBucketDay>,
    existing: MetricBucketBase[],
    next: BucketView[],
  ) {
    const recognition = new Set<string>(RECOGNITION_METRICS);
    const wanted = new Set(next.map((row) => bucketKey(row)));
    for (const row of existing) {
      if (!recognition.has(row.metric)) continue;
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

function parseHours(hours?: string): 24 {
  if (hours === undefined || hours === '' || hours === '24') return 24;
  throw new BadRequestException('小时窗口只支持 24');
}

function parseGrain(grain?: string): 'hour' | 'day' {
  if (grain === undefined || grain === '' || grain === 'hour') return 'hour';
  if (grain === 'day') return 'day';
  throw new BadRequestException('粒度只支持 hour 或 day');
}

function diseaseWindow(grain: 'hour' | 'day', now: Date) {
  if (grain === 'hour') {
    const endHour = shanghaiHourStart(now);
    const start = new Date(endHour.getTime() - 23 * 3_600_000);
    return {
      start,
      end: new Date(endHour.getTime() + 3_600_000),
      labelEnd: endHour.toISOString(),
    };
  }
  const to = todayShanghai(now);
  const from = shiftShanghaiDay(to, -6);
  return {
    start: shanghaiDayRange(from).start,
    end: shanghaiDayRange(to).end,
    labelEnd: shanghaiDayRange(to).start.toISOString(),
  };
}

function filterCamera(rows: BucketView[], cameraCode?: string): BucketView[] {
  if (!cameraCode) return rows;
  const shedsWithCamera = new Set(
    rows
      .filter((row) => row.cameraCode === cameraCode)
      .map((row) => row.shedCode),
  );
  return rows.filter(
    (row) =>
      row.cameraCode === cameraCode ||
      (row.cameraCode === '' && shedsWithCamera.has(row.shedCode)),
  );
}

function groupGrowth(
  rows: BucketView[],
  labelOf: (start: Date) => string,
): GrowthTrendSeries['sheds'] {
  const sheds = new Map<string, ShedBucket>();
  const slots = new Map<string, GrowthPoint>();
  for (const row of rows) {
    const label = labelOf(new Date(row.bucketStart));
    const key = `${row.shedCode}\0${row.cameraCode}\0${label}`;
    const point = slots.get(key) ?? {
      day: label,
      mushroomCount: 0,
      capDiameterMean: null,
      sampleCount: 0,
    };
    if (row.metric === METRIC_MUSHROOM_COUNT) {
      point.mushroomCount = Math.round(row.value ?? 0);
    } else if (row.metric === METRIC_CAP_DIAMETER_MEAN) {
      point.capDiameterMean = row.value;
    } else if (row.metric === METRIC_SAMPLE_COUNT) {
      point.sampleCount = Math.round(row.value ?? 0);
    }
    slots.set(key, point);
  }
  for (const [key, point] of slots) {
    const [shedCode, cameraCode] = key.split('\0');
    const bucket = sheds.get(shedCode) ?? emptyBucket();
    if (!cameraCode) bucket.points.push(point);
    else {
      const list = bucket.cameras.get(cameraCode) ?? [];
      list.push(point);
      bucket.cameras.set(cameraCode, list);
    }
    sheds.set(shedCode, bucket);
  }
  return [...sheds.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([shedCode, bucket]) => ({
      shedCode,
      points: bucket.points.sort((a, b) => a.day.localeCompare(b.day)),
      cameras: [...bucket.cameras.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([cameraCode, points]) => ({
          cameraCode,
          points: points.sort((a, b) => a.day.localeCompare(b.day)),
        })),
    }));
}

function groupEnvironment(rows: BucketView[]) {
  const sheds = new Map<string, Map<string, EnvironmentHourPoint>>();
  for (const row of rows) {
    const hour = new Date(row.bucketStart).toISOString();
    const hours = sheds.get(row.shedCode) ?? new Map();
    const point = hours.get(hour) ?? {
      hour,
      temperature: null,
      humidity: null,
      co2: null,
      substrateMoisture: null,
    };
    if (row.metric === METRIC_ENV_TEMPERATURE) point.temperature = row.value;
    if (row.metric === METRIC_ENV_HUMIDITY) point.humidity = row.value;
    if (row.metric === METRIC_ENV_CO2) point.co2 = row.value;
    if (row.metric === METRIC_ENV_MOISTURE) point.substrateMoisture = row.value;
    hours.set(hour, point);
    sheds.set(row.shedCode, hours);
  }
  return [...sheds.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([shedCode, hours]) => ({
      shedCode,
      points: [...hours.values()].sort((a, b) => a.hour.localeCompare(b.hour)),
    }));
}

function meanEnvironmentHours(
  sheds: Array<{ points: EnvironmentHourPoint[] }>,
): EnvironmentHourPoint[] {
  const hours = new Map<string, EnvironmentHourPoint[]>();
  for (const shed of sheds) {
    for (const point of shed.points) {
      const list = hours.get(point.hour) ?? [];
      list.push(point);
      hours.set(point.hour, list);
    }
  }
  const mean = (values: Array<number | null>) => {
    const present = values.filter((value): value is number => value !== null);
    if (!present.length) return null;
    return (
      Math.round(
        (present.reduce((sum, value) => sum + value, 0) / present.length) * 10,
      ) / 10
    );
  };
  return [...hours.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([hour, points]) => ({
      hour,
      temperature: mean(points.map((point) => point.temperature)),
      humidity: mean(points.map((point) => point.humidity)),
      co2: mean(points.map((point) => point.co2)),
      substrateMoisture: mean(points.map((point) => point.substrateMoisture)),
    }));
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
