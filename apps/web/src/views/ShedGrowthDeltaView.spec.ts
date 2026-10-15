import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ShedGrowthDeltaView from './ShedGrowthDeltaView.vue';

const httpGet = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: { get: httpGet },
  errorText: () => '请求失败',
}));

const sheds = [
  { code: 'S01', name: '一号棚' },
  { code: 'S02', name: '二号棚' },
];

function point(day: string, mushroomCount: number, matureCount: number) {
  return {
    day,
    mushroomCount,
    matureCount,
    maturityRate: 20,
    capDiameterMean: 4.2,
    sampleCount: 1,
  };
}

const cameraPoints = [
  point('2026-10-10', 10, 2),
  point('2026-10-12', 16, 4),
  point('2026-10-14', 24, 7),
  point('2026-10-15', 34, 11),
];

const series = {
  days: 7,
  grain: 'day',
  from: '2026-10-09',
  to: '2026-10-15',
  sheds: [
    {
      shedCode: 'S01',
      points: [point('2026-10-10', 40, 9), point('2026-10-12', 41, 10), point('2026-10-14', 42, 11)],
      cameras: [{ cameraCode: 'CAM-GD-01', points: cameraPoints }],
    },
  ],
};

function mockSeries(payload: unknown = series) {
  httpGet.mockImplementation((url: string) => {
    if (url === '/sheds') return Promise.resolve({ data: sheds });
    if (url === '/growth-trends') return Promise.resolve({ data: payload });
    return Promise.resolve({ data: {} });
  });
}

async function mountView(query: Record<string, string> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/shed-growth-delta', component: ShedGrowthDeltaView }],
  });
  await router.push({ path: '/shed-growth-delta', query });
  const wrapper = mount(ShedGrowthDeltaView, { global: { plugins: [router] } });
  await flushPromises();
  await flushPromises();
  return { wrapper, router };
}

function lineYs(wrapper: ReturnType<typeof mount>, testId: string) {
  const points = wrapper.get(`[data-testid="${testId}"] polyline`).attributes('points') ?? '';
  return points.split(' ').map((pair) => Number(pair.split(',')[1]));
}

