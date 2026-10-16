import { shanghaiDate, shiftShanghaiDate } from '@mushroom/contracts';
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
      shedLiveMatureCounts: jest
        .fn()
        .mockResolvedValue([{ shedCode: 'S01', matureCount: 11 }]),
      shedLiveDiseaseCounts: jest.fn().mockResolvedValue([
        {
          shedCode: 'S01',
          mushroomCount: 20,
          diseaseCount: 4,
          severeCount: 0,
        },
      ]),
      capDiameterDayPoints: jest.fn().mockResolvedValue([]),
      farmEnvironmentMeans: jest.fn().mockResolvedValue({
        envMeanTemperature: 24,
        envMeanHumidity: 85,
        envMeanCo2: 800,
        envMeanSubstrateMoisture: 73,
      }),
      farmEnvAnomalyPointCount: jest.fn().mockResolvedValue(2),
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
    const rules = {
      find: jest.fn().mockResolvedValue([
        {
          metric: 'temperature_high',
          threshold: 28,
          enabled: true,
          shedCode: null,
        },
      ]),
    };
    const dashboard = new DashboardService(
      {
        counts: async () => ({ total: 4, online: 2 }),
        countsByType: async () => ({
          cameraOnline: 1,
          cameraTotal: 2,
          aiBoxOnline: 1,
          aiBoxTotal: 1,
          sensorOnline: 0,
          sensorTotal: 1,
        }),
      } as never,
      { createQueryBuilder: () => qb } as never,
      { createQueryBuilder: () => qb } as never,
      { createQueryBuilder: () => qb, query } as never,
      growth as never,
      rules as never,
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
    expect(rules.find).toHaveBeenCalledWith({ where: { enabled: true } });
    expect(growth.farmEnvAnomalyPointCount).toHaveBeenCalledWith(
      expect.anything(),
      [
        {
          metric: 'temperature_high',
          threshold: 28,
          enabled: true,
          shedCode: null,
        },
      ],
    );
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
    expect(overview.maturePickThreshold).toBeNull();
    expect(overview.maturePickActive).toBe(false);
    expect(overview.maturePickMatureCount).toBe(11);
    expect(overview.maturePickNote).toBe('');
    expect(growth.shedLiveMatureCounts).toHaveBeenCalled();
    expect(growth.shedLiveDiseaseCounts).toHaveBeenCalled();
    expect(overview.diseaseWarnRatioThreshold).toBeNull();
    expect(overview.diseaseWarnRatioActive).toBe(false);
    expect(overview.diseaseWarnRatioPercent).toBe(20);
    expect(overview.diseaseWarnRatioNote).toBe('');
    expect(overview.diseaseWarnSevereThreshold).toBeNull();
    expect(overview.diseaseWarnSevereActive).toBe(false);
    expect(overview.diseaseWarnSevereCount).toBe(0);
    expect(overview.diseaseWarnSevereNote).toBe('');
    expect(growth.capDiameterDayPoints).toHaveBeenCalled();
    expect(overview.growthStallThreshold).toBeNull();
    expect(overview.growthStallActive).toBe(false);
    expect(overview.growthStallCurrent).toBe(0);
    expect(overview.growthStallNote).toBe('');
    expect(overview.envMeanTemperature).toBe(24);
    expect(overview.envMeanHumidity).toBe(85);
    expect(overview.envMeanCo2).toBe(800);
    expect(overview.envMeanSubstrateMoisture).toBe(73);
    expect(overview.envAnomalyPointCount).toBe(2);
    expect(overview.deviceTotal).toBe(4);
    expect(overview.deviceOnline).toBe(2);
    expect(overview.cameraOnline).toBe(1);
    expect(overview.cameraTotal).toBe(2);
    expect(overview.aiBoxOnline).toBe(1);
    expect(overview.aiBoxTotal).toBe(1);
    expect(overview.sensorOnline).toBe(0);
    expect(overview.sensorTotal).toBe(1);
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

  it('marks a pick reminder when live mature meets the base-wide threshold', async () => {
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
      getCount: async () => 0,
      getMany: async () => [],
    };
    const growth = {
      todaySnapshot: jest.fn().mockResolvedValue({
        mushroomCount: 20,
        matureCount: 8,
        harvestableCameras: 1,
        recognitionCount: 1,
        captureCount: 0,
        diseaseCount: 0,
      }),
      liveMushroomTotals: jest.fn().mockResolvedValue({
        liveMushroomTotal: 20,
        liveMatureTotal: 8,
        liveImmatureTotal: 12,
      }),
      shedLiveMatureCounts: jest.fn().mockResolvedValue([
        { shedCode: 'S01', matureCount: 8 },
        { shedCode: 'S02', matureCount: 0 },
      ]),
      shedLiveDiseaseCounts: jest.fn().mockResolvedValue([
        {
          shedCode: 'S01',
          mushroomCount: 20,
          diseaseCount: 4,
          severeCount: 4,
        },
        {
          shedCode: 'S02',
          mushroomCount: 0,
          diseaseCount: 0,
          severeCount: 0,
        },
      ]),
      capDiameterDayPoints: jest.fn().mockResolvedValue([
        {
          shedCode: 'S01',
          cameraCode: 'CAM-GST-01',
          day: stallDay(-2),
          capDiameterMean: 4,
        },
        {
          shedCode: 'S01',
          cameraCode: 'CAM-GST-01',
          day: stallDay(-1),
          capDiameterMean: 4,
        },
        {
          shedCode: 'S01',
          cameraCode: 'CAM-GST-01',
          day: stallDay(0),
          capDiameterMean: 4,
        },
        {
          shedCode: 'S02',
          cameraCode: 'CAM-GST-ZERO',
          day: stallDay(0),
          capDiameterMean: 4,
        },
      ]),
      farmEnvironmentMeans: jest.fn().mockResolvedValue({
        envMeanTemperature: null,
        envMeanHumidity: null,
        envMeanCo2: null,
        envMeanSubstrateMoisture: null,
      }),
      farmEnvAnomalyPointCount: jest.fn().mockResolvedValue(0),
      trendFromDayBuckets: jest.fn().mockResolvedValue([]),
      latestEnvironment: jest.fn().mockResolvedValue({
        avgTemp: null,
        avgHumidity: null,
        avgCo2: null,
        avgSubstrateMoisture: null,
      }),
    };
    const rules = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'rule-pick',
          metric: 'live_mature_pick',
          threshold: 8,
          enabled: true,
          shedCode: null,
        },
        {
          id: 'rule-shed',
          metric: 'live_mature_pick',
          threshold: 1,
          enabled: true,
          shedCode: 'S02',
        },
        {
          id: 'rule-ratio',
          metric: 'live_disease_ratio',
          threshold: 20,
          enabled: true,
          shedCode: null,
        },
        {
          id: 'rule-severe',
          metric: 'live_disease_severe',
          threshold: 4,
          enabled: true,
          shedCode: null,
        },
        {
          id: 'rule-severe-shed',
          metric: 'live_disease_severe',
          threshold: 1,
          enabled: true,
          shedCode: 'S02',
        },
        {
          id: 'rule-stall',
          metric: 'live_growth_stall',
          threshold: 2,
          enabled: true,
          shedCode: null,
        },
        {
          id: 'rule-stall-shed',
          metric: 'live_growth_stall',
          threshold: 1,
          enabled: true,
          shedCode: 'S02',
        },
      ]),
    };
    const dashboard = new DashboardService(
      {
        counts: async () => ({ total: 0, online: 0 }),
        countsByType: async () => ({
          cameraOnline: 0,
          cameraTotal: 0,
          aiBoxOnline: 0,
          aiBoxTotal: 0,
          sensorOnline: 0,
          sensorTotal: 0,
        }),
      } as never,
      { createQueryBuilder: () => qb } as never,
      { createQueryBuilder: () => qb } as never,
      { createQueryBuilder: () => qb } as never,
      growth as never,
      rules as never,
    );
    const overview = await dashboard.overview({
      id: 'admin',
      username: 'admin',
      displayName: 'admin',
      role: 'super_admin',
      shedCodes: [],
    });
    expect(overview.maturePickRuleId).toBe('rule-pick');
    expect(overview.maturePickShedCode).toBeNull();
    expect(overview.maturePickThreshold).toBe(8);
    expect(overview.maturePickMatureCount).toBe(8);
    expect(overview.maturePickActive).toBe(true);
    expect(overview.maturePickNote).toBe('采摘提醒 成熟≥8 当前8');
    expect(overview.diseaseWarnRatioRuleId).toBe('rule-ratio');
    expect(overview.diseaseWarnRatioShedCode).toBeNull();
    expect(overview.diseaseWarnRatioThreshold).toBe(20);
    expect(overview.diseaseWarnRatioPercent).toBe(20);
    expect(overview.diseaseWarnRatioActive).toBe(true);
    expect(overview.diseaseWarnRatioNote).toBe('病害预警 比例≥20% 当前20%');
    expect(overview.diseaseWarnSevereRuleId).toBe('rule-severe');
    expect(overview.diseaseWarnSevereShedCode).toBeNull();
    expect(overview.diseaseWarnSevereThreshold).toBe(4);
    expect(overview.diseaseWarnSevereCount).toBe(4);
    expect(overview.diseaseWarnSevereActive).toBe(true);
    expect(overview.diseaseWarnSevereNote).toBe('病害预警 重度≥4 当前4');
    expect(overview.growthStallRuleId).toBe('rule-stall');
    expect(overview.growthStallShedCode).toBeNull();
    expect(overview.growthStallThreshold).toBe(2);
    expect(overview.growthStallCurrent).toBe(2);
    expect(overview.growthStallActive).toBe(true);
    expect(overview.growthStallNote).toBe('生长异常预警 停滞≥2 当前2');
  });
});

function stallDay(offset: number) {
  return shiftShanghaiDate(shanghaiDate(new Date()), offset);
}
