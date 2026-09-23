import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { shanghaiDayRange, todayShanghai } from '@mushroom/contracts';
import { AuthUser } from '../common/auth-user';
import { ShedScope } from '../common/shed-scope';
import { DailyAggregate } from '../entities/daily-aggregate.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import {
  AggregateSource,
  DailyAggregateDraft,
  aggregateDay,
  shiftShanghaiDay,
} from './growth-trend.aggregate';

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
    return this.applyRecords(day, rows);
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

  private async persist(day: string, points: DailyAggregateDraft[]) {
    const existing = await this.aggregates.find({ where: { day } });
    const keyOf = (row: {
      grain: string;
      shedCode: string;
      cameraCode: string;
    }) => `${row.grain}|${row.shedCode}|${row.cameraCode}`;
    const next = new Set(points.map(keyOf));
    for (const row of existing) {
      if (!next.has(keyOf(row))) await this.aggregates.delete({ id: row.id });
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
