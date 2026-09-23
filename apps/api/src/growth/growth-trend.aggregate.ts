import { averageDiameter, shanghaiDate } from '@mushroom/contracts';

export interface AggregateSource {
  id?: string;
  shedCode: string;
  cameraCode: string;
  recognizedAt: Date | string;
  mushroomCount: number;
  avgCapDiameter: number | null;
}

export interface DailyAggregateDraft {
  day: string;
  grain: 'shed' | 'camera';
  shedCode: string;
  cameraCode: string;
  mushroomCount: number;
  capDiameterMean: number | null;
  sampleCount: number;
}

export function shiftShanghaiDay(day: string, delta: number): string {
  const start = new Date(`${day}T00:00:00+08:00`);
  return shanghaiDate(new Date(start.getTime() + delta * 24 * 60 * 60 * 1000));
}

/**
 * 蘑菇数取该摄像头当日最后一条，避免分钟级上报把同一批菇累加。
 * 菌盖直径取当日各条 avgCapDiameter 的均值；没有直径则留空。
 */
export function aggregateDay(
  day: string,
  records: AggregateSource[],
): DailyAggregateDraft[] {
  const inDay = records.filter(
    (record) => shanghaiDate(new Date(record.recognizedAt)) === day,
  );
  const byCamera = new Map<string, AggregateSource[]>();
  for (const record of inDay) {
    const key = `${record.shedCode}\0${record.cameraCode}`;
    const list = byCamera.get(key) ?? [];
    list.push(record);
    byCamera.set(key, list);
  }

  const cameraRows: DailyAggregateDraft[] = [];
  const byShed = new Map<string, AggregateSource[]>();
  for (const [key, list] of byCamera) {
    const shedCode = key.split('\0')[0];
    const cameraCode = key.slice(shedCode.length + 1);
    cameraRows.push({
      day,
      grain: 'camera',
      shedCode,
      cameraCode,
      mushroomCount: latest(list).mushroomCount,
      capDiameterMean: meanDiameter(list),
      sampleCount: list.length,
    });
    const shedList = byShed.get(shedCode) ?? [];
    shedList.push(...list);
    byShed.set(shedCode, shedList);
  }

  const shedRows: DailyAggregateDraft[] = [];
  for (const [shedCode, list] of byShed) {
    const cameras = cameraRows.filter((row) => row.shedCode === shedCode);
    shedRows.push({
      day,
      grain: 'shed',
      shedCode,
      cameraCode: '',
      mushroomCount: cameras.reduce((sum, row) => sum + row.mushroomCount, 0),
      capDiameterMean: meanDiameter(list),
      sampleCount: list.length,
    });
  }

  return [...shedRows, ...cameraRows].sort((a, b) => {
    if (a.shedCode !== b.shedCode) return a.shedCode < b.shedCode ? -1 : 1;
    if (a.grain !== b.grain) return a.grain === 'shed' ? -1 : 1;
    return a.cameraCode < b.cameraCode ? -1 : 1;
  });
}

function latest(records: AggregateSource[]): AggregateSource {
  return [...records].sort((a, b) => {
    const delta =
      new Date(b.recognizedAt).getTime() - new Date(a.recognizedAt).getTime();
    if (delta !== 0) return delta;
    return (a.id ?? '') < (b.id ?? '') ? 1 : -1;
  })[0];
}

function meanDiameter(records: AggregateSource[]): number | null {
  const values = records
    .map((record) => record.avgCapDiameter)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  return averageDiameter(values);
}
