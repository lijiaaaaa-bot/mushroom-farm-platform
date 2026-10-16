import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { currentUser, type SessionUser } from '../auth';
import { farmOpsTokens as tokens } from '../farm-ops-tokens';
import DashboardView from './DashboardView.vue';

const httpGet = vi.hoisted(() => vi.fn());
const httpPatch = vi.hoisted(() => vi.fn());
const httpPost = vi.hoisted(() => vi.fn());
const setOption = vi.hoisted(() => vi.fn());
const chartInit = vi.hoisted(() =>
  vi.fn(() => ({
    setOption,
    dispose: vi.fn(),
    resize: vi.fn(),
  })),
);

vi.mock('../api', () => ({
  http: { get: httpGet, patch: httpPatch, post: httpPost },
  errorText: () => '请求失败',
}));

vi.mock('echarts', () => ({
  init: chartInit,
}));

const overview = {
  shedCount: 3,
  deviceTotal: 8,
  deviceOnline: 8,
  todayMushroom: 40,
  todayMature: 221,
  todayRecognitionCount: 3,
  todayCaptureCount: 2,
  todayDiseaseCount: 5,
  liveMushroomTotal: 30,
  liveMatureTotal: 11,
  liveImmatureTotal: 19,
  envMeanTemperature: 24,
  envMeanHumidity: 85,
  envMeanCo2: 800,
  envMeanSubstrateMoisture: 73,
  envAnomalyPointCount: 2,
  cameraOnline: 2,
  cameraTotal: 3,
  aiBoxOnline: 1,
  aiBoxTotal: 2,
  sensorOnline: 1,
  sensorTotal: 2,
  harvestableCameras: 6,
  openAlerts: 8,
  severeAlerts: 2,
  env: { avgTemp: 22.4, avgHumidity: 81.2, avgCo2: 640, avgSubstrateMoisture: 55 },
  trend: [{ day: '2026-09-23', mushroom: 40, mature: 12, disease: 2 }],
  recentAlerts: [
    {
      id: 'alert-1',
      shedCode: 'S01',
      cameraCode: 'CAM-S01',
      level: 'severe' as const,
      status: 'open' as const,
      title: '高温',
      createdAt: '2026-09-23T01:02:00.000Z',
    },
  ],
  recentRecords: [
    {
      id: 'rec-1',
      shedCode: 'S01',
      cameraCode: 'CAM-S01-01',
      recognizedAt: '2026-09-23T01:02:00.000Z',
      mushroomCount: 10,
      matureCount: 4,
      diseaseCount: 1,
    },
  ],
};

const admin: SessionUser = {
  id: 'admin',
  username: 'admin',
  displayName: '管理员',
  role: 'super_admin',
  shedCodes: [],
};

