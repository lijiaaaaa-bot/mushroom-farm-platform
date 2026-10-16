import { DashboardService } from './dashboard.service';
import { AuthUser } from '../common/auth-user';

describe('dashboard overview bucket reads', () => {
  it('fills today counts, the 7-day trend, and env means from growth buckets', async () => {
    const query = jest.fn(() => {
      throw new Error('recognition_records scanned');
    });
    const qb = {
      where() {
        return qb;
      },
      andWhere() {
        return qb;
      },
      orderBy() {
        return qb;
      },
      take() {
        return qb;
      },
      clone() {
        return qb;
      },
      getCount: async () => 1,
      getMany: async () => [],
    };
    const growth = {
      todaySnapshot: jest.fn().mockResolvedValue({
        mushroomCount: 9,
        matureCount: 3,
        harvestableCameras: 1,
        recognitionCount: 4,
        captureCount: 2,
        diseaseCount: 5,
      }),
      liveMushroomTotals: jest.fn().mockResolvedValue({
        liveMushroomTotal: 30,
        liveMatureTotal: 11,
        liveImmatureTotal: 19,
      }),
      farmEnvironmentMeans: jest.fn().mockResolvedValue({
        envMeanTemperature: 24,
        envMeanHumidity: 85,
        envMeanCo2: 800,
        envMeanSubstrateMoisture: 73,
      }),
      trendFromDayBuckets: jest
        .fn()
        .mockResolvedValue([
          { day: '2026-09-24', mushroom: 9, mature: 3, disease: 2 },
        ]),
      latestEnvironment: jest.fn().mockResolvedValue({
        avgTemp: 21,
        avgHumidity: 80,
        avgCo2: 600,
        avgSubstrateMoisture: 55,
      }),
    };
    const dashboard = new DashboardService(
      { counts: async () => ({ total: 2, online: 1 }) } as never,
      { createQueryBuilder: () => qb } as never,
      { createQueryBuilder: () => qb } as never,
      { createQueryBuilder: () => qb, query } as never,
      growth as never,
    );
    const user: AuthUser = {
      id: 'admin',
      username: 'admin',
      displayName: 'admin',
      role: 'super_admin',
      shedCodes: [],
    };
    const overview = await dashboard.overview(user);
    expect(query).not.toHaveBeenCalled();
    expect(growth.todaySnapshot).toHaveBeenCalled();
    expect(growth.liveMushroomTotals).toHaveBeenCalled();
    expect(growth.farmEnvironmentMeans).toHaveBeenCalled();
    expect(growth.trendFromDayBuckets).toHaveBeenCalled();
    expect(growth.latestEnvironment).toHaveBeenCalled();
    expect(overview.todayMushroom).toBe(9);
    expect(overview.todayMature).toBe(3);
    expect(overview.todayRecognitionCount).toBe(4);
    expect(overview.todayCaptureCount).toBe(2);
    expect(overview.todayDiseaseCount).toBe(5);
    expect(overview.liveMushroomTotal).toBe(30);
    expect(overview.liveMatureTotal).toBe(11);
    expect(overview.liveImmatureTotal).toBe(19);
    expect(overview.envMeanTemperature).toBe(24);
    expect(overview.envMeanHumidity).toBe(85);
    expect(overview.envMeanCo2).toBe(800);
    expect(overview.envMeanSubstrateMoisture).toBe(73);
    expect(overview.harvestableCameras).toBe(1);
    expect(overview.trend).toEqual([
      { day: '2026-09-24', mushroom: 9, mature: 3, disease: 2 },
    ]);
    expect(overview.env).toEqual({
      avgTemp: 21,
      avgHumidity: 80,
      avgCo2: 600,
      avgSubstrateMoisture: 55,
    });
  });
});
