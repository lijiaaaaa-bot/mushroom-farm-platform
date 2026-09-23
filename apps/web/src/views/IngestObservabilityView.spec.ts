import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import IngestObservabilityView from './IngestObservabilityView.vue';

const httpGet = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: { get: httpGet },
  errorText: () => '请求失败',
}));

const summary = {
  windowMinutes: 60,
  from: '2026-09-23T10:40:00.000Z',
  accepted: 4,
  rejected: 1,
  latencyP50Ms: 120,
  latencyLatestMs: 80,
  channels: [
    {
      channel: 'recognition',
      transport: 'http',
      accepted: 2,
      rejected: 0,
      latencyP50Ms: 100,
      latencyLatestMs: 80,
    },
    {
      channel: 'recognition',
      transport: 'mqtt',
      accepted: 1,
      rejected: 1,
      latencyP50Ms: 50,
      latencyLatestMs: 50,
    },
    {
      channel: 'environment',
      transport: 'http',
      accepted: 1,
      rejected: 0,
      latencyP50Ms: 40,
      latencyLatestMs: 40,
    },
    {
      channel: 'environment',
      transport: 'mqtt',
      accepted: 0,
      rejected: 0,
      latencyP50Ms: null,
      latencyLatestMs: null,
    },
    {
      channel: 'heartbeat',
      transport: 'http',
      accepted: 0,
      rejected: 0,
      latencyP50Ms: null,
      latencyLatestMs: null,
    },
    {
      channel: 'heartbeat',
      transport: 'mqtt',
      accepted: 0,
      rejected: 0,
      latencyP50Ms: null,
      latencyLatestMs: null,
    },
  ],
  recentErrors: [
    {
      id: 'err-1',
      channel: 'recognition',
      transport: 'mqtt',
      shedCode: 'S01',
      code: 'UNKNOWN_FIELD',
      errors: ['未知字段 unexpectedSensor'],
      createdAt: '2026-09-23T11:00:00.000Z',
    },
  ],
};

async function mountView() {
  const wrapper = mount(IngestObservabilityView);
  await flushPromises();
  return wrapper;
}

describe('IngestObservabilityView', () => {
  beforeEach(() => {
    httpGet.mockReset();
  });

  it('renders accepted, rejected, and recent errors', async () => {
    httpGet.mockResolvedValue({ data: summary });
    const wrapper = await mountView();

    expect(httpGet).toHaveBeenCalledWith('/ingest/observability');
    expect(wrapper.text()).toContain('近 60 分钟接收');
    expect(wrapper.text()).toContain('4');
    expect(wrapper.text()).toContain('近 60 分钟拒收');
    expect(wrapper.text()).toContain('1');
    expect(wrapper.text()).toContain('识别 HTTP');
    expect(wrapper.text()).toContain('识别 MQTT');
    expect(wrapper.text()).toContain('环境 HTTP');
    expect(wrapper.text()).toContain('心跳 HTTP');
    expect(wrapper.text()).toContain('未知字段 unexpectedSensor');
    expect(wrapper.text()).toContain('S01');
    expect(wrapper.text()).not.toContain('近窗没有拒收');
    expect(wrapper.html()).toContain('text-accent');
    expect(wrapper.html()).toContain('bg-canvas');
    wrapper.unmount();
  });

  it('shows empty copy without an error table when nothing was rejected', async () => {
    httpGet.mockResolvedValue({
      data: { ...summary, rejected: 0, recentErrors: [] },
    });
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('近窗没有拒收。');
    expect(wrapper.get('[data-test="recent-errors"]').find('table').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows the load error and does not render an empty table', async () => {
    httpGet.mockRejectedValue(new Error('down'));
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('请求失败');
    expect(wrapper.text()).not.toContain('近窗没有拒收');
    expect(wrapper.find('table').exists()).toBe(false);
    expect(wrapper.find('[data-test="recent-errors"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