describe('DashboardView', () => {
  beforeEach(() => {
    httpGet.mockReset();
    httpPatch.mockReset();
    httpPost.mockReset();
    setOption.mockReset();
    chartInit.mockClear();
    currentUser.value = null;
    localStorage.clear();
  });

  it('draws series from overview trend and lists alerts plus recognitions', async () => {
    httpGet.mockResolvedValue({ data: overview });
    const wrapper = mount(DashboardView);
    await flushPromises();

    expect(httpGet).toHaveBeenCalledWith('/dashboard/overview');
    expect(wrapper.find('.kpi-tile').exists()).toBe(false);
    expect(wrapper.find('.tb-kpi-strip').exists()).toBe(false);
    expect(wrapper.get('[data-field="today-recognition"]').text()).toBe('3');
    expect(wrapper.get('[data-field="today-capture"]').text()).toBe('2');
    expect(wrapper.get('[data-field="today-disease"]').text()).toBe('5');
    expect(wrapper.get('[data-field="today-note"]').text()).toBe('今日识别次数 3 · 今日抓拍总量 2');
    expect(wrapper.get('[data-field="today-disease-note"]').text()).toBe('当日病害总数 5');
    expect(wrapper.get('[data-field="live-mushroom"]').text()).toBe('30');
    expect(wrapper.get('[data-field="live-mature"]').text()).toBe('11');
    expect(wrapper.get('[data-field="live-immature"]').text()).toBe('19');
    expect(wrapper.get('[data-field="live-mushroom-note"]').text()).toBe(
      '在养蘑菇总数 30 · 成熟可采摘总数 11 · 待成熟数量 19',
    );
    expect(wrapper.get('[data-field="env-mean-title"]').text()).toBe('全园环境参数均值');
    expect(wrapper.get('[data-field="env-mean-temperature"]').text()).toBe('24℃');
    expect(wrapper.get('[data-field="env-mean-humidity"]').text()).toBe('85%');
    expect(wrapper.get('[data-field="env-mean-co2"]').text()).toBe('800ppm');
    expect(wrapper.get('[data-field="env-mean-moisture"]').text()).toBe('73%');
    expect(wrapper.get('[data-field="env-mean-note"]').text()).toBe(
      '全园环境参数均值 温度 24℃ · 湿度 85% · CO₂ 800ppm · 基质含水率 73%',
    );
    expect(wrapper.get('[data-field="env-anomaly-title"]').text()).toBe('异常环境点位数');
    expect(wrapper.get('[data-field="env-anomaly-count"]').text()).toBe('2');
    expect(wrapper.get('[data-field="env-anomaly-note"]').text()).toBe('异常环境点位数 2');
    expect(wrapper.get('[data-field="device-online-title"]').text()).toBe('全局设备在线');
    expect(wrapper.get('[data-field="device-online-camera-title"]').text()).toBe('摄像头');
    expect(wrapper.get('[data-field="device-online-camera"]').text()).toBe('2/3');
    expect(wrapper.get('[data-field="device-online-aibox-title"]').text()).toBe('AI盒子');
    expect(wrapper.get('[data-field="device-online-aibox"]').text()).toBe('1/2');
    expect(wrapper.get('[data-field="device-online-sensor-title"]').text()).toBe('传感器');
    expect(wrapper.get('[data-field="device-online-sensor"]').text()).toBe('1/2');
    expect(wrapper.get('[data-field="device-online-note"]').text()).toBe(
      '摄像头 2/3 · AI盒子 1/2 · 传感器 1/2',
    );
    expect(wrapper.get('[data-field="disease-warn-title"]').text()).toBe('病害预警');
    expect(wrapper.get('[data-field="disease-warn-config"]').text()).toBe('尚未配置病害比例/重度阈值');
    expect(wrapper.find('[data-field="disease-warn-ratio-note"]').exists()).toBe(false);
    expect(wrapper.find('[data-field="disease-warn-severe-note"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('在养蘑菇总数');
    expect(wrapper.text()).toContain('成熟可采摘总数');
    expect(wrapper.text()).toContain('待成熟数量');
    expect(wrapper.text()).toContain('今日识别次数');
    expect(wrapper.text()).toContain('今日抓拍总量');
    expect(wrapper.text()).toContain('当日病害总数');
    expect(wrapper.text()).toContain('棚区平面');
    expect(wrapper.text()).toContain('高温');
    expect(wrapper.text()).toContain('CAM-S01-01');
    expect(wrapper.find('.overview-chart').exists()).toBe(true);
    expect(wrapper.find('.overview-chart-empty').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('这一窗没有识别汇总');
    expect(wrapper.get('.tb-board').attributes('data-layout')).toBe('tb-ops');
    expect(wrapper.find('.tb-floor').exists()).toBe(true);
    expect(wrapper.find('.tb-alarms').exists()).toBe(true);
    expect(wrapper.find('.result-grid').exists()).toBe(false);
    expect(chartInit).toHaveBeenCalledTimes(1);
    expect(setOption).toHaveBeenCalledWith(
      expect.objectContaining({
        yAxis: expect.objectContaining({
          splitLine: { lineStyle: { color: tokens.grid } },
        }),
        series: [
          expect.objectContaining({ name: '成熟', data: [12], itemStyle: { color: tokens.accent } }),
          expect.objectContaining({ name: '总数', data: [40], itemStyle: { color: '#3B6EA5' } }),
          expect.objectContaining({ name: '病害', data: [2], itemStyle: { color: tokens.critical } }),
        ],
      }),
    );
    wrapper.unmount();
  });

  it('does not leave an empty chart box when the trend is empty', async () => {
    httpGet.mockResolvedValue({
      data: { ...overview, trend: [], recentAlerts: [], recentRecords: [] },
    });
    const wrapper = mount(DashboardView);
    await flushPromises();

    expect(wrapper.find('.overview-chart').exists()).toBe(false);
    expect(wrapper.find('.overview-chart-empty').exists()).toBe(true);
    expect(wrapper.find('.overview-chart-empty').classes()).not.toContain('h-72');
    expect(chartInit).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('暂无未关闭告警');
    expect(wrapper.text()).toContain('暂无识别记录');
    wrapper.unmount();
  });

  it('plots configured shed pins and temperature thresholds from alert rules', async () => {
    httpGet.mockImplementation((url: string) => {
      const path = String(url);
      if (path === '/dashboard/overview') return Promise.resolve({ data: overview });
      if (path === '/sheds') {
        return Promise.resolve({
          data: [
            { id: 'shed-1', code: 'S01', name: '一号棚', location: '东区', mapX: 32, mapY: 48 },
            { id: 'shed-2', code: 'S02', name: '二号棚', location: null, mapX: null, mapY: null },
          ],
        });
      }
      if (path.startsWith('/devices')) {
        return Promise.resolve({
          data: { items: [{ shedCode: 'S01', onlineStatus: 'online' }], total: 1 },
        });
      }
      if (path.startsWith('/harvest/daily')) {
        return Promise.resolve({
          data: { items: [{ shedCode: 'S01', matureCount: 4, mushroomCount: 10 }] },
        });
      }
      if (path.startsWith('/ingest/environment-readings')) {
        return Promise.resolve({
          data: {
            items: [
              {
                shedCode: 'S01',
                sensorCode: 'T1',
                observedAt: '2026-09-23T01:00:00.000Z',
                temperature: 22.4,
                humidity: 81,
              },
            ],
          },
        });
      }
      if (path === '/alert-rules') {
        return Promise.resolve({
          data: [
            {
              metric: 'temperature_high',
              threshold: 30,
              level: 'severe',
              enabled: true,
              name: '高温',
              shedCode: null,
            },
            {
              metric: 'disease_count',
              threshold: 3,
              level: 'warning',
              enabled: true,
              name: '病害',
              shedCode: null,
            },
          ],
        });
      }
      return Promise.resolve({ data: { items: [] } });
    });
    const wrapper = mount(DashboardView);
    await flushPromises();

    const pin = wrapper.get('.tb-pin');
    expect(pin.attributes('data-tone')).toBe('severe');
    expect(pin.text()).toContain('S01');
    expect(pin.find('.tb-plot').exists()).toBe(false);
    expect(wrapper.find('.tb-bays').exists()).toBe(false);
    expect(pin.attributes('style')).toContain('left: 32%');
    expect(pin.attributes('style')).toContain('top: 48%');
    expect(wrapper.text()).toContain('未标坐标');
    expect(wrapper.text()).toContain('S02');
    expect(wrapper.get('.tb-entities').text()).toContain('一号棚');
    expect(wrapper.get('.tb-entities').text()).toContain('22.4℃');
    expect(wrapper.get('.tb-entities').text()).toContain('1/1');
    expect(wrapper.find('.overview-temp').exists()).toBe(true);
    expect(chartInit).toHaveBeenCalledTimes(2);
    const tempCall = setOption.mock.calls.find((call) =>
      Array.isArray(call[0]?.series) &&
      call[0].series.some((item: { name?: string }) => item.name === 'S01'),
    );
    expect(tempCall).toBeTruthy();
    const marked = tempCall?.[0].series as { name: string; markLine?: { data: { yAxis: number }[] } }[];
    expect(marked.find((item) => item.name === 'S01')?.markLine?.data.map((item) => item.yAxis)).toEqual([30]);
    wrapper.unmount();
  });

  it('shows the request error without KPI tiles', async () => {
    httpGet.mockRejectedValue(new Error('down'));
    const wrapper = mount(DashboardView);
    await flushPromises();

    expect(wrapper.text()).toContain('请求失败');
    expect(wrapper.find('.kpi-tile').exists()).toBe(false);
    expect(wrapper.find('.overview-chart').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows the configured mature threshold and the pick reminder', async () => {
    currentUser.value = admin;
    httpGet.mockImplementation((url: string) => {
      if (url === '/dashboard/overview') {
        return Promise.resolve({
          data: {
            ...overview,
            maturePickRuleId: 'rule-pick',
            maturePickShedCode: null,
            maturePickThreshold: 8,
            maturePickMatureCount: 8,
            maturePickActive: true,
            maturePickNote: '采摘提醒 成熟≥8 当前8',
          },
        });
      }
      if (url === '/alert-rules') return Promise.resolve({ data: [] });
      if (url === '/sheds') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: { items: [] } });
    });
    const wrapper = mount(DashboardView);
    await flushPromises();

    expect(wrapper.get('[data-field="mature-pick-title"]').text()).toBe('采摘提醒');
    expect(wrapper.get('[data-field="mature-pick-threshold"]').element).toHaveProperty('value', '8');
    expect(wrapper.get('[data-field="mature-pick-config"]').text()).toBe(
      '成熟菇数量阈值 8 · 全场 · 当前成熟 8',
    );
    expect(wrapper.get('[data-field="mature-pick-note"]').text()).toBe('采摘提醒 成熟≥8 当前8');
    expect(wrapper.get('[data-field="live-mushroom-note"]').text()).toBe(
      '在养蘑菇总数 30 · 成熟可采摘总数 11 · 待成熟数量 19',
    );

    await wrapper.get('[data-field="mature-pick-threshold"]').setValue('12');
    await wrapper.get('form.mature-pick-form').trigger('submit');
    await flushPromises();

    expect(httpPatch).toHaveBeenCalledWith('/alert-rules/rule-pick', { threshold: 12, enabled: true });
    wrapper.unmount();
  });

  it('leaves the pick reminder unset when no rule is configured', async () => {
    httpGet.mockResolvedValue({ data: overview });
    const wrapper = mount(DashboardView);
    await flushPromises();

    expect(wrapper.get('[data-field="mature-pick-config"]').text()).toBe('尚未配置成熟菇数量阈值');
    expect(wrapper.find('[data-field="mature-pick-note"]').exists()).toBe(false);
    expect(wrapper.find('[data-field="mature-pick-save"]').exists()).toBe(false);
    expect(wrapper.get('[data-field="disease-warn-config"]').text()).toBe('尚未配置病害比例/重度阈值');
    expect(wrapper.find('[data-field="disease-warn-save"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows disease warnings when either threshold is met and saves both rules', async () => {
    currentUser.value = admin;
    httpGet.mockImplementation((url: string) => {
      if (url === '/dashboard/overview') {
        return Promise.resolve({
          data: {
            ...overview,
            diseaseWarnRatioRuleId: 'rule-ratio',
            diseaseWarnRatioShedCode: null,
            diseaseWarnRatioThreshold: 20,
            diseaseWarnRatioPercent: 20,
            diseaseWarnRatioActive: true,
            diseaseWarnRatioNote: '病害预警 比例≥20% 当前20%',
            diseaseWarnSevereRuleId: 'rule-severe',
            diseaseWarnSevereShedCode: null,
            diseaseWarnSevereThreshold: 4,
            diseaseWarnSevereCount: 4,
            diseaseWarnSevereActive: true,
            diseaseWarnSevereNote: '病害预警 重度≥4 当前4',
          },
        });
      }
      if (url === '/alert-rules') return Promise.resolve({ data: [] });
      if (url === '/sheds') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: { items: [] } });
    });
    httpPatch.mockResolvedValue({ data: {} });
    const wrapper = mount(DashboardView);
    await flushPromises();

    expect(wrapper.get('[data-field="disease-warn-config"]').text()).toBe(
      '病害比例阈值 20% · 全场 · 当前比例 20% · 重度病害数量阈值 4 · 全场 · 当前重度 4',
    );
    expect(wrapper.get('[data-field="disease-warn-ratio-note"]').text()).toBe('病害预警 比例≥20% 当前20%');
    expect(wrapper.get('[data-field="disease-warn-severe-note"]').text()).toBe('病害预警 重度≥4 当前4');
    expect(wrapper.get('[data-field="mature-pick-config"]').text()).toBe('尚未配置成熟菇数量阈值');
    expect(wrapper.get('[data-field="today-disease-note"]').text()).toBe('当日病害总数 5');
    expect(wrapper.get('[data-field="live-mushroom-note"]').text()).toBe(
      '在养蘑菇总数 30 · 成熟可采摘总数 11 · 待成熟数量 19',
    );

    await wrapper.get('[data-field="disease-warn-ratio"]').setValue('25');
    await wrapper.get('[data-field="disease-warn-severe"]').setValue('6');
    await wrapper.get('form.disease-warn-form').trigger('submit');
    await flushPromises();

    expect(httpPatch).toHaveBeenCalledWith('/alert-rules/rule-ratio', { threshold: 25, enabled: true });
    expect(httpPatch).toHaveBeenCalledWith('/alert-rules/rule-severe', { threshold: 6, enabled: true });
    wrapper.unmount();
  });
});
