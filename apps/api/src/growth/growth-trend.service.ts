import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  countEnvAnomalyPoints,
  meanFarmEnvironment,
  shanghaiDate,
  shanghaiDayRange,
  shanghaiHourStart,
  sumShedLiveMushroomTotals,
  todayShanghai,
  type EnvAnomalySensorReading,
  type ShedDiseaseLive,
  type EnvThresholdRule,
  type FarmEnvMeans,
  type LiveMushroomTotals,
} from '@mushroom/contracts';
import { AuthUser } from '../common/auth-user';
import { ShedScope } from '../common/shed-scope';
import {
  MetricBucketBase,
  MetricBucketDay,
  MetricBucketHour,
} from '../entities/metric-bucket.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import {
  maturityPercent,
  rollupGrowthPoints,
  shiftShanghaiDay,
  TrendGrain,
} from './growth-trend.aggregate';
import {
  BucketView,
  EnvironmentDelta,
  RecognitionDelta,
  RECOGNITION_METRICS,
  ENVIRONMENT_METRICS,
  METRIC_CAP_DIAMETER_MEAN,
  METRIC_DISEASE_COUNT,
  METRIC_DISEASE_SEVERE,
  METRIC_ENV_CO2,
  METRIC_ENV_HUMIDITY,
  METRIC_ENV_MOISTURE,
  METRIC_ENV_TEMPERATURE,
  METRIC_CAPTURE_COUNT,
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
  matureCount: number;
  /** 成熟率百分数，保留一位。蘑菇数为 0 时是 null。 */
  maturityRate: number | null;
  capDiameterMean: number | null;
  sampleCount: number;
}

