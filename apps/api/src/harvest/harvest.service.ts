import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser } from '../common/auth-user';
import { ShedScope } from '../common/shed-scope';
import {
  YIELD_ESTIMATE_HISTORY_DAYS,
  YIELD_ESTIMATE_HORIZON_DAYS,
  shanghaiDate,
  shanghaiDayRange,
  shiftShanghaiDate,
  todayShanghai,
} from '@mushroom/contracts';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import { GrowthTrendService } from '../growth';
import { projectMatureYield } from './yield-estimate';

export interface HarvestItem {
  id: string;
  shedCode: string;
  cameraCode: string;
  recognizedAt: Date;
  mushroomCount: number;
  matureCount: number;
  avgCapDiameter: number | null;
  diseaseCount: number;
  diseaseLevel: number;
}

export interface HarvestCountChange {
  old: number;
  new: number;
}

export interface HarvestCorrection {
  item: HarvestItem;
  changes: {
    matureCount?: HarvestCountChange;
    mushroomCount?: HarvestCountChange;
  };
}

@Injectable()
export class HarvestService {
  private readonly logger = new Logger(HarvestService.name);

  constructor(
    @InjectRepository(RecognitionRecord)
    private readonly records: Repository<RecognitionRecord>,
    @Optional()
    @Inject(GrowthTrendService)
    private readonly growth?: GrowthTrendService,
  ) {}

  async daily(user: AuthUser, date?: string) {
    const day = date || todayShanghai();
    const items = await this.latestPerCamera(user, day);
    const summary = {
      date: day,
      cameraCount: items.length,
      harvestableCameras: items.filter((item) => item.matureCount > 0).length,
      mushroomCount: items.reduce((sum, item) => sum + item.mushroomCount, 0),
      matureCount: items.reduce((sum, item) => sum + item.matureCount, 0),
    };
    return { date: day, summary, items };
  }

  async latestPerCamera(user: AuthUser, date: string): Promise<HarvestItem[]> {
    const scope = ShedScope.fromUser(user);
    const { start, end } = shanghaiDayRange(date);
    const rows = await this.records.query(
      `
      SELECT DISTINCT ON (camera_code)
        id,
        shed_code AS "shedCode",
        camera_code AS "cameraCode",
        recognized_at AS "recognizedAt",
        mushroom_count AS "mushroomCount",
        mature_count AS "matureCount",
        avg_cap_diameter AS "avgCapDiameter",
        disease_count AS "diseaseCount",
        disease_level AS "diseaseLevel"
      FROM recognition_records
      WHERE recognized_at >= $1 AND recognized_at < $2
        AND ($3::text[] IS NULL OR shed_code = ANY($3::text[]))
      ORDER BY camera_code, recognized_at DESC
      `,
      [start, end, scope.sqlParam()],
    );
    return rows as HarvestItem[];
  }

  async correct(
    user: AuthUser,
    id: string,
    patch: { matureCount?: number; mushroomCount?: number },
  ): Promise<HarvestCorrection> {
    if (patch.matureCount === undefined && patch.mushroomCount === undefined) {
      throw new BadRequestException('请提供成熟数或蘑菇数');
    }
    const record = await this.records.findOne({ where: { id } });
    if (!record) throw new NotFoundException('采摘记录不存在');
    ShedScope.fromUser(user).assert(record.shedCode);

    const matureCount = patch.matureCount ?? record.matureCount;
    const mushroomCount = patch.mushroomCount ?? record.mushroomCount;
    if (matureCount > mushroomCount) {
      throw new BadRequestException('成熟数不能大于蘑菇数');
    }

    const changes: HarvestCorrection['changes'] = {};
    if (matureCount !== record.matureCount) {
      changes.matureCount = { old: record.matureCount, new: matureCount };
    }
    if (mushroomCount !== record.mushroomCount) {
      changes.mushroomCount = { old: record.mushroomCount, new: mushroomCount };
    }
    if (changes.matureCount || changes.mushroomCount) {
      record.matureCount = matureCount;
      record.mushroomCount = mushroomCount;
      await this.records.save(record);
      if (changes.mushroomCount) {
        try {
          await this.growth?.refreshDay(
            shanghaiDate(new Date(record.recognizedAt)),
          );
        } catch (error) {
          this.logger.warn(
            `日聚合刷新失败，采摘修正已保存：${(error as Error).message}`,
          );
        }
      }
    }
    return { item: toHarvestItem(record), changes };
  }

  async yieldEstimate(user: AuthUser, shedCode?: string) {
    const scope = ShedScope.fromUser(user);
    const filter = shedCode?.trim() || null;
    if (filter) scope.assert(filter);

    const today = todayShanghai();
    const calendarDates = Array.from(
      { length: YIELD_ESTIMATE_HISTORY_DAYS },
      (_, index) =>
        shiftShanghaiDate(today, index - (YIELD_ESTIMATE_HISTORY_DAYS - 1)),
    );
    const horizonDates = Array.from(
      { length: YIELD_ESTIMATE_HORIZON_DAYS },
      (_, index) => shiftShanghaiDate(today, index + 1),
    );
    const start = shanghaiDayRange(calendarDates[0]).start;
    const end = shanghaiDayRange(today).end;
    const rows = (await this.records.query(YIELD_DAILY_SQL, [
      start,
      end,
      scope.sqlParam(),
      filter,
    ])) as { day: unknown; matureCount: unknown }[];
    const byDay = new Map<string, number>();
    for (const row of rows) {
      byDay.set(dayKey(row.day), Number(row.matureCount));
    }
    const calendar = calendarDates.map((date) => ({
      date,
      matureCount: byDay.has(date) ? (byDay.get(date) as number) : null,
    }));
    return {
      shedCode: filter,
      ...projectMatureYield({ calendar, horizonDates }),
    };
  }
}

const YIELD_DAILY_SQL = `
-- yield_daily
SELECT day::text AS day,
       SUM(mature_count)::int AS "matureCount"
FROM (
  SELECT DISTINCT ON (
    shed_code,
    camera_code,
    (recognized_at AT TIME ZONE 'Asia/Shanghai')::date
  )
    (recognized_at AT TIME ZONE 'Asia/Shanghai')::date AS day,
    mature_count
  FROM recognition_records
  WHERE recognized_at >= $1
    AND recognized_at < $2
    AND ($3::text[] IS NULL OR shed_code = ANY($3::text[]))
    AND ($4::text IS NULL OR shed_code = $4)
  ORDER BY
    shed_code,
    camera_code,
    (recognized_at AT TIME ZONE 'Asia/Shanghai')::date,
    recognized_at DESC
) latest
GROUP BY day
ORDER BY day
`;

function dayKey(value: unknown): string {
  if (value instanceof Date) return shanghaiDate(value);
  const text = String(value);
  const matched = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (matched) return matched[1];
  return text.slice(0, 10);
}

function toHarvestItem(record: RecognitionRecord): HarvestItem {
  return {
    id: record.id,
    shedCode: record.shedCode,
    cameraCode: record.cameraCode,
    recognizedAt: record.recognizedAt,
    mushroomCount: record.mushroomCount,
    matureCount: record.matureCount,
    avgCapDiameter: record.avgCapDiameter,
    diseaseCount: record.diseaseCount,
    diseaseLevel: record.diseaseLevel,
  };
}
