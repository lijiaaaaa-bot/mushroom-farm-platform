import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EnvironmentView from './EnvironmentView.vue';

const httpGet = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: { get: httpGet },
  errorText: () => '请求失败',
}));

const reading = {
  id: 'env-1',
  shedCode: 'S01',
  sensorCode: 'SENSOR-S01',
  observedAt: '2026-09-23T01:30:00.000Z',
  temperature: 22.5,
  humidity: 88,
  co2: 900,
  substrateMoisture: 70,
  source: 'http',
};

const older = {
  ...reading,
  id: 'env-old',
  observedAt: '2026-09-23T01:28:00.000Z',
  temperature: 19.2,
  humidity: 91,
  co2: 1100,
  substrateMoisture: 64,
};

async function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: EnvironmentView },
      { path: '/environment/:id', component: { template: '<div />' } },
    ],
  });
  const wrapper = mount(EnvironmentView, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

describe('EnvironmentView', () => {
  beforeEach(() => {
    httpGet.mockReset();
  });

  it('renders recent readings from GET /ingest/environment-readings', async () => {
    httpGet.mockResolvedValue({ data: { items: [reading], total: 1 } });
    const wrapper = await mountView();

    expect(httpGet).toHaveBeenCalledWith('/ingest/environment-readings/latest');
    expect(httpGet).toHaveBeenCalledWith('/ingest/environment-readings?pageSize=50');
    expect(wrapper.text()).toContain('S01');
    expect(wrapper.text()).toContain('SENSOR-S01');
    expect(wrapper.text()).toContain('22.5℃');
    expect(wrapper.text()).toContain('88%');
    expect(wrapper.text()).not.toContain('暂无环境读数');
    wrapper.unmount();
  });

  it('shows the newest value in the latest table and keeps the older row in history', async () => {
    const latest = {
      ...reading,
      id: 'env-new',
      sensorCode: 'SENSOR-LATEST-01',
      temperature: 24.6,
      humidity: 85,
      co2: 760,
      substrateMoisture: 72,
    };
    httpGet.mockImplementation((url: string) => {
      if (url === '/ingest/environment-readings/latest') {
        return Promise.resolve({ data: { items: [latest], total: 1 } });
      }
      if (url === '/growth-trends/environment') {
        return Promise.resolve({ data: { points: [] } });
      }
      return Promise.resolve({ data: { items: [latest, older], total: 2 } });
    });
    const wrapper = await mountView();
    const latestTable = wrapper.get('[data-testid="env-latest"]');

    expect(latestTable.text()).toContain('24.6℃');
    expect(latestTable.text()).toContain('85%');
    expect(latestTable.text()).toContain('760');
    expect(latestTable.text()).toContain('72%');
    expect(latestTable.text()).not.toContain('19.2℃');
    expect(wrapper.get('[data-testid="env-latest-link"]').attributes('href')).toBe(
      '/environment/env-new',
    );
    expect(wrapper.text()).toContain('19.2℃');
    wrapper.unmount();
  });

  it('lists 24h means from hour buckets when the series has points', async () => {
    httpGet.mockImplementation((url: string) => {
      if (url === '/growth-trends/environment') {
        return Promise.resolve({
          data: {
            points: [
              {
                hour: '2026-09-24T03:00:00.000Z',
                temperature: 21,
                humidity: 80,
              },
            ],
          },
        });
      }
      return Promise.resolve({ data: { items: [reading], total: 1 } });
    });
    const wrapper = await mountView();
    expect(httpGet).toHaveBeenCalledWith('/growth-trends/environment', {
      params: { hours: 24 },
    });
    expect(wrapper.get('[data-testid="env-hours"]').text()).toContain('21℃');
    expect(wrapper.get('[data-testid="env-hours"]').text()).toContain('80%');
    wrapper.unmount();
  });

  it('shows empty copy when there are no readings', async () => {
    httpGet.mockResolvedValue({ data: { items: [], total: 0 } });
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('暂无环境读数。');
    expect(wrapper.find('table').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows error text without the empty table when the list fails', async () => {
    httpGet.mockRejectedValue(new Error('down'));
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('请求失败');
    expect(wrapper.text()).not.toContain('暂无环境读数');
    expect(wrapper.find('table').exists()).toBe(false);
    wrapper.unmount();
  });
});
