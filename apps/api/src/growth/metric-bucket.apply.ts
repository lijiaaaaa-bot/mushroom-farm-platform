import { averageDiameter } from '@mushroom/contracts';
import { DailyAggregateDraft } from './growth-trend.aggregate';

export const METRIC_MUSHROOM_COUNT = 'mushroom_count';
export const METRIC_CAP_DIAMETER_MEAN = 'cap_diameter_mean';
export const METRIC_SAMPLE_COUNT = 'sample_count';
export const METRIC_MATURE_COUNT = 'mature_count';
export const METRIC_DISEASE_COUNT = 'disease_count';
export const METRIC_ENV_TEMPERATURE = 'env_temperature';
export const METRIC_ENV_HUMIDITY = 'env_humidity';
export const METRIC_ENV_CO2 = 'env_co2';
export const METRIC_ENV_MOISTURE = 'env_substrate_moisture';

export const RECOGNITION_METRICS = [
  METRIC_MUSHROOM_COUNT,
  METRIC_CAP_DIAMETER_MEAN,
  METRIC_SAMPLE_COUNT,
  METRIC_MATURE_COUNT,
  METRIC_DISEASE_COUNT,
] as const;

export const ENVIRONMENT_METRICS = [
  METRIC_ENV_TEMPERATURE,
  METRIC_ENV_HUMIDITY,
  METRIC_ENV_CO2,
  METRIC_ENV_MOISTURE,
] as const;

export interface BucketView {
  shedCode: string;
  cameraCode: string;
  bucketStart: Date;
  metric: string;
  value: number | null;
  sampleCount: number;
  valueSum: number | null;
  latestAt: Date | null;
}

export interface RecognitionDelta {
  id?: string;
  shedCode: string;
  cameraCode: string;
  recognizedAt: Date | string;
  mushroomCount: number;
  avgCapDiameter: number | null;
  matureCount?: number;
  diseaseCount?: number;
}

export interface EnvironmentDelta {
  shedCode: string;
  sensorCode: string;
  observedAt: Date | string;
  temperature: number | null;
  humidity: number | null;
  co2: number | null;
  substrateMoisture: number | null;
}

export function bucketKey(row: {
  shedCode: string;
  cameraCode: string;
  bucketStart: Date | string;
  metric: string;
}): string {
  return `${row.shedCode}|${row.cameraCode}|${new Date(row.bucketStart).getTime()}|${row.metric}`;
}

export function compareRecognition(
  a: RecognitionDelta,
  b: RecognitionDelta,
): number {
  const delta =
    new Date(a.recognizedAt).getTime() - new Date(b.recognizedAt).getTime();
  if (delta !== 0) return delta;
  return (a.id ?? '').localeCompare(b.id ?? '');
}

/**
 * 把一条识别增量写入同一棚、同一桶起点下的摄像头行和棚行。
 * 蘑菇数按 recognizedAt 取最新；菌盖为运行均值；样本数加一。
 * 相同幂等键不得调用两次，否则样本数会加两次。
 */
export function applyRecognitionToBuckets(
  existing: BucketView[],
  record: RecognitionDelta,
  bucketStart: Date,
): { rows: BucketView[]; dirty: BucketView[] } {
  const rows = existing
    .filter((row) => row.shedCode === record.shedCode)
    .map((row) => ({
      ...row,
      bucketStart: new Date(row.bucketStart),
      latestAt: row.latestAt ? new Date(row.latestAt) : null,
    }));
  const dirty: BucketView[] = [];
  const map = new Map(
    rows.map((row) => [`${row.cameraCode}\0${row.metric}`, row]),
  );
  const touch = (cameraCode: string, metric: string): BucketView => {
    const id = `${cameraCode}\0${metric}`;
    let row = map.get(id);
    if (!row) {
      row = {
        shedCode: record.shedCode,
        cameraCode,
        bucketStart,
        metric,
        value: null,
        sampleCount: 0,
        valueSum: null,
        latestAt: null,
      };
      map.set(id, row);
      rows.push(row);
    }
    if (!dirty.includes(row)) dirty.push(row);
    return row;
  };

  const bumpSample = (cameraCode: string) => {
    const row = touch(cameraCode, METRIC_SAMPLE_COUNT);
    const next = (row.value ?? 0) + 1;
    row.value = next;
    row.sampleCount = next;
  };
  const bumpMushroom = (cameraCode: string) => {
    const row = touch(cameraCode, METRIC_MUSHROOM_COUNT);
    const at = new Date(record.recognizedAt);
    if (!row.latestAt || at.getTime() >= row.latestAt.getTime()) {
      row.value = record.mushroomCount;
      row.latestAt = at;
    }
  };
  const bumpMean = (cameraCode: string) => {
    if (
      record.avgCapDiameter === null ||
      !Number.isFinite(record.avgCapDiameter)
    ) {
      return;
    }
    const row = touch(cameraCode, METRIC_CAP_DIAMETER_MEAN);
    const sum = (row.valueSum ?? 0) + record.avgCapDiameter;
    const count = row.sampleCount + 1;
    row.valueSum = sum;
    row.sampleCount = count;
    row.value = averageDiameter([sum / count]);
  };

  const bumpLatest = (cameraCode: string, metric: string, value: number) => {
    const row = touch(cameraCode, metric);
    const at = new Date(record.recognizedAt);
    if (!row.latestAt || at.getTime() >= row.latestAt.getTime()) {
      row.value = value;
      row.latestAt = at;
    }
  };
  const rollLatestSum = (metric: string) => {
    let total = 0;
    for (const row of rows) {
      if (row.cameraCode && row.metric === metric && row.value !== null) {
        total += row.value;
      }
    }
    const shed = touch('', metric);
    shed.value = total;
  };

  bumpSample(record.cameraCode);
  bumpMushroom(record.cameraCode);
  bumpMean(record.cameraCode);
  bumpSample('');
  bumpMean('');
  rollLatestSum(METRIC_MUSHROOM_COUNT);
  if (isFiniteCount(record.matureCount)) {
    bumpLatest(record.cameraCode, METRIC_MATURE_COUNT, record.matureCount);
    rollLatestSum(METRIC_MATURE_COUNT);
  }
  if (isFiniteCount(record.diseaseCount)) {
    bumpLatest(record.cameraCode, METRIC_DISEASE_COUNT, record.diseaseCount);
    rollLatestSum(METRIC_DISEASE_COUNT);
  }
  return { rows, dirty };
}