export interface HourPoint {
  hour: string;
  mushroomCount: number;
  matureCount: number;
  maturityRate: number | null;
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
  /** 今日识别次数：各棚日桶 sample_count 相加。 */
  recognitionCount: number;
  /** 今日抓拍总量：各棚日桶 capture_count 相加。 */
  captureCount: number;
  /** 当日病害总数：各棚日桶棚级 disease_count 相加。 */
  diseaseCount: number;
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

export interface DiseaseDayPoint {
  day: string;
  diseaseCount: number;
}

export interface DiseaseTrendSeries {
  days: 7 | 30;
  from: string;
  to: string;
  diseaseCount: 'latest_per_camera';
  sheds: Array<{
    shedCode: string;
    points: DiseaseDayPoint[];
    cameras: Array<{ cameraCode: string; points: DiseaseDayPoint[] }>;
  }>;
}

export interface ShedLiveStats {
  shedCode: string;
  cameraCode: string | null;
  available: boolean;
  mushroomCount: number | null;
  matureCount: number | null;
  pendingMatureCount: number | null;
  diseaseCount: number | null;
  basis: 'latest_per_camera';
}

export interface GrowthTrendSeries {
  days: 7 | 30;
  grain: TrendGrain;
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
    query: {
      days?: string;
      grain?: string;
      shedCode?: string;
      cameraCode?: string;
    },
  ): Promise<GrowthTrendSeries> {
    const days = parseWindow(query.days);
    const grain = parseTrendGrain(query.grain);
    const scope = ShedScope.fromUser(user);
    const shedCode = blank(query.shedCode);
    const cameraCode = blank(query.cameraCode);
    if (shedCode) scope.assert(shedCode);
    const to = todayShanghai();
    const from = shiftShanghaiDay(to, -(days - 1));
    const empty: GrowthTrendSeries = {
      days,
      grain,
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
      [
        METRIC_MUSHROOM_COUNT,
        METRIC_MATURE_COUNT,
        METRIC_CAP_DIAMETER_MEAN,
        METRIC_SAMPLE_COUNT,
      ],
      scope,
      shedCode,
    );
    return {
      ...empty,
      sheds: withGrain(
        groupGrowth(filterCamera(rows, cameraCode), (start) =>
          shanghaiDate(start),
        ),
        grain,
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
      [
        METRIC_MUSHROOM_COUNT,
        METRIC_MATURE_COUNT,
        METRIC_CAP_DIAMETER_MEAN,
        METRIC_SAMPLE_COUNT,
      ],
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
        matureCount: point.matureCount,
        maturityRate: point.maturityRate,
        capDiameterMean: point.capDiameterMean,
        sampleCount: point.sampleCount,
      })),
      cameras: shed.cameras.map((camera) => ({
        cameraCode: camera.cameraCode,
        points: camera.points.map((point) => ({
          hour: point.day,
          mushroomCount: point.mushroomCount,
          matureCount: point.matureCount,
          maturityRate: point.maturityRate,
          capDiameterMean: point.capDiameterMean,
          sampleCount: point.sampleCount,
        })),
      })),
    }));
    return { ...empty, sheds };
  }

  async environmentSeries(
    user: AuthUser,
    query: { hours?: string; shedCode?: string; sensorCode?: string },
    now = new Date(),
  ) {
    const hours = parseHours(query.hours);
    const scope = ShedScope.fromUser(user);
    const shedCode = blank(query.shedCode);
    const sensorCode = blank(query.sensorCode);
    if (shedCode) scope.assert(shedCode);
    const endHour = shanghaiHourStart(now);
    const start = new Date(endHour.getTime() - (hours - 1) * 3_600_000);
    const end = new Date(endHour.getTime() + 3_600_000);
    const empty = {
      hours,
      from: start.toISOString(),
      to: endHour.toISOString(),
      sensorCode: sensorCode ?? null,
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
    const subjectRows = rows.filter((row) =>
      sensorCode ? row.cameraCode === sensorCode : row.cameraCode === '',
    );
    const sheds = groupEnvironment(subjectRows);
    const selected = shedCode
      ? sheds.find((shed) => shed.shedCode === shedCode)
      : undefined;
    return {
      ...empty,
      sheds,
      points:
        sensorCode && selected ? selected.points : meanEnvironmentHours(sheds),
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

  /**
   * 单棚病害日趋势。读 metric_buckets_day 的 disease_count（当日最新），
   * 不扫识别明细，也不按小时再聚合。
   */
  async diseaseTrends(
    user: AuthUser,
    query: { days?: string; shedCode?: string; cameraCode?: string },
    now = new Date(),
  ): Promise<DiseaseTrendSeries> {
    const days = parseWindow(query.days);
    const scope = ShedScope.fromUser(user);
    const shedCode = blank(query.shedCode);
    const cameraCode = blank(query.cameraCode);
    if (shedCode) scope.assert(shedCode);
    const to = todayShanghai(now);
    const from = shiftShanghaiDay(to, -(days - 1));
    const empty: DiseaseTrendSeries = {
      days,
      from,
      to,
      diseaseCount: 'latest_per_camera',
      sheds: [],
    };
    if (scope.codes && scope.codes.length === 0) return empty;
    const rows = await this.loadWindow(
      this.dayBuckets,
      shanghaiDayRange(from).start,
      shanghaiDayRange(to).end,
      [METRIC_DISEASE_COUNT],
      scope,
      shedCode,
    );
    return {
      ...empty,
      sheds: groupDisease(filterCamera(rows, cameraCode)),
    };
  }

  /**
   * 单棚当日实时。读 metric_buckets_day 当日最新的蘑菇、成熟、病害。
   * 指定摄像头用这一台；不指定则把各摄像头最新相加，待成熟在相加之后再算。
   * 不扫识别明细。
   */
  async liveStats(
    user: AuthUser,
    query: { shedCode?: string; cameraCode?: string },
    now = new Date(),
  ): Promise<ShedLiveStats> {
    const shedCode = blank(query.shedCode);
    if (!shedCode) throw new BadRequestException('请选择棚区');
    const cameraCode = blank(query.cameraCode);
    const scope = ShedScope.fromUser(user);
    scope.assert(shedCode);
    const empty: ShedLiveStats = {
      shedCode,
      cameraCode: cameraCode ?? null,
      available: false,
      mushroomCount: null,
      matureCount: null,
      pendingMatureCount: null,
      diseaseCount: null,
      basis: 'latest_per_camera',
    };
    if (scope.codes && scope.codes.length === 0) return empty;
    const day = todayShanghai(now);
    const { start, end } = shanghaiDayRange(day);
    const rows = await this.loadWindow(
      this.dayBuckets,
      start,
      end,
      [METRIC_MUSHROOM_COUNT, METRIC_MATURE_COUNT, METRIC_DISEASE_COUNT],
      scope,
      shedCode,
    );
    const subject = rows.filter((row) =>
      cameraCode ? row.cameraCode === cameraCode : row.cameraCode !== '',
    );
    const valued = subject.filter((row) => row.value !== null);
    if (!valued.length) return empty;
    const sum = (metric: string) =>
      Math.round(
        valued
          .filter((row) => row.metric === metric)
          .reduce((total, row) => total + (row.value ?? 0), 0),
      );
    const mushroomCount = sum(METRIC_MUSHROOM_COUNT);
    const matureCount = sum(METRIC_MATURE_COUNT);
    const diseaseCount = sum(METRIC_DISEASE_COUNT);
    return {
      ...empty,
      available: true,
      mushroomCount,
      matureCount,
      pendingMatureCount: pendingMatureCount(mushroomCount, matureCount),
      diseaseCount,
    };
  }

  /**
   * 全场当日在养三数。读 metric_buckets_day 当日摄像头行的蘑菇、成熟。
   * 每棚先把各摄像头最新相加，待成熟在相加之后再算，再把各棚三数相加。
   * 棚级行（cameraCode 为空）不重复计入。不扫识别明细。
   */
  async liveMushroomTotals(
    scope: ShedScope,
    now = new Date(),
  ): Promise<LiveMushroomTotals> {
    const byShed = await this.todayShedMushroomMature(scope, now);
    return sumShedLiveMushroomTotals([...byShed.values()]);
  }

  /**
   * 各棚当日成熟数。摄像头日桶相加，棚级行不计入。与 liveMatureTotal 同一读法。
   */
  async shedLiveMatureCounts(
    scope: ShedScope,
    now = new Date(),
  ): Promise<Array<{ shedCode: string; matureCount: number }>> {
    const byShed = await this.todayShedMushroomMature(scope, now);
    return [...byShed.entries()].map(([shedCode, slot]) => ({
      shedCode,
      matureCount: Math.round(slot.matureCount),
    }));
  }

  /**
   * 各棚当日病害比例用的蘑菇数、病害数，以及重度病害数量。
   * 摄像头日桶相加，棚级行不计入。重度是 disease_severe_count（病害等级为 3 的数量）。
   */
  async shedLiveDiseaseCounts(
    scope: ShedScope,
    now = new Date(),
  ): Promise<ShedDiseaseLive[]> {
    const byShed = await this.todayShedDiseaseLive(scope, now);
    return [...byShed.entries()].map(([shedCode, slot]) => ({
      shedCode,
      mushroomCount: Math.round(slot.mushroomCount),
      diseaseCount: Math.round(slot.diseaseCount),
      severeCount: Math.round(slot.severeCount),
    }));
  }

  private async todayShedMushroomMature(
    scope: ShedScope,
    now = new Date(),
  ): Promise<Map<string, { mushroomCount: number; matureCount: number }>> {
    const byShed = new Map<
      string,
      { mushroomCount: number; matureCount: number }
    >();
    if (scope.codes && scope.codes.length === 0) return byShed;
    const day = todayShanghai(now);
    const { start, end } = shanghaiDayRange(day);
    const rows = await this.loadWindow(
      this.dayBuckets,
      start,
      end,
      [METRIC_MUSHROOM_COUNT, METRIC_MATURE_COUNT],
      scope,
    );
    for (const row of rows) {
      if (!row.cameraCode || row.value === null) continue;
      const slot = byShed.get(row.shedCode) ?? {
        mushroomCount: 0,
        matureCount: 0,
      };
      if (row.metric === METRIC_MUSHROOM_COUNT) {
        slot.mushroomCount += row.value;
      } else if (row.metric === METRIC_MATURE_COUNT) {
        slot.matureCount += row.value;
      }
      byShed.set(row.shedCode, slot);
    }
    return byShed;
  }

  private async todayShedDiseaseLive(
    scope: ShedScope,
    now = new Date(),
  ): Promise<
    Map<
      string,
      { mushroomCount: number; diseaseCount: number; severeCount: number }
    >
  > {
    const byShed = new Map<
      string,
      { mushroomCount: number; diseaseCount: number; severeCount: number }
    >();
    if (scope.codes && scope.codes.length === 0) return byShed;
    const day = todayShanghai(now);
    const { start, end } = shanghaiDayRange(day);
    const rows = await this.loadWindow(
      this.dayBuckets,
      start,
      end,
      [METRIC_MUSHROOM_COUNT, METRIC_DISEASE_COUNT, METRIC_DISEASE_SEVERE],
      scope,
    );
    for (const row of rows) {
      if (!row.cameraCode || row.value === null) continue;
      const slot = byShed.get(row.shedCode) ?? {
        mushroomCount: 0,
        diseaseCount: 0,
        severeCount: 0,
      };
      if (row.metric === METRIC_MUSHROOM_COUNT) slot.mushroomCount += row.value;
      else if (row.metric === METRIC_DISEASE_COUNT)
        slot.diseaseCount += row.value;
      else if (row.metric === METRIC_DISEASE_SEVERE)
        slot.severeCount += row.value;
      byShed.set(row.shedCode, slot);
    }
    return byShed;
  }

  /**
   * 全园环境参数均值。读 metric_buckets_day 当日传感器行的四个环境指标。
   * 每个传感器取当天日桶 value（写入时的当日均值；只有一条读数时等于该读数），
   * 全园对温度、湿度、CO₂、基质含水率分别做算术平均，保留 1 位小数。
   * 棚级行（cameraCode 为空）不重复计入。不扫环境明细。
   * 今日是 observedAt 的上海自然日。没有读数的指标是 null。
   */
  async farmEnvironmentMeans(
    scope: ShedScope,
    now = new Date(),
  ): Promise<FarmEnvMeans> {
    return meanFarmEnvironment(await this.todaySensorEnvReadings(scope, now));
  }

  /**
   * 异常环境点位数。读当日环境日桶的传感器行，对照已启用的环境阈值。
   * 一个传感器计一个点：任一指标超出适用于该棚的阈值即计入，多个指标仍是 1。
   * 棚级行不计入。今日是 observedAt 的上海自然日。没有超限点位时是 0。
   * 不读告警表，不扫环境明细。
   */
  async farmEnvAnomalyPointCount(
    scope: ShedScope,
    rules: EnvThresholdRule[],
    now = new Date(),
  ): Promise<number> {
    const readings = await this.todaySensorEnvReadings(scope, now);
    return countEnvAnomalyPoints(readings, rules);
  }

  private async todaySensorEnvReadings(
    scope: ShedScope,
    now = new Date(),
  ): Promise<EnvAnomalySensorReading[]> {
    if (scope.codes && scope.codes.length === 0) return [];
    const day = todayShanghai(now);
    const { start, end } = shanghaiDayRange(day);
    const rows = await this.loadWindow(
      this.dayBuckets,
      start,
      end,
      [...ENVIRONMENT_METRICS],
      scope,
    );
    const bySensor = new Map<string, EnvAnomalySensorReading>();
    for (const row of rows) {
      if (!row.cameraCode || row.value === null) continue;
      const key = `${row.shedCode}\0${row.cameraCode}`;
      const slot = bySensor.get(key) ?? {
        shedCode: row.shedCode,
        sensorCode: row.cameraCode,
      };
      if (row.metric === METRIC_ENV_TEMPERATURE) slot.temperature = row.value;
      else if (row.metric === METRIC_ENV_HUMIDITY) slot.humidity = row.value;
      else if (row.metric === METRIC_ENV_CO2) slot.co2 = row.value;
      else if (row.metric === METRIC_ENV_MOISTURE) {
        slot.substrateMoisture = row.value;
      }
      bySensor.set(key, slot);
    }
    return [...bySensor.values()];
  }

  async todaySnapshot(
    scope: ShedScope,
    now = new Date(),
  ): Promise<TodaySnapshot> {
    if (scope.codes && scope.codes.length === 0) {
      return {
        mushroomCount: 0,
        matureCount: 0,
        harvestableCameras: 0,
        recognitionCount: 0,
        captureCount: 0,
        diseaseCount: 0,
      };
    }
    const day = todayShanghai(now);
    const { start, end } = shanghaiDayRange(day);
    const rows = await this.loadWindow(
      this.dayBuckets,
      start,
      end,
      [
        METRIC_MUSHROOM_COUNT,
        METRIC_MATURE_COUNT,
        METRIC_SAMPLE_COUNT,
        METRIC_CAPTURE_COUNT,
        METRIC_DISEASE_COUNT,
      ],
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
      recognitionCount: Math.round(shed(METRIC_SAMPLE_COUNT)),
      captureCount: Math.round(shed(METRIC_CAPTURE_COUNT)),
      diseaseCount: Math.round(shed(METRIC_DISEASE_COUNT)),
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

function groupDisease(rows: BucketView[]): DiseaseTrendSeries['sheds'] {
  const sheds = new Map<
    string,
    { points: DiseaseDayPoint[]; cameras: Map<string, DiseaseDayPoint[]> }
  >();
  for (const row of rows) {
    if (row.metric !== METRIC_DISEASE_COUNT) continue;
    const day = shanghaiDate(new Date(row.bucketStart));
    const point: DiseaseDayPoint = {
      day,
      diseaseCount: Math.round(row.value ?? 0),
    };
    const bucket = sheds.get(row.shedCode) ?? {
      points: [],
      cameras: new Map<string, DiseaseDayPoint[]>(),
    };
    if (!row.cameraCode) bucket.points.push(point);
    else {
      const list = bucket.cameras.get(row.cameraCode) ?? [];
      list.push(point);
      bucket.cameras.set(row.cameraCode, list);
    }
    sheds.set(row.shedCode, bucket);
  }
  const byDay = (points: DiseaseDayPoint[]) =>
    [...points].sort((a, b) => a.day.localeCompare(b.day));
  return [...sheds.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([shedCode, bucket]) => ({
      shedCode,
      points: byDay(bucket.points),
      cameras: [...bucket.cameras.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([cameraCode, points]) => ({
          cameraCode,
          points: byDay(points),
        })),
    }));
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
      matureCount: 0,
      maturityRate: null,
      capDiameterMean: null,
      sampleCount: 0,
    };
    if (row.metric === METRIC_MUSHROOM_COUNT) {
      point.mushroomCount = Math.round(row.value ?? 0);
    } else if (row.metric === METRIC_MATURE_COUNT) {
      point.matureCount = Math.round(row.value ?? 0);
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
      points: bucket.points
        .sort((a, b) => a.day.localeCompare(b.day))
        .map(withMaturityRate),
      cameras: [...bucket.cameras.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([cameraCode, points]) => ({
          cameraCode,
          points: points
            .sort((a, b) => a.day.localeCompare(b.day))
            .map(withMaturityRate),
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

function withGrain(
  sheds: GrowthTrendSeries['sheds'],
  grain: TrendGrain,
): GrowthTrendSeries['sheds'] {
  if (grain === 'day') return sheds;
  return sheds.map((shed) => ({
    shedCode: shed.shedCode,
    points: rollupGrowthPoints(shed.points, grain).map(withMaturityRate),
    cameras: shed.cameras.map((camera) => ({
      cameraCode: camera.cameraCode,
      points: rollupGrowthPoints(camera.points, grain).map(withMaturityRate),
    })),
  }));
}

function withMaturityRate(point: GrowthPoint): GrowthPoint {
  return {
    ...point,
    maturityRate: maturityPercent(point.mushroomCount, point.matureCount),
  };
}

function parseTrendGrain(grain?: string): TrendGrain {
  if (grain === undefined || grain === '' || grain === 'day') return 'day';
  if (grain === 'week' || grain === 'month') return grain;
  throw new BadRequestException('粒度只支持 day、week 或 month');
}

function parseWindow(days?: string): 7 | 30 {
  if (days === undefined || days === '') return 7;
  if (days === '7') return 7;
  if (days === '30') return 30;
  throw new BadRequestException('天数只支持 7 或 30');
}

export function pendingMatureCount(mushroom: number, mature: number): number {
  if (!Number.isFinite(mushroom) || mushroom <= 0) return 0;
  const pending = mushroom - mature;
  return pending > 0 ? pending : 0;
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
