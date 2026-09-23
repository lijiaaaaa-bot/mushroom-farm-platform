import { YIELD_ESTIMATE_HISTORY_DAYS } from '@mushroom/contracts';

export const YIELD_ESTIMATE_METHOD =
  '近 30 日各摄像头当日最新成熟数之和，按日序线性外推';

export interface ObservedDay {
  date: string;
  matureCount: number;
}

export interface YieldDay {
  date: string;
  offsetDays: number;
  matureCount: number;
}

export interface YieldProjection {
  label: '估计';
  sufficient: boolean;
  requiredDays: number;
  historyDays: number;
  horizonDays: number;
  method: string;
  message: string | null;
  observed: ObservedDay[];
  days: YieldDay[];
}

export function thinHistoryMessage(
  requiredDays: number,
  historyDays: number,
): string {
  return `有效历史不足：近 ${requiredDays} 个自然日仅有 ${historyDays} 天有成熟识别，满 ${requiredDays} 天后才给出近 2–3 日产量估计。`;
}

/**
 * 日历必须覆盖连续 required 天，缺任何一天都不外推。
 * 日序 0 为最旧一天。外推点从 required 起，对应未来第 1 天。
 */
export function projectMatureYield(input: {
  calendar: { date: string; matureCount: number | null }[];
  horizonDates: string[];
}): YieldProjection {
  const requiredDays = input.calendar.length || YIELD_ESTIMATE_HISTORY_DAYS;
  const observed = input.calendar.filter(
    (day): day is ObservedDay => day.matureCount !== null,
  );
  const historyDays = observed.length;
  const horizonDays = input.horizonDates.length;
  if (historyDays < requiredDays || horizonDays === 0) {
    return {
      label: '估计',
      sufficient: false,
      requiredDays,
      historyDays,
      horizonDays,
      method: YIELD_ESTIMATE_METHOD,
      message: thinHistoryMessage(requiredDays, historyDays),
      observed,
      days: [],
    };
  }

  const ys = observed.map((day) => day.matureCount);
  const n = ys.length;
  const xMean = (n - 1) / 2;
  const yMean = ys.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < n; index += 1) {
    const dx = index - xMean;
    numerator += dx * (ys[index] - yMean);
    denominator += dx * dx;
  }
  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = yMean - slope * xMean;
  const days = input.horizonDates.map((date, index) => {
    const raw = intercept + slope * (n + index);
    return {
      date,
      offsetDays: index + 1,
      matureCount: Math.max(0, Math.round(raw)),
    };
  });
  return {
    label: '估计',
    sufficient: true,
    requiredDays,
    historyDays,
    horizonDays,
    method: YIELD_ESTIMATE_METHOD,
    message: null,
    observed,
    days,
  };
}
