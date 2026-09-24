import { shanghaiDate } from '@mushroom/contracts';
import {
  METRIC_CAP_DIAMETER_MEAN,
  METRIC_DISEASE_COUNT,
  METRIC_ENV_CO2,
  METRIC_ENV_HUMIDITY,
  METRIC_ENV_MOISTURE,
  METRIC_ENV_TEMPERATURE,
  METRIC_MATURE_COUNT,
  METRIC_MUSHROOM_COUNT,
} from '../growth';

export const REPORT_KINDS = [
  'growth',
  'yield',
  'disease',
  'environment',
  'devices',
  'alerts',
] as const;

export type ReportKind = (typeof REPORT_KINDS)[number];
export type ReportGrain = 'day' | 'week' | 'month';

export interface ReportColumn {
  header: string;
  key: string;
  width: number;
}

export interface BucketFact {
  shedCode: string;
  bucketStart: Date | string;
  metric: string;
  value: number | null;
}

export interface ReportPreview {
  kind: ReportKind;
  grain: ReportGrain | null;
  from: string;
  to: string;
  shedCode: string | null;
  title: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
}

const GROWTH_COLUMNS: ReportColumn[] = [
  { header: '棚区', key: 'shedCode', width: 12 },
  { header: '周期', key: 'period', width: 14 },
  { header: '蘑菇数量', key: 'mushroomCount', width: 12 },
  { header: '成熟数量', key: 'matureCount', width: 12 },
  { header: '成熟率', key: 'matureRate', width: 12 },
  { header: '平均菌盖直径cm', key: 'capDiameterMean', width: 18 },
];

export function isReportKind(value: string): value is ReportKind {
  return (REPORT_KINDS as readonly string[]).includes(value);
}

