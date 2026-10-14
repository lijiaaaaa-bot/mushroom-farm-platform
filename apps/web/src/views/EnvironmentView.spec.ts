import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EnvironmentView from './EnvironmentView.vue';

const httpGet = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: { get: httpGet },
  errorText: (error: unknown) =>
    error instanceof Error && error.message === '时间筛选无效' ? error.message : '请求失败',
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

async function mountView(query?: Record<string, string>) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: EnvironmentView },
      { path: '/environment/:id', component: { template: '<div />' } },
    ],
  });
  if (query) await router.push({ path: '/', query });
  const wrapper = mount(EnvironmentView, { global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router };
}

describe('EnvironmentView', () => {
  beforeEach(() => {
    httpGet.mockReset();
  });

  it('renders recent readings from GET /ingest/environment-readings', async () => {
    httpGet.mockResolvedValue({ data: { items: [reading], total: 1 } });
    const { wrapper } = await mountView();

    expect(httpGet).toHaveBeenCalledWith('/ingest/environment-readings/latest');
    expect(httpGet).toHaveBeenCalledWith('/ingest/environment-readings', {
      params: { pageSize: '50' },
    });
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
    const { wrapper } = await mountView();
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
    const { wrapper } = await mountView();
    expect(httpGet).toHaveBeenCalledWith('/growth-trends/environment', {
      params: { hours: 24 },
    });
    expect(wrapper.get('[data-testid="env-hours"]').text()).toContain('21℃');
    expect(wrapper.get('[data-testid="env-hours"]').text()).toContain('80%');
    wrapper.unmount();
  });

  it('shows empty copy when there are no readings', async () => {
    httpGet.mockResolvedValue({ data: { items: [], total: 0 } });
    const { wrapper } = await mountView();

    expect(wrapper.text()).toContain('暂无环境读数。');
    expect(wrapper.find('table').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows error text without the empty table when the list fails', async () => {
    httpGet.mockRejectedValue(new Error('down'));
    const { wrapper } = await mountView();

    expect(wrapper.text()).toContain('请求失败');
    expect(wrapper.text()).not.toContain('暂无环境读数');
    expect(wrapper.find('table').exists()).toBe(false);
    wrapper.unmount();
  });

  it('loads history for one sensor and a time window from the address', async () => {
    const newer = {
      ...reading,
      id: 'env-new',
      sensorCode: 'SENSOR-HIST-01',
      observedAt: '2026-10-14T01:30:00.000Z',
      temperature: 23.1,
      humidity: 80,
      co2: 740,
      substrateMoisture: 71,
    };
    const earlier = {
      ...newer,
      id: 'env-old',
      observedAt: '2026-10-14T01:22:00.000Z',
      temperature: 18.4,
      humidity: 86,
      co2: 820,
      substrateMoisture: 66,
    };
    httpGet.mockImplementation((url: string) => {
      if (url === '/ingest/environment-readings/latest') {
        return Promise.resolve({ data: { items: [newer], total: 1 } });
      }
      if (url === '/growth-trends/environment') {
        return Promise.resolve({ data: { points: [] } });
      }
      return Promise.resolve({ data: { items: [newer, earlier], total: 2 } });
    });
    const { wrapper } = await mountView({
      sensorCode: 'SENSOR-HIST-01',
      from: '2026-10-14T01:00:00.000Z',
      to: '2026-10-14T01:40:00.000Z',
    });
    const history = wrapper.get('[data-testid="env-history"]');

    expect(httpGet).toHaveBeenCalledWith('/ingest/environment-readings', {
      params: {
        pageSize: '50',
        sensorCode: 'SENSOR-HIST-01',
        from: '2026-10-14T01:00:00.000Z',
        to: '2026-10-14T01:40:00.000Z',
      },
    });
    expect(history.text()).toContain('23.1℃');
    expect(history.text()).toContain('18.4℃');
    expect(history.text()).toContain('SENSOR-HIST-01');
    expect(wrapper.get('[data-testid="env-history-scope"]').text()).toContain('SENSOR-HIST-01');
    expect(wrapper.get('[data-testid="env-history-scope"]').text()).toContain('至');
    expect(wrapper.get('[data-testid="env-history-count"]').text()).toBe('2');
    expect(wrapper.text()).toContain('开始时间');
    expect(wrapper.text()).toContain('结束时间');
    expect(wrapper.text()).toContain('共');
    expect(wrapper.get('[data-testid="env-latest"]').text()).not.toContain('18.4℃');
    wrapper.unmount();
  });

  it('queries history by the sensor and the typed time range', async () => {
    httpGet.mockResolvedValue({ data: { items: [reading], total: 1 } });
    const { wrapper, router } = await mountView();
    await wrapper.get('[data-testid="env-history-sensor"]').setValue('SENSOR-HIST-01');
    await wrapper.get('[data-testid="env-history-from"]').setValue('2026-10-14T09:00');
    await wrapper.get('[data-testid="env-history-to"]').setValue('2026-10-14T10:00');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(router.currentRoute.value.query.sensorCode).toBe('SENSOR-HIST-01');
    expect(router.currentRoute.value.query.from).toBe(new Date('2026-10-14T09:00').toISOString());
    expect(router.currentRoute.value.query.to).toBe(new Date('2026-10-14T10:00').toISOString());
    expect(httpGet).toHaveBeenCalledWith('/ingest/environment-readings', {
      params: {
        pageSize: '50',
        sensorCode: 'SENSOR-HIST-01',
        from: new Date('2026-10-14T09:00').toISOString(),
        to: new Date('2026-10-14T10:00').toISOString(),
      },
    });
    wrapper.unmount();
  });

  it('clears the history filter and loads the recent list again', async () => {
    httpGet.mockResolvedValue({ data: { items: [reading], total: 1 } });
    const { wrapper, router } = await mountView({ sensorCode: 'SENSOR-HIST-01' });
    await wrapper.get('[data-testid="env-history-clear"]').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.query.sensorCode).toBeUndefined();
    const historyCalls = httpGet.mock.calls.filter((call) => call[0] === '/ingest/environment-readings');
    expect(historyCalls[historyCalls.length - 1]?.[1]).toEqual({ params: { pageSize: '50' } });
    wrapper.unmount();
  });

  it('shows invalid time copy and does not request history', async () => {
    httpGet.mockResolvedValue({ data: { items: [reading], total: 1 } });
    const { wrapper } = await mountView({ from: 'not-a-date' });

    expect(wrapper.get('[data-testid="env-history-time-error"]').text()).toBe('时间筛选无效');
    expect(wrapper.text()).not.toContain('没有符合条件的环境读数');
    expect(wrapper.text()).not.toContain('暂无环境读数');
    expect(wrapper.find('[data-testid="env-history"]').exists()).toBe(false);
    expect(httpGet).toHaveBeenCalledWith('/ingest/environment-readings/latest');
    expect(httpGet).not.toHaveBeenCalledWith(
      '/ingest/environment-readings',
      expect.anything(),
    );
    wrapper.unmount();
  });

  it('shows invalid time when the start is after the end', async () => {
    httpGet.mockResolvedValue({ data: { items: [reading], total: 1 } });
    const { wrapper } = await mountView({
      sensorCode: 'SENSOR-ENVF-01',
      from: '2026-10-14T02:00:00.000Z',
      to: '2026-10-14T01:00:00.000Z',
    });

    expect(wrapper.get('[data-testid="env-history-time-error"]').text()).toBe('时间筛选无效');
    expect(wrapper.text()).not.toContain('没有符合条件的环境读数');
    expect(wrapper.find('[data-testid="env-history"]').exists()).toBe(false);
    expect(httpGet).not.toHaveBeenCalledWith(
      '/ingest/environment-readings',
      expect.anything(),
    );
    wrapper.unmount();
  });

  it('shows the filtered empty copy and a zero count', async () => {
    httpGet.mockImplementation((url: string) => {
      if (url === '/ingest/environment-readings/latest') {
        return Promise.resolve({ data: { items: [], total: 0 } });
      }
      if (url === '/growth-trends/environment') {
        return Promise.resolve({ data: { points: [] } });
      }
      return Promise.resolve({ data: { items: [], total: 0 } });
    });
    const { wrapper } = await mountView({
      sensorCode: 'SENSOR-ENVF-01',
      from: '2000-01-01T00:00:00.000Z',
      to: '2000-01-01T00:01:00.000Z',
    });

    expect(wrapper.get('[data-testid="env-history-empty"]').text()).toBe('没有符合条件的环境读数。');
    expect(wrapper.get('[data-testid="env-history-count"]').text()).toBe('0');
    expect(wrapper.get('[data-testid="env-history-scope"]').text()).toContain('时间');
    expect(wrapper.get('[data-testid="env-history-scope"]').text()).toContain('至');
    expect(wrapper.text()).not.toContain('暂无环境读数');
    wrapper.unmount();
  });

  it('shows the api time error instead of the empty history table', async () => {
    httpGet.mockImplementation((url: string) => {
      if (url === '/ingest/environment-readings/latest') {
        return Promise.resolve({ data: { items: [reading], total: 1 } });
      }
      if (url === '/growth-trends/environment') {
        return Promise.resolve({ data: { points: [] } });
      }
      return Promise.reject(new Error('时间筛选无效'));
    });
    const { wrapper } = await mountView({
      from: '2026-10-14T01:00:00.000Z',
      to: '2026-10-14T02:00:00.000Z',
    });

    expect(wrapper.get('[data-testid="env-history-time-error"]').text()).toBe('时间筛选无效');
    expect(wrapper.find('[data-testid="env-history"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('没有符合条件的环境读数');
    expect(wrapper.text()).not.toContain('暂无环境读数');
    wrapper.unmount();
  });
});
