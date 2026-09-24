import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
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
import {
  HARVEST_SHIFTS,
  HARVEST_TASK_STATUSES,
  HarvestShift,
  HarvestTask,
  HarvestTaskStatus,
} from '../entities/harvest-task.entity';
import { MetricBucketDay } from '../entities/metric-bucket.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import { GrowthTrendService, METRIC_MATURE_COUNT } from '../growth';
import {
  BUCKET_FORECAST_WINDOW_DAYS,
  forecastFromBucketSpeed,
} from './bucket-forecast';
import {
  nextTaskStatus,
  planHarvestTasks,
  scheduleAssist,
} from './harvest-task.plan';
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
    @InjectRepository(HarvestTask)
    private readonly tasks: Repository<HarvestTask>,
    @InjectRepository(MetricBucketDay)
    private readonly dayBuckets: Repository<MetricBucketDay>,
  ) {}

  @Cron('15 6 * * *', { timeZone: 'Asia/Shanghai' })
  async scheduledHarvestTasks() {
    try {
      const result = await this.generateForScope(
        new ShedScope(null),
        todayShanghai(),
      );
      this.logger.log(`采摘任务清单 ${result.date}：${result.items.length} 条`);
      return result;
    } catch (error) {
      this.logger.warn(`采摘任务清单生成失败：${(error as Error).message}`);
      return null;
    }
  }

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
    return this.latestPerCameraScope(ShedScope.fromUser(user), date);
  }

  private async latestPerCameraScope(
    scope: ShedScope,
    date: string,
  ): Promise<HarvestItem[]> {
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

  async listTasks(user: AuthUser, date?: string) {
    const day = assertDay(date || todayShanghai());
    return this.tasksForScope(ShedScope.fromUser(user), day);
  }

  async generateTasks(user: AuthUser, date?: string) {
    const day = assertDay(date || todayShanghai());
    return this.generateForScope(ShedScope.fromUser(user), day);
  }

  async scheduleTask(
    user: AuthUser,
    id: string,
    patch: {
      assignee?: string;
      shift?: string | null;
      status?: string;
      note?: string;
    },
  ) {
    const task = await this.tasks.findOne({ where: { id } });
    if (!task) throw new NotFoundException('采摘任务不存在');
    ShedScope.fromUser(user).assert(task.shedCode);
    const assignee =
      patch.assignee === undefined ? task.assignee : blank(patch.assignee);
    const shift =
      patch.shift === undefined ? task.shift : parseShift(patch.shift);
    const status = nextTaskStatus({
      current: task.status,
      assignee,
      shift,
      requested: patch.status ? parseStatus(patch.status) : undefined,
    });
    task.assignee = assignee;
    task.shift = shift;
    task.status = status;
    if (patch.note !== undefined) task.note = blank(patch.note);
    task.updatedAt = new Date();
    await this.tasks.save(task);
    return toTask(task);
  }

  async bucketForecast(user: AuthUser, shedCode?: string) {
    const scope = ShedScope.fromUser(user);
    const filter = shedCode?.trim() || null;
    if (filter) scope.assert(filter);
    const today = todayShanghai();
    const startDay = shiftShanghaiDate(today, -(BUCKET_FORECAST_WINDOW_DAYS - 1));
    const start = shanghaiDayRange(startDay).start;
    const end = shanghaiDayRange(today).end;
    const rows = await this.dayBuckets
      .createQueryBuilder('b')
      .where('b.metric = :metric', { metric: METRIC_MATURE_COUNT })
      .andWhere('b.cameraCode = :camera', { camera: '' })
      .andWhere('b.bucketStart >= :start AND b.bucketStart < :end', {
        start,
        end,
      })
      .getMany();
    const byDay = new Map<string, number>();
    for (const row of rows) {
      if (row.cameraCode !== '' || row.metric !== METRIC_MATURE_COUNT) continue;
      if (!scope.allows(row.shedCode)) continue;
      if (filter && row.shedCode !== filter) continue;
      const at = new Date(row.bucketStart).getTime();
      if (at < start.getTime() || at >= end.getTime()) continue;
      const day = shanghaiDate(new Date(row.bucketStart));
      byDay.set(day, (byDay.get(day) ?? 0) + Math.round(row.value ?? 0));
    }
    return {
      shedCode: filter,
      windowDays: BUCKET_FORECAST_WINDOW_DAYS,
      ...forecastFromBucketSpeed({
        today,
        points: [...byDay.entries()].map(([date, matureCount]) => ({
          date,
          matureCount,
        })),
      }),
    };
  }

  private async generateForScope(scope: ShedScope, day: string) {
    const picks = (await this.latestPerCameraScope(scope, day)).filter(
      (item) => item.matureCount > 0,
    );
    const existing = (await this.tasks.find({ where: { taskDate: day } })).filter(
      (task) => scope.allows(task.shedCode),
    );
    const plan = planHarvestTasks(existing, picks, (pick) => {
      const now = new Date();
      return this.tasks.create({
        id: randomUUID(),
        taskDate: day,
        shedCode: pick.shedCode,
        cameraCode: pick.cameraCode,
        matureCount: pick.matureCount,
        mushroomCount: pick.mushroomCount,
        status: 'open',
        assignee: null,
        shift: null,
        note: null,
        createdAt: now,
        updatedAt: now,
      });
    });
    for (const id of plan.removeIds) await this.tasks.delete({ id });
    for (const task of plan.upserts) await this.tasks.save(task);
    return this.tasksForScope(scope, day);
  }

  private async tasksForScope(scope: ShedScope, day: string) {
    const rows = (await this.tasks.find({ where: { taskDate: day } }))
      .filter((task) => scope.allows(task.shedCode))
      .sort((a, b) =>
        a.shedCode === b.shedCode
          ? a.cameraCode.localeCompare(b.cameraCode)
          : a.shedCode.localeCompare(b.shedCode),
      );
    const items = rows.map(toTask);
    const byShed = new Map<string, typeof items>();
    for (const item of items) {
      const list = byShed.get(item.shedCode) ?? [];
      list.push(item);
      byShed.set(item.shedCode, list);
    }
    return {
      date: day,
      schedule: scheduleAssist(items),
      sheds: [...byShed.entries()].map(([shedCode, shedItems]) => ({
        shedCode,
        cameraCount: shedItems.length,
        matureCount: shedItems.reduce((sum, item) => sum + item.matureCount, 0),
        items: shedItems,
      })),
      items,
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

function assertDay(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new BadRequestException('日期格式应为 YYYY-MM-DD');
  }
  return date;
}

function parseShift(value: string | null): HarvestShift | null {
  if (value === null || value === '') return null;
  if ((HARVEST_SHIFTS as readonly string[]).includes(value)) {
    return value as HarvestShift;
  }
  throw new BadRequestException('班次只支持上午或下午');
}

function parseStatus(value: string): HarvestTaskStatus {
  if ((HARVEST_TASK_STATUSES as readonly string[]).includes(value)) {
    return value as HarvestTaskStatus;
  }
  throw new BadRequestException('任务状态无效');
}

function blank(value: string | null): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function toTask(task: HarvestTask) {
  return {
    id: task.id,
    taskDate: task.taskDate,
    shedCode: task.shedCode,
    cameraCode: task.cameraCode,
    matureCount: task.matureCount,
    mushroomCount: task.mushroomCount,
    status: task.status,
    assignee: task.assignee,
    shift: task.shift,
    note: task.note,
  };
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