export function rollupGrowth(
  rows: BucketFact[],
  grain: ReportGrain,
): Record<string, string | number | null>[] {
  const grouped = new Map<
    string,
    {
      shedCode: string;
      period: string;
      days: Map<string, { mushroom: number | null; mature: number | null; cap: number | null }>;
    }
  >();
  for (const row of rows) {
    const day = shanghaiDate(new Date(row.bucketStart));
    const period = periodKey(day, grain);
    const id = `${row.shedCode}|${period}`;
    const slot = grouped.get(id) ?? {
      shedCode: row.shedCode,
      period,
      days: new Map(),
    };
    const point = slot.days.get(day) ?? { mushroom: null, mature: null, cap: null };
    if (row.metric === METRIC_MUSHROOM_COUNT) point.mushroom = num(row.value);
    if (row.metric === METRIC_MATURE_COUNT) point.mature = num(row.value);
    if (row.metric === METRIC_CAP_DIAMETER_MEAN) point.cap = num(row.value);
    slot.days.set(day, point);
    grouped.set(id, slot);
  }
  return [...grouped.values()]
    .map((slot) => {
      const days = [...slot.days.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      const last = [...days].reverse().find(([, point]) => point.mushroom !== null || point.mature !== null);
      const mushroomCount = last?.[1].mushroom ?? null;
      const matureCount = last?.[1].mature ?? null;
      const caps = days
        .map(([, point]) => point.cap)
        .filter((value): value is number => value !== null);
      const capDiameterMean = caps.length
        ? Math.round((caps.reduce((sum, value) => sum + value, 0) / caps.length) * 10) / 10
        : null;
      return {
        shedCode: slot.shedCode,
        period: slot.period,
        mushroomCount,
        matureCount,
        matureRate:
          mushroomCount && matureCount !== null
            ? Math.round((matureCount / mushroomCount) * 1000) / 1000
            : null,
        capDiameterMean,
      };
    })
    .sort((a, b) =>
      String(a.period).localeCompare(String(b.period)) ||
      String(a.shedCode).localeCompare(String(b.shedCode)),
    );
}

export function rollupYield(rows: BucketFact[]): Record<string, string | number | null>[] {
  const daily = rollupGrowth(rows, 'day');
  const byShed = new Map<string, { mature: number | null; caps: number[] }>();
  for (const row of daily) {
    const shedCode = String(row.shedCode);
    const slot = byShed.get(shedCode) ?? { mature: null, caps: [] };
    if (row.matureCount !== null) slot.mature = Number(row.matureCount);
    if (row.capDiameterMean !== null) slot.caps.push(Number(row.capDiameterMean));
    byShed.set(shedCode, slot);
  }
  return [...byShed.entries()]
    .map(([shedCode, slot]) => ({
      shedCode,
      matureCount: slot.mature,
      capDiameterMean: slot.caps.length
        ? Math.round((slot.caps.reduce((sum, value) => sum + value, 0) / slot.caps.length) * 10) / 10
        : null,
    }))
    .sort((a, b) => a.shedCode.localeCompare(b.shedCode));
}

export function rollupDisease(rows: BucketFact[]): Record<string, string | number | null>[] {
  const byShed = new Map<string, { lastDay: string; last: number | null; peak: number | null }>();
  for (const row of rows) {
    if (row.metric !== METRIC_DISEASE_COUNT) continue;
    const day = shanghaiDate(new Date(row.bucketStart));
    const value = num(row.value);
    const slot = byShed.get(row.shedCode) ?? { lastDay: '', last: null, peak: null };
    if (day >= slot.lastDay) {
      slot.lastDay = day;
      slot.last = value;
    }
    if (value !== null && (slot.peak === null || value > slot.peak)) slot.peak = value;
    byShed.set(row.shedCode, slot);
  }
  return [...byShed.entries()]
    .map(([shedCode, slot]) => ({
      shedCode,
      diseaseCount: slot.last,
      diseasePeak: slot.peak,
    }))
    .sort((a, b) => a.shedCode.localeCompare(b.shedCode));
}

export function rollupEnvironment(
  rows: BucketFact[],
): Record<string, string | number | null>[] {
  const metrics = [
    METRIC_ENV_TEMPERATURE,
    METRIC_ENV_HUMIDITY,
    METRIC_ENV_CO2,
    METRIC_ENV_MOISTURE,
  ] as const;
  const byShed = new Map<string, Record<string, number[]>>();
  for (const row of rows) {
    if (!(metrics as readonly string[]).includes(row.metric) || row.value === null) continue;
    const slot = byShed.get(row.shedCode) ?? {};
    const list = slot[row.metric] ?? [];
    list.push(row.value);
    slot[row.metric] = list;
    byShed.set(row.shedCode, slot);
  }
  return [...byShed.entries()]
    .map(([shedCode, slot]) => ({
      shedCode,
      temperature: mean(slot[METRIC_ENV_TEMPERATURE]),
      humidity: mean(slot[METRIC_ENV_HUMIDITY]),
      co2: mean(slot[METRIC_ENV_CO2]),
      substrateMoisture: mean(slot[METRIC_ENV_MOISTURE]),
    }))
    .sort((a, b) => a.shedCode.localeCompare(b.shedCode));
}

export const YIELD_COLUMNS: ReportColumn[] = [
  { header: '棚区', key: 'shedCode', width: 12 },
  { header: '期末成熟数', key: 'matureCount', width: 14 },
  { header: '平均菌盖直径cm', key: 'capDiameterMean', width: 18 },
];

export const DISEASE_COLUMNS: ReportColumn[] = [
  { header: '棚区', key: 'shedCode', width: 12 },
  { header: '期末病害数', key: 'diseaseCount', width: 14 },
  { header: '窗内峰值', key: 'diseasePeak', width: 12 },
];

export const ENVIRONMENT_COLUMNS: ReportColumn[] = [
  { header: '棚区', key: 'shedCode', width: 12 },
  { header: '温度', key: 'temperature', width: 10 },
  { header: '湿度', key: 'humidity', width: 10 },
  { header: 'CO2', key: 'co2', width: 10 },
  { header: '基质含水率', key: 'substrateMoisture', width: 14 },
];

export const GROWTH_PREVIEW_COLUMNS = GROWTH_COLUMNS;

export function periodKey(day: string, grain: ReportGrain): string {
  if (grain === 'day') return day;
  if (grain === 'month') return day.slice(0, 7);
  return mondayOf(day);
}

function mondayOf(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, date));
  const dow = utc.getUTCDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  utc.setUTCDate(utc.getUTCDate() + offset);
  return utc.toISOString().slice(0, 10);
}

function num(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.round(value);
}

function mean(values: number[] | undefined): number | null {
  if (!values?.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}
