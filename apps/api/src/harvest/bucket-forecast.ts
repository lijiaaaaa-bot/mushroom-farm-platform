import {
  YIELD_ESTIMATE_HORIZON_DAYS,
  shiftShanghaiDate,
} from '@mushroom/contracts';

export const BUCKET_FORECAST_WINDOW_DAYS = 7;

export const BUCKET_FORECAST_METHOD =
  '近 7 个上海自然日棚级成熟日桶首尾增速，外推未来 3 日';

export interface MatureBucketPoint {
  date: string;
  matureCount: number;
}

export interface BucketForecastDay {
  date: string;
  offsetDays: number;
  matureCount: number;
}

export interface BucketForecast {
  label: '估计';
  sufficient: boolean;
  method: string;
  message: string | null;
  speedPerDay: number | null;
  historyDays: number;
  days: BucketForecastDay[];
}

export function thinBucketMessage(historyDays: number): string {
  return `近窗日桶不足：至少需要 2 个相隔不少于 1 天的成熟日桶，才按增速估计未来 2–3 日。当前有 ${historyDays} 天。`;
}

/**
 * 用近窗日桶首尾差除以间隔天数得到每日增速。
 * 未来第 n 日 = 最后一天成熟数 + 增速 × 距最后一天的天数，四舍五入且不小于 0。
 */
export function forecastFromBucketSpeed(input: {
  points: MatureBucketPoint[];
  today: string;
  horizonDays?: number;
}): BucketForecast {
  const horizonDays = input.horizonDays ?? YIELD_ESTIMATE_HORIZON_DAYS;
  const points = [...input.points].sort((a, b) => a.date.localeCompare(b.date));
  const base = {
    label: '估计' as const,
    method: BUCKET_FORECAST_METHOD,
    historyDays: points.length,
    speedPerDay: null as number | null,
    days: [] as BucketForecastDay[],
  };
  if (points.length < 2) {
    return {
      ...base,
      sufficient: false,
      message: thinBucketMessage(points.length),
    };
  }
  const first = points[0];
  const last = points[points.length - 1];
  const span = daysBetween(first.date, last.date);
  if (span < 1) {
    return {
      ...base,
      sufficient: false,
      message: thinBucketMessage(points.length),
    };
  }
  const speed = (last.matureCount - first.matureCount) / span;
  const horizonDates = Array.from({ length: horizonDays }, (_, index) =>
    shiftShanghaiDate(input.today, index + 1),
  );
  return {
    ...base,
    sufficient: true,
    message: null,
    speedPerDay: Math.round(speed * 100) / 100,
    days: horizonDates.map((date, index) => ({
      date,
      offsetDays: index + 1,
      matureCount: Math.max(
        0,
        Math.round(last.matureCount + speed * daysBetween(last.date, date)),
      ),
    })),
  };
}

export function daysBetween(start: string, end: string): number {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const ms = Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd);
  return Math.round(ms / 86_400_000);
}