describe('ShedGrowthDeltaView', () => {
  beforeEach(() => {
    httpGet.mockReset();
  });

  it('draws one shed camera day deltas and a rise from 6 to 8', async () => {
    mockSeries();
    const { wrapper } = await mountView({ days: '7', shedCode: 'S01', cameraCode: 'CAM-GD-01' });

    expect(httpGet).toHaveBeenCalledWith('/growth-trends', {
      params: { days: 7, shedCode: 'S01', cameraCode: 'CAM-GD-01' },
    });
    expect(httpGet).not.toHaveBeenCalledWith('/growth-trends/environment', expect.anything());
    expect(httpGet).not.toHaveBeenCalledWith('/growth-trends/hours', expect.anything());
    expect(wrapper.get('[data-testid="growth-delta-scope"]').text()).toContain('棚区 S01 · 7 天');
    expect(wrapper.get('[data-testid="growth-delta-scope"]').text()).toContain('CAM-GD-01');
    const note = wrapper.get('[data-testid="growth-delta-note"]').text();
    expect(note).toContain('蘑菇增量 6 → 8 → 10（升）');
    expect(note).toContain('成熟增量 2 → 3 → 4（升）');
    const mushroom = lineYs(wrapper, 'growth-delta-chart-mushroom');
    const mature = lineYs(wrapper, 'growth-delta-chart-mature');
    expect(mushroom).toHaveLength(3);
    expect(mature).toHaveLength(3);
    expect(mushroom[0]).toBeGreaterThan(mushroom[1]);
    expect(mushroom[1]).toBeGreaterThan(mushroom[2]);
    expect(wrapper.get('[data-testid="growth-delta-table"]').text()).toContain('+6');
    expect(wrapper.get('[data-testid="growth-delta-table"]').text()).toContain('+8');
    expect(wrapper.get('[data-testid="growth-delta-table"]').text()).toContain('+10');
    expect(wrapper.get('[data-testid="growth-delta-table"]').text()).toContain('升 2');
    expect(wrapper.text()).not.toContain('蘑菇数量');
    expect(wrapper.text()).not.toContain('成熟率');
    expect(wrapper.text()).not.toContain('菌盖');
    expect(wrapper.text()).not.toContain('温度');
    wrapper.unmount();
  });

  it('plots the increment dip instead of the rising absolute counts', async () => {
    mockSeries({
      days: 7,
      sheds: [
        {
          shedCode: 'S01',
          points: [],
          cameras: [
            {
              cameraCode: 'CAM-GD-01',
              points: [
                point('2026-10-10', 10, 2),
                point('2026-10-12', 16, 4),
                point('2026-10-14', 20, 5),
                point('2026-10-15', 30, 8),
              ],
            },
          ],
        },
      ],
    });
    const { wrapper } = await mountView({ days: '7', shedCode: 'S01', cameraCode: 'CAM-GD-01' });

    expect(wrapper.get('[data-testid="growth-delta-note"]').text()).toContain('蘑菇增量 6 → 4 → 10（升）');
    const mushroom = lineYs(wrapper, 'growth-delta-chart-mushroom');
    expect(mushroom).toHaveLength(3);
    expect(mushroom[1]).toBeGreaterThan(mushroom[0]);
    expect(mushroom[1]).toBeGreaterThan(mushroom[2]);
    expect(wrapper.get('[data-testid="growth-delta-table"]').text()).toContain('降 2');
    expect(wrapper.get('[data-testid="growth-delta-table"]').text()).toContain('升 6');
    wrapper.unmount();
  });

  it('fills the shed, camera, and seven-day window when the address omits them', async () => {
    mockSeries();
    const { wrapper, router } = await mountView();

    expect(router.currentRoute.value.query).toEqual({
      days: '7',
      shedCode: 'S01',
      cameraCode: 'CAM-GD-01',
    });
    expect(httpGet).toHaveBeenCalledWith('/growth-trends', {
      params: { days: 7, shedCode: 'S01', cameraCode: 'CAM-GD-01' },
    });
    expect(wrapper.get('[data-testid="growth-delta-note"]').text()).toContain('蘑菇增量 6 → 8 → 10（升）');
    wrapper.unmount();
  });

  it('reads a thirty-day window of the same camera', async () => {
    mockSeries({ ...series, days: 30 });
    const { wrapper } = await mountView({ days: '30', shedCode: 'S01', cameraCode: 'CAM-GD-01' });

    expect(httpGet).toHaveBeenCalledWith('/growth-trends', {
      params: { days: 30, shedCode: 'S01', cameraCode: 'CAM-GD-01' },
    });
    expect(wrapper.get('[data-testid="growth-delta-scope"]').text()).toContain('30 天');
    expect(wrapper.get('[data-testid="growth-delta-note"]').text()).toContain('6 → 8 → 10（升）');
    wrapper.unmount();
  });

  it('says the curve was not drawn when adjacent increments are missing', async () => {
    mockSeries({
      days: 7,
      sheds: [
        {
          shedCode: 'S01',
          points: [point('2026-10-15', 34, 11)],
          cameras: [{ cameraCode: 'CAM-GD-01', points: [point('2026-10-15', 34, 11)] }],
        },
      ],
    });
    const { wrapper } = await mountView({ days: '7', shedCode: 'S01', cameraCode: 'CAM-GD-01' });

    expect(wrapper.get('[data-testid="growth-delta-empty"]').text()).toBe('没有相邻日增量，未绘制曲线。');
    expect(wrapper.find('[data-testid="growth-delta-chart-mushroom"]').exists()).toBe(false);
    expect(wrapper.find('table').exists()).toBe(false);
    wrapper.unmount();
  });
});
