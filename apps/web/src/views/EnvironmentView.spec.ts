import { flushPromises, mount } from '@vue/test-utils';
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
  source: 'http',
};

async function mountView() {
  const wrapper = mount(EnvironmentView);
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

    expect(httpGet).toHaveBeenCalledWith('/ingest/environment-readings?pageSize=50');
    expect(wrapper.text()).toContain('S01');
    expect(wrapper.text()).toContain('SENSOR-S01');
    expect(wrapper.text()).toContain('22.5℃');
    expect(wrapper.text()).toContain('88%');
    expect(wrapper.text()).not.toContain('暂无环境读数');
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
