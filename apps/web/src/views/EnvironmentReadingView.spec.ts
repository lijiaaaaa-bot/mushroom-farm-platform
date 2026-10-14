import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EnvironmentReadingView from './EnvironmentReadingView.vue';

const httpGet = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: { get: httpGet },
  errorText: () => '请求失败',
}));

const reading = {
  id: 'env-new',
  shedCode: 'S01',
  sensorCode: 'SENSOR-LATEST-01',
  observedAt: '2026-10-14T01:02:03.004Z',
  temperature: 24.6,
  humidity: 85,
  co2: 760,
  substrateMoisture: 72,
  source: 'http',
};

async function mountDetail(id = 'env-new') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/environment/:id', component: EnvironmentReadingView },
      { path: '/environment', component: { template: '<div />' } },
    ],
  });
  await router.push(`/environment/${id}`);
  await router.isReady();
  const wrapper = mount(EnvironmentReadingView, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

describe('EnvironmentReadingView', () => {
  beforeEach(() => {
    httpGet.mockReset();
  });

  it('shows the latest reading from GET /ingest/environment-readings/:id', async () => {
    httpGet.mockResolvedValue({ data: reading });
    const wrapper = await mountDetail();

    expect(httpGet).toHaveBeenCalledWith('/ingest/environment-readings/env-new');
    expect(wrapper.get('[data-testid="env-back"]').attributes('href')).toBe('/environment');
    expect(wrapper.get('[data-field="shed"]').text()).toBe('S01');
    expect(wrapper.get('[data-field="sensor"]').text()).toBe('SENSOR-LATEST-01');
    expect(wrapper.get('[data-field="temperature"]').text()).toBe('24.6℃');
    expect(wrapper.get('[data-field="humidity"]').text()).toBe('85%');
    expect(wrapper.get('[data-field="co2"]').text()).toBe('760');
    expect(wrapper.get('[data-field="moisture"]').text()).toBe('72%');
    expect(wrapper.get('[data-field="source"]').text()).toBe('http');
    wrapper.unmount();
  });

  it('shows the error and not the detail when the reading cannot be loaded', async () => {
    httpGet.mockRejectedValue(new Error('down'));
    const wrapper = await mountDetail();

    expect(wrapper.get('[data-testid="env-detail-error"]').text()).toBe('请求失败');
    expect(wrapper.find('[data-testid="env-detail"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
