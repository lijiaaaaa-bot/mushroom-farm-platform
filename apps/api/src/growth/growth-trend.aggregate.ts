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
