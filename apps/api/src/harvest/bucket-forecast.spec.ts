import { shiftShanghaiDate } from '@mushroom/contracts';
import { forecastFromBucketSpeed } from './bucket-forecast';

describe('bucket growth speed forecast', () => {
  it('projects the next three days from the recent mature-count speed', () => {
    const today = '2026-09-24';
    const result = forecastFromBucketSpeed({
      today,
      points: [
        { date: '2026-09-21', matureCount: 10 },
        { date: '2026-09-24', matureCount: 16 },
      ],
    });
    expect(result.sufficient).toBe(true);
    expect(result.label).toBe('估计');
    expect(result.speedPerDay).toBe(2);
    expect(result.days).toEqual([
      { date: '2026-09-25', offsetDays: 1, matureCount: 18 },
      { date: '2026-09-26', offsetDays: 2, matureCount: 20 },
      { date: '2026-09-27', offsetDays: 3, matureCount: 22 },
    ]);
    expect(result.method).toContain('日桶');
  });

  it('does not invent numbers when fewer than two separated days exist', () => {
    const result = forecastFromBucketSpeed({
      today: '2026-09-24',
      points: [{ date: '2026-09-24', matureCount: 9 }],
    });
    expect(result.sufficient).toBe(false);
    expect(result.days).toEqual([]);
    expect(result.message).toContain('近窗日桶不足');
    expect(shiftShanghaiDate('2026-09-24', 1)).toBe('2026-09-25');
  });
});
