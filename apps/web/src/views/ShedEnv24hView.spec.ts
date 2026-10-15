import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ShedEnv24hView from './ShedEnv24hView.vue';

const httpGet = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: { get: httpGet },
  errorText: () => '请求失败',
}));

const sheds = [{ code: 'S01', name: '一号棚' }, { code: 'S02', name: '二号棚' }];

const series = {
  hours: 24,
  from: '2026-10-14T10:00:00.000Z',
  to: '2026-10-15T09:00:00.000Z',
  sensorCode: 'SENSOR-ENV24-01',
  points: [],
  sheds: [
    {
      shedCode: 'S01',
      points: [
        {
          hour: '2026-10-14T10:00:00.000Z',
          temperature: 22,
          humidity: 78,
          co2: 620,
          substrateMoisture: 68,
        },
        {
          hour: '2026-10-14T16:00:00.000Z',
          temperature: 24,
          humidity: 84,
          co2: 760,
          substrateMoisture: 72,
        },
        {
          hour: '2026-10-14T22:00:00.000Z',
          temperature: 25,
          humidity: 88,
          co2: 880,
          substrateMoisture: 75,
        },
        {
          hour: '2026-10-15T04:00:00.000Z',
          temperature: 26,
          humidity: 92,
          co2: 980,
          substrateMoisture: 78,
        },
      ],
    },
  ],
};

function mockSeries(payload: unknown = series) {
  httpGet.mockImplementation((url: string) => {
    if (url === '/sheds') return Promise.resolve({ data: sheds });
    if (url === '/growth-trends/environment') return Promise.resolve({ data: payload });
    return Promise.resolve({ data: {} });
  });
}

async function mountView(query: Record<string, string> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/shed-env-24h', component: ShedEnv24hView }],
  });
  await router.push({ path: '/shed-env-24h', query });
  const wrapper = mount(ShedEnv24hView, { global: { plugins: [router] } });
  await flushPromises();
  await flushPromises();
  return { wrapper, router };
}

function lineYs(wrapper: ReturnType<typeof mount>, testId: string) {
  const points = wrapper.get(`[data-testid="${testId}"] polyline`).attributes('points') ?? '';
  return points.split(' ').map((pair) => Number(pair.split(',')[1]));
}

describe('ShedEnv24hView', () => {
  beforeEach(() => {
    httpGet.mockReset();
  });

  it('draws four 24h curves and a temperature rise for one shed sensor', async () => {
    mockSeries();
    const { wrapper } = await mountView({ shedCode: 'S01', sensorCode: 'SENSOR-ENV24-01' });

    expect(httpGet).toHaveBeenCalledWith('/growth-trends/environment', {
      params: { hours: 24, shedCode: 'S01', sensorCode: 'SENSOR-ENV24-01' },
    });
    expect(httpGet).not.toHaveBeenCalledWith('/ingest/environment-readings', expect.anything());
    expect(wrapper.get('[data-testid="env24-scope"]').text()).toContain('棚区 S01 · 24 小时');
    expect(wrapper.get('[data-testid="env24-scope"]').text()).toContain('SENSOR-ENV24-01');
    const delta = wrapper.get('[data-testid="env24-delta"]').text();
    expect(delta).toContain('温度 22℃ → 26℃（升 4）');
    expect(delta).toContain('湿度 78% → 92%（升 14）');
    expect(delta).toContain('CO₂ 620 → 980（升 360）');
    expect(delta).toContain('基质含水率 68% → 78%（升 10）');
    const temperature = lineYs(wrapper, 'env24-chart-temperature');
    const humidity = lineYs(wrapper, 'env24-chart-humidity');
    expect(temperature.length).toBeGreaterThanOrEqual(2);
    expect(humidity.length).toBeGreaterThanOrEqual(2);
    expect(temperature[0]).toBeGreaterThan(temperature[temperature.length - 1]);
    expect(humidity[0]).toBeGreaterThan(humidity[humidity.length - 1]);
    expect(wrapper.find('[data-testid="env24-chart-co2"] polyline').exists()).toBe(true);
    expect(wrapper.find('[data-testid="env24-chart-moisture"] polyline').exists()).toBe(true);
    expect(wrapper.get('[data-testid="env24-table"]').text()).toContain('升 2');
    expect(wrapper.text()).not.toContain('历史读数');
    expect(wrapper.text()).not.toContain('共 4 条');
    wrapper.unmount();
  });

  it('fills the shed and sensor when the address omits them', async () => {
    mockSeries();
    const { wrapper, router } = await mountView();

    expect(router.currentRoute.value.query).toEqual({
      shedCode: 'S01',
      sensorCode: 'SENSOR-ENV24-01',
    });
    expect(httpGet).toHaveBeenCalledWith('/growth-trends/environment', {
      params: { hours: 24, shedCode: 'S01', sensorCode: 'SENSOR-ENV24-01' },
    });
    expect(wrapper.get('[data-testid="env24-delta"]').text()).toContain('升 4');
    wrapper.unmount();
  });

  it('says the curve was not drawn when the hour buckets are empty', async () => {
    mockSeries({ hours: 24, sensorCode: 'SENSOR-ENV24-01', points: [], sheds: [] });
    const { wrapper } = await mountView({ shedCode: 'S01', sensorCode: 'SENSOR-ENV24-01' });

    expect(wrapper.get('[data-testid="env24-empty"]').text()).toBe('近 24 小时没有小时桶，未绘制曲线。');
    expect(wrapper.find('[data-testid="env24-chart-temperature"]').exists()).toBe(false);
    expect(wrapper.find('table').exists()).toBe(false);
    wrapper.unmount();
  });
});