function isFiniteCount(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 环境读数按传感器写入均值，并按样本数加权滚入棚行（cameraCode 为空）。
 * 同一幂等键不得调用两次。
 */
export function applyEnvironmentToBuckets(
  existing: BucketView[],
  reading: EnvironmentDelta,
  bucketStart: Date,
): { rows: BucketView[]; dirty: BucketView[] } {
  const rows = existing
    .filter((row) => row.shedCode === reading.shedCode)
    .map((row) => ({
      ...row,
      bucketStart: new Date(row.bucketStart),
      latestAt: row.latestAt ? new Date(row.latestAt) : null,
    }));
  const dirty: BucketView[] = [];
  const map = new Map(
    rows.map((row) => [`${row.cameraCode}\0${row.metric}`, row]),
  );
  const touch = (subject: string, metric: string): BucketView => {
    const id = `${subject}\0${metric}`;
    let row = map.get(id);
    if (!row) {
      row = {
        shedCode: reading.shedCode,
        cameraCode: subject,
        bucketStart,
        metric,
        value: null,
        sampleCount: 0,
        valueSum: null,
        latestAt: null,
      };
      map.set(id, row);
      rows.push(row);
    }
    if (!dirty.includes(row)) dirty.push(row);
    return row;
  };
  const bumpMean = (subject: string, metric: string, sample: number | null) => {
    if (sample === null || !Number.isFinite(sample)) return;
    const row = touch(subject, metric);
    const sum = (row.valueSum ?? 0) + sample;
    const count = row.sampleCount + 1;
    row.valueSum = sum;
    row.sampleCount = count;
    row.value = Math.round((sum / count) * 100) / 100;
    row.latestAt = new Date(reading.observedAt);
  };
  const samples: Array<[string, number | null]> = [
    [METRIC_ENV_TEMPERATURE, reading.temperature],
    [METRIC_ENV_HUMIDITY, reading.humidity],
    [METRIC_ENV_CO2, reading.co2],
    [METRIC_ENV_MOISTURE, reading.substrateMoisture],
  ];
  for (const [metric, value] of samples) {
    bumpMean(reading.sensorCode, metric, value);
    bumpMean('', metric, value);
  }
  return { rows, dirty };
}

export function foldBuckets(
  records: RecognitionDelta[],
  bucketStart: Date,
): BucketView[] {
  const byShed = new Map<string, RecognitionDelta[]>();
  for (const record of [...records].sort(compareRecognition)) {
    const list = byShed.get(record.shedCode) ?? [];
    list.push(record);
    byShed.set(record.shedCode, list);
  }
  const all: BucketView[] = [];
  for (const list of byShed.values()) {
    let state: BucketView[] = [];
    for (const record of list) {
      state = applyRecognitionToBuckets(state, record, bucketStart).rows;
    }
    all.push(...state);
  }
  return all;
}

function compareCameraCode(a: string, b: string): number {
  if (a === b) return 0;
  if (a === '') return -1;
  if (b === '') return 1;
  return a < b ? -1 : 1;
}

export function dailyDraftsFromBuckets(
  day: string,
  rows: BucketView[],
): DailyAggregateDraft[] {
  if (!rows.length) return [];
  const shedCode = rows[0].shedCode;
  const cameras = [...new Set(rows.map((row) => row.cameraCode))].sort(
    compareCameraCode,
  );
  return cameras.map((cameraCode) => {
    const metric = (name: string) =>
      rows.find((row) => row.cameraCode === cameraCode && row.metric === name);
    const mean = metric(METRIC_CAP_DIAMETER_MEAN);
    return {
      day,
      grain: cameraCode ? 'camera' : 'shed',
      shedCode,
      cameraCode,
      mushroomCount: Math.round(metric(METRIC_MUSHROOM_COUNT)?.value ?? 0),
      capDiameterMean: mean && mean.value !== null ? mean.value : null,
      sampleCount: Math.round(metric(METRIC_SAMPLE_COUNT)?.value ?? 0),
    };
  });
}
