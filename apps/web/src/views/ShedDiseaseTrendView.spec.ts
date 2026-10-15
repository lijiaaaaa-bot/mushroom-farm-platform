import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ShedDiseaseTrendView from './ShedDiseaseTrendView.vue';

const httpGet = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: { get: httpGet },
  errorText: () => '请求失败',
}));

const sheds = [
  { code: 'S01', name: '一号棚' },
  { code: 'S02', name: '二号棚' },
];

function point(day: string, diseaseCount: number) {
  return { day, diseaseCount };
}

const cameraPoints = [
  point('2026-10-10', 1),
  point('2026-10-12', 3),
  point('2026-10-14', 6),
  point('2026-10-15', 10),
];

const series = {
  days: 7,
  from: '2026-10-09',
  to: '2026-10-15',
  diseaseCount: 'latest_per_camera',
  sheds: [
    {
      shedCode: 'S01',
      points: [point('2026-10-10', 9), point('2026-10-12', 9), point('2026-10-14', 9), point('2026-10-15', 12)],
      cameras: [{ cameraCode: 'CAM-SDT-01', points: cameraPoints }],
    },
  ],
};

function mockSeries(payload: unknown = series) {
  httpGet.mockImplementation((url: string) => {
    if (url === '/sheds') return Promise.resolve({ data: sheds });
    if (url === '/diseases/trends') return Promise.resolve({ data: payload });
    return Promise.resolve({ data: {} });
  });
}

async function mountView(query: Record<string, string> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/shed-disease-trend', component: ShedDiseaseTrendView }],
  });
  await router.push({ path: '/shed-disease-trend', query });
  const wrapper = mount(ShedDiseaseTrendView, { global: { plugins: [router] } });
  await flushPromises();
  await flushPromises();
  return { wrapper, router };
}

function lineYs(wrapper: ReturnType<typeof mount>) {
  const points = wrapper.get('[data-testid="disease-trend-chart"] polyline').attributes('points') ?? '';
  return points.split(' ').map((pair) => Number(pair.split(',')[1]));
}

describe('ShedDiseaseTrendView', () => {
  beforeEach(() => {
    httpGet.mockReset();
  });

  it('draws one camera disease counts and a rise from 1 to 10', async () => {
    mockSeries();
    const { wrapper } = await mountView({ days: '7', shedCode: 'S01', cameraCode: 'CAM-SDT-01' });

    expect(httpGet).toHaveBeenCalledWith('/diseases/trends', {
      params: { days: '7', shedCode: 'S01', cameraCode: 'CAM-SDT-01' },
    });
    expect(httpGet).not.toHaveBeenCalledWith('/diseases/peaks', expect.anything());
    expect(httpGet).not.toHaveBeenCalledWith('/growth-trends', expect.anything());
    expect(httpGet).not.toHaveBeenCalledWith('/diseases', expect.anything());
    expect(wrapper.get('[data-testid="disease-trend-scope"]').text()).toContain('棚区 S01 · 7 天');
    expect(wrapper.get('[data-testid="disease-trend-scope"]').text()).toContain('CAM-SDT-01');
    const note = wrapper.get('[data-testid="disease-trend-note"]').text();
    expect(note).toBe('病害 1 → 3 → 6 → 10（升）');
    const ys = lineYs(wrapper);
    expect(ys).toHaveLength(4);
    expect(ys[0]).toBeGreaterThan(ys[1]);
    expect(ys[1]).toBeGreaterThan(ys[2]);
    expect(ys[2]).toBeGreaterThan(ys[3]);
    const table = wrapper.get('[data-testid="disease-trend-table"]').text();
    expect(table).toContain('1');
    expect(table).toContain('3');
    expect(table).toContain('6');
    expect(table).toContain('10');
    expect(table).toContain('升 2');
    expect(table).toContain('升 3');
    expect(table).toContain('升 4');
    expect(wrapper.text()).not.toContain('高发时段');
    expect(wrapper.text()).not.toContain('温度');
    expect(wrapper.text()).not.toContain('蘑菇');
    wrapper.unmount();
  });

  it('writes a drop on the day the count falls', async () => {
    mockSeries({
      days: 7,
      sheds: [
        {
          shedCode: 'S01',
          points: [],
          cameras: [
            {
              cameraCode: 'CAM-SDT-01',
              points: [point('2026-10-12', 2), point('2026-10-14', 5), point('2026-10-15', 4)],
            },
          ],
        },
      ],
    });
    const { wrapper } = await mountView({ days: '7', shedCode: 'S01', cameraCode: 'CAM-SDT-01' });

    expect(wrapper.get('[data-testid="disease-trend-note"]').text()).toBe('病害 2 → 5 → 4（升）');
    const ys = lineYs(wrapper);
    expect(ys[1]).toBeLessThan(ys[0]);
    expect(ys[1]).toBeLessThan(ys[2]);
    expect(wrapper.get('[data-testid="disease-trend-table"]').text()).toContain('升 3');
    expect(wrapper.get('[data-testid="disease-trend-table"]').text()).toContain('降 1');
    wrapper.unmount();
  });

  it('uses the shed rollup when the address has no camera', async () => {
    mockSeries();
    const { wrapper, router } = await mountView();

    expect(router.currentRoute.value.query).toEqual({
      days: '7',
      shedCode: 'S01',
    });
    expect(httpGet).toHaveBeenCalledWith('/diseases/trends', {
      params: { days: '7', shedCode: 'S01' },
    });
    expect(wrapper.get('[data-testid="disease-trend-scope"]').text()).toContain('棚汇总');
    expect(wrapper.get('[data-testid="disease-trend-note"]').text()).toBe('病害 9 → 9 → 9 → 12（升）');
    wrapper.unmount();
  });

  it('reads a thirty-day window of the same camera', async () => {
    mockSeries({ ...series, days: 30 });
    const { wrapper } = await mountView({ days: '30', shedCode: 'S01', cameraCode: 'CAM-SDT-01' });

    expect(httpGet).toHaveBeenCalledWith('/diseases/trends', {
      params: { days: '30', shedCode: 'S01', cameraCode: 'CAM-SDT-01' },
    });
    expect(wrapper.get('[data-testid="disease-trend-scope"]').text()).toContain('30 天');
    expect(wrapper.get('[data-testid="disease-trend-note"]').text()).toBe('病害 1 → 3 → 6 → 10（升）');
    wrapper.unmount();
  });

  it('says the curve was not drawn when fewer than two days exist', async () => {
    mockSeries({
      days: 7,
      sheds: [
        {
          shedCode: 'S01',
          points: [point('2026-10-15', 10)],
          cameras: [{ cameraCode: 'CAM-SDT-01', points: [point('2026-10-15', 10)] }],
        },
      ],
    });
    const { wrapper } = await mountView({ days: '7', shedCode: 'S01', cameraCode: 'CAM-SDT-01' });

    expect(wrapper.get('[data-testid="disease-trend-empty"]').text()).toBe('没有病害日趋势，未绘制曲线。');
    expect(wrapper.find('[data-testid="disease-trend-chart"]').exists()).toBe(false);
    expect(wrapper.find('table').exists()).toBe(false);
    wrapper.unmount();
  });
});
