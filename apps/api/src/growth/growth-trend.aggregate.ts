import { shanghaiDate } from '@mushroom/contracts';

export interface AggregateSource {
  id?: string;
  shedCode: string;
  cameraCode: string;
  recognizedAt: Date | string;
  mushroomCount: number;
  avgCapDiameter: number | null;
}

export function shiftShanghaiDay(day: string, delta: number): string {
  const start = new Date(`${day}T00:00:00+08:00`);
  return shanghaiDate(new Date(start.getTime() + delta * 24 * 60 * 60 * 1000));
}

export interface GrainPoint {
  day: string;
  mushroomCount: number;
  matureCount: number;
  capDiameterMean: number | null;
  sampleCount: number;
}

export type TrendGrain = 'day' | 'week' | 'month';

/** 与报表生长粒度同一套周期：周是周一，月是 YYYY-MM。 */
export function trendPeriodKey(day: string, grain: TrendGrain): string {
  if (grain === 'day') return day;
  if (grain === 'month') return day.slice(0, 7);
  return mondayOf(day);
}

export function rollupGrowthPoints<T extends GrainPoint>(
  points: T[],
  grain: Exclude<TrendGrain, 'day'>,
): T[] {
  const groups = new Map<string, T[]>();
  for (const point of points) {
    const key = trendPeriodKey(point.day, grain);
    const list = groups.get(key) ?? [];
    list.push(point);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, list]) => {
      const sorted = [...list].sort((a, b) => a.day.localeCompare(b.day));
      const last = sorted[sorted.length - 1];
      const caps = sorted
        .map((point) => point.capDiameterMean)
        .filter(
          (value): value is number => value !== null && Number.isFinite(value),
        );
      const capDiameterMean = caps.length
        ? Math.round(
            (caps.reduce((sum, value) => sum + value, 0) / caps.length) * 10,
          ) / 10
        : null;
      return {
        ...last,
        day: period,
        mushroomCount: last.mushroomCount,
        matureCount: last.matureCount,
        capDiameterMean,
        sampleCount: sorted.reduce((sum, point) => sum + point.sampleCount, 0),
      };
    });
}

function mondayOf(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, date));
  const dow = utc.getUTCDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  utc.setUTCDate(utc.getUTCDate() + offset);
  return utc.toISOString().slice(0, 10);
}
