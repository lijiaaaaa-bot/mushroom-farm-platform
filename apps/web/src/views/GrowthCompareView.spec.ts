import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GrowthCompareView from './GrowthCompareView.vue';

const httpGet = vi.hoisted(() => vi.fn());
const setOption = vi.hoisted(() => vi.fn());
const init = vi.hoisted(() => vi.fn(() => ({ setOption, dispose: vi.fn() })));

vi.mock('../api', () => ({
  http: { get: httpGet },
  errorText: () => '请求失败',
}));

vi.mock('echarts', () => ({
  init,
}));

const sheds = [
  { code: 'S01', name: '一号菇棚' },
  { code: 'S02', name: '二号菇棚' },
];

function point(
  day: string,
  mushroomCount: number,
  matureCount: number,
  capDiameterMean: number,
) {
  return { day, mushroomCount, matureCount, capDiameterMean, sampleCount: 1 };
}

const series = {
  days: 7,
  from: '2026-10-09',
  to: '2026-10-15',
  sheds: [
    {
      shedCode: 'S01',
      points: [point('2026-10-10', 8, 2, 3.2), point('2026-10-15', 21, 8, 4.8)],
      cameras: [
        {
          cameraCode: 'CAM-SG-S01',
          points: [point('2026-10-10', 8, 2, 3.2), point('2026-10-15', 21, 8, 4.8)],
        },
      ],
    },
    {
      shedCode: 'S02',
      points: [point('2026-10-10', 3, 1, 2.1), point('2026-10-15', 8, 3, 3.1)],
      cameras: [
        {
          cameraCode: 'CAM-SG-S02',
          points: [point('2026-10-10', 3, 1, 2.1), point('2026-10-15', 8, 3, 3.1)],
        },
      ],
    },
  ],
};

function mockTrends(payload: unknown = series) {
  httpGet.mockImplementation((url: string) => {
    if (url === '/sheds') return Promise.resolve({ data: sheds });
    return Promise.resolve({ data: payload });
  });
}

async function mountView(query: Record<string, string> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/growth-compare', component: GrowthCompareView }],
  });
  await router.push({ path: '/growth-compare', query });
  const wrapper = mount(GrowthCompareView, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

describe('GrowthCompareView', () => {
  beforeEach(() => {
    httpGet.mockReset();
    init.mockClear();
    setOption.mockClear();
  });

  it('draws one series per shed and shows the mushroom gap on one screen', async () => {
    mockTrends();
    const wrapper = await mountView();

    expect(httpGet).toHaveBeenCalledWith('/growth-trends', { params: { days: 7 } });
    const trendCall = httpGet.mock.calls.find((call) => call[0] === '/growth-trends');
    expect(trendCall?.[1].params.shedCode).toBeUndefined();
    expect(wrapper.text()).toContain('棚间对比 · 7 天');
    expect(wrapper.findAll('[data-compare-shed]')).toHaveLength(2);
    expect(wrapper.text()).toContain('S01');
    expect(wrapper.text()).toContain('S02');
    expect(wrapper.text()).toContain('CAM-SG-S01 蘑菇 21');
    expect(wrapper.text()).toContain('CAM-SG-S02 蘑菇 8');
    expect(wrapper.get('[data-compare-gap]').text()).toContain('S01 蘑菇 21');
    expect(wrapper.get('[data-compare-gap]').text()).toContain('S02 蘑菇 8');
    expect(wrapper.text()).not.toContain('没有日聚合');
    const mushrooms = wrapper.findAll('[data-mushroom]').map((node) => node.text());
    expect(mushrooms).toEqual(['21', '8']);
    const countOption = setOption.mock.calls[0][0] as {
      series: Array<{ name: string; data: Array<number | null> }>;
    };
    expect(countOption.series.map((item) => item.name)).toEqual(['S01', 'S02']);
    expect(countOption.series[0].data).toEqual([8, 21]);
    expect(countOption.series[1].data).toEqual([3, 8]);
    const seriesData = setOption.mock.calls.map(
      (call) => (call[0] as { series: Array<{ data: number[] }> }).series.map((item) => item.data),
    );
    expect(seriesData).toContainEqual([
      [2, 8],
      [1, 3],
    ]);
    expect(seriesData).toContainEqual([
      [3.2, 4.8],
      [2.1, 3.1],
    ]);
    wrapper.unmount();
  });

  it('requests 30 days without a single shed filter', async () => {
    mockTrends();
    const wrapper = await mountView();
    await wrapper.get('[data-days="30"]').trigger('click');
    await flushPromises();
    expect(httpGet).toHaveBeenCalledWith('/growth-trends', { params: { days: 30 } });
    expect(wrapper.text()).toContain('棚间对比 · 30 天');
    wrapper.unmount();
  });

  it('states that one shed is not a comparison', async () => {
    mockTrends({
      days: 7,
      from: '2026-10-09',
      to: '2026-10-15',
      sheds: [series.sheds[0]],
    });
    const wrapper = await mountView();
    expect(wrapper.text()).toContain('同屏棚数 1，至少要两个棚才能对照。');
    expect(wrapper.find('[data-compare-board]').exists()).toBe(false);
    expect(init).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('shows an empty window without chart points', async () => {
    mockTrends({ days: 7, from: '2026-10-09', to: '2026-10-15', sheds: [] });
    const wrapper = await mountView();
    expect(wrapper.text()).toContain('2026-10-09 至 2026-10-15 没有日聚合，未绘制曲线。');
    expect(wrapper.find('table').exists()).toBe(false);
    expect(init).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('shows the load error without an empty chart', async () => {
    httpGet.mockRejectedValue(new Error('down'));
    const wrapper = await mountView();
    expect(wrapper.text()).toContain('请求失败');
    expect(wrapper.text()).not.toContain('没有日聚合');
    expect(init).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
