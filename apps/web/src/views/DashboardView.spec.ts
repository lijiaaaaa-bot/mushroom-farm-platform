import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { farmOpsTokens as tokens } from '../farm-ops-tokens';
import DashboardView from './DashboardView.vue';

const httpGet = vi.hoisted(() => vi.fn());
const setOption = vi.hoisted(() => vi.fn());
const chartInit = vi.hoisted(() =>
  vi.fn(() => ({
    setOption,
    dispose: vi.fn(),
    resize: vi.fn(),
  })),
);

vi.mock('../api', () => ({
  http: { get: httpGet },
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

describe('DashboardView', () => {
  beforeEach(() => {
    httpGet.mockReset();
    setOption.mockReset();
    chartInit.mockClear();
  });

  it('draws series from overview trend and lists alerts plus recognitions', async () => {
    httpGet.mockResolvedValue({ data: overview });
    const wrapper = mount(DashboardView);
    await flushPromises();

    expect(httpGet).toHaveBeenCalledWith('/dashboard/overview');
    expect(wrapper.find('.kpi-tile').exists()).toBe(false);
    expect(wrapper.find('.tb-kpi-strip').exists()).toBe(false);
    expect(wrapper.text()).toContain('棚区平面');
    expect(wrapper.text()).toContain('221');
    expect(wrapper.text()).toContain('22.4℃');
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
    expect(pin.text()).toContain('22.4℃');
    expect(pin.attributes('style')).toContain('left: 32%');
    expect(pin.attributes('style')).toContain('top: 48%');
    expect(wrapper.text()).toContain('未标坐标');
    expect(wrapper.text()).toContain('S02');
    expect(wrapper.text()).toContain('一号棚');
    expect(wrapper.text()).toContain('1/1');
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
});
