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
    expect(wrapper.findAll('.kpi-tile')).toHaveLength(8);
    expect(wrapper.text()).toContain('棚区');
    expect(wrapper.text()).toContain('221');
    expect(wrapper.text()).toContain('22.4℃');
    expect(wrapper.text()).toContain('高温');
    expect(wrapper.text()).toContain('CAM-S01-01');
    expect(wrapper.find('.overview-chart').exists()).toBe(true);
    expect(wrapper.find('.overview-chart-empty').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('这一窗没有识别汇总');
    expect(chartInit).toHaveBeenCalledTimes(1);
    expect(setOption).toHaveBeenCalledWith(
      expect.objectContaining({
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
