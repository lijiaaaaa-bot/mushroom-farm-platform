import { shanghaiDate } from '@mushroom/contracts';
import {
  METRIC_CAP_DIAMETER_MEAN,
  METRIC_MATURE_COUNT,
  METRIC_MUSHROOM_COUNT,
} from '../growth';

export interface CurveBucket {
  bucketStart: Date | string;
  metric: string;
  value: number | null;
  cameraCode: string;
}

export interface FlushCurvePoint {
  day: string;
  mushroomCount: number | null;
  matureCount: number | null;
  capDiameterMean: number | null;
}

/** 批次曲线只读棚级日桶。计数取当天值，不把多日库存相加。 */
export function curveFromDayBuckets(rows: CurveBucket[]): FlushCurvePoint[] {
  const byDay = new Map<string, FlushCurvePoint>();
  for (const row of rows) {
    if (row.cameraCode !== '') continue;
    const day = shanghaiDate(new Date(row.bucketStart));
    const point = byDay.get(day) ?? {
      day,
      mushroomCount: null,
      matureCount: null,
      capDiameterMean: null,
    };
    if (row.metric === METRIC_MUSHROOM_COUNT) {
      point.mushroomCount = roundCount(row.value);
    } else if (row.metric === METRIC_MATURE_COUNT) {
      point.matureCount = roundCount(row.value);
    } else if (row.metric === METRIC_CAP_DIAMETER_MEAN && row.value !== null) {
      point.capDiameterMean = Math.round(row.value * 10) / 10;
    }
    byDay.set(day, point);
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

function roundCount(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.round(value);
}
