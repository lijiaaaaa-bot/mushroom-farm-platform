import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GrowthTrendsView from './GrowthTrendsView.vue';

const httpGet = vi.hoisted(() => vi.fn());
const setOption = vi.hoisted(() => vi.fn());
const init = vi.hoisted(() =>
  vi.fn(() => ({ setOption, dispose: vi.fn() })),
);

vi.mock('../api', () => ({
  http: { get: httpGet },
  errorText: () => '请求失败',
}));

vi.mock('echarts', () => ({
  init,
}));

const sheds = [{ code: 'S01', name: '一号棚' }];

const series = {
  days: 7,
  from: '2026-09-17',
  to: '2026-09-23',
  sheds: [
    {
      shedCode: 'S01',
      points: [
        {
          day: '2026-09-23',
          mushroomCount: 12,
          capDiameterMean: 5,
          sampleCount: 2,
        },
      ],
      cameras: [
        {
          cameraCode: 'CAM-1',
          points: [
            {
              day: '2026-09-23',
              mushroomCount: 12,
              capDiameterMean: 5,
              sampleCount: 2,
            },
          ],
        },
      ],
    },
  ],
};

const empty = {
  days: 7,
  from: '2026-09-17',
  to: '2026-09-23',
  sheds: [],
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
    routes: [{ path: '/growth-trends', component: GrowthTrendsView }],
  });
  await router.push({ path: '/growth-trends', query });
  const wrapper = mount(GrowthTrendsView, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

describe('GrowthTrendsView', () => {
  beforeEach(() => {
    httpGet.mockReset();
    init.mockClear();
    setOption.mockClear();
  });

  it('draws only the returned days', async () => {
    mockTrends();
    const wrapper = await mountView();

    expect(httpGet).toHaveBeenCalledWith('/growth-trends', {
      params: { days: 7, shedCode: 'S01' },
    });
    expect(wrapper.text()).toContain('12');
    expect(wrapper.text()).toContain('2026-09-23');
    expect(wrapper.text()).not.toContain('没有日聚合');
    expect(init).toHaveBeenCalled();
    const countOption = setOption.mock.calls[0][0] as {
      series: Array<{ data: Array<number | null> }>;
    };
    expect(countOption.series[0].data).toEqual([12]);
    wrapper.unmount();
  });

  it('shows an empty window without chart points', async () => {
    mockTrends(empty);
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('2026-09-17 至 2026-09-23 没有日聚合，未绘制曲线。');
    expect(wrapper.find('table').exists()).toBe(false);
    expect(init).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('shows the load error without an empty chart', async () => {
    httpGet.mockRejectedValue(new Error('down'));
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('请求失败');
    expect(wrapper.text()).not.toContain('没有日聚合');
    expect(wrapper.find('table').exists()).toBe(false);
    expect(init).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('requests 30 days from the window control', async () => {
    mockTrends();
    const wrapper = await mountView();
    await wrapper.get('[data-days="30"]').trigger('click');
    await flushPromises();

    expect(httpGet).toHaveBeenCalledWith('/growth-trends', {
      params: { days: 30, shedCode: 'S01' },
    });
    wrapper.unmount();
  });

  it('switches the table to per-camera points', async () => {
    mockTrends();
    const wrapper = await mountView();
    expect(wrapper.text()).toContain('S01');
    await wrapper.get('[data-mode="camera"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('CAM-1');
    wrapper.unmount();
  });

  it('opens on the shed, window, and camera named in the route', async () => {
    mockTrends();
    const wrapper = await mountView({ days: '30', shedCode: 'S01', cameraCode: 'CAM-1' });

    expect(httpGet).toHaveBeenCalledWith('/growth-trends', {
      params: { days: 30, shedCode: 'S01' },
    });
    expect(wrapper.text()).toContain('摄像头 CAM-1');
    expect(wrapper.text()).toContain('CAM-1');
    expect(wrapper.text()).not.toContain('没有日聚合');
    wrapper.unmount();
  });

  it('states that there is no authorized shed', async () => {
    httpGet.mockImplementation((url: string) => {
      if (url === '/sheds') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: empty });
    });
    const wrapper = await mountView();
    expect(wrapper.text()).toContain('没有可查看的棚区。');
    expect(init).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
