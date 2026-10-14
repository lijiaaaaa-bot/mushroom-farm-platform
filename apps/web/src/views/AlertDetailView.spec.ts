import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AlertDetailView from './AlertDetailView.vue';

const httpGet = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: { get: httpGet },
  errorText: () => '请求失败',
}));

const alert = {
  id: 'alert-1',
  shedCode: 'S01',
  cameraCode: 'CAM-ALERT-01',
  level: 'severe',
  status: 'open',
  title: '温度过高告警',
  message: '棚区 S01 摄像头 CAM-ALERT-01 温度过高 30，阈值 28',
  metric: 'temperature_high',
  metricValue: 30,
  threshold: 28,
  createdAt: '2026-09-23T01:02:00.000Z',
  claimedBy: null,
  claimNote: null,
  ackNote: null,
  closeReason: null,
  closeNote: null,
};

async function mountDetail(id = 'alert-1') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/alerts/:id', component: AlertDetailView },
      { path: '/alerts', component: { template: '<div />' } },
    ],
  });
  await router.push(`/alerts/${id}`);
  await router.isReady();
  const wrapper = mount(AlertDetailView, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

describe('AlertDetailView', () => {
  beforeEach(() => {
    httpGet.mockReset();
  });

  it('shows the fields a duty person reads from GET /alerts/:id', async () => {
    httpGet.mockResolvedValue({ data: alert });
    const wrapper = await mountDetail();

    expect(httpGet).toHaveBeenCalledWith('/alerts/alert-1');
    expect(wrapper.get('[data-testid="alert-back"]').attributes('href')).toBe('/alerts');
    expect(wrapper.get('[data-field="title"]').text()).toBe('温度过高告警');
    expect(wrapper.get('[data-field="message"]').text()).toContain('温度过高 30');
    expect(wrapper.get('[data-field="level"]').text()).toBe('严重');
    expect(wrapper.get('[data-field="status"]').text()).toBe('待确认');
    expect(wrapper.get('[data-field="shed"]').text()).toBe('S01');
    expect(wrapper.get('[data-field="camera"]').text()).toBe('CAM-ALERT-01');
    expect(wrapper.get('[data-field="time"]').text()).toBe('2026-09-23 09:02');
    expect(wrapper.get('[data-field="metric"]').text()).toBe('温度过高');
    expect(wrapper.get('[data-field="value"]').text()).toBe('30℃');
    expect(wrapper.get('[data-field="threshold"]').text()).toBe('28℃');
    expect(wrapper.get('[data-field="claimedBy"]').text()).toBe('—');
    expect(wrapper.get('[data-field="closeReason"]').text()).toBe('—');
    expect(wrapper.text()).not.toContain('暂无告警');
    wrapper.unmount();
  });

  it('shows the error and no detail card when the alert cannot be loaded', async () => {
    httpGet.mockRejectedValue(new Error('down'));
    const wrapper = await mountDetail();

    expect(wrapper.get('[data-testid="alert-detail-error"]').text()).toBe('请求失败');
    expect(wrapper.find('[data-testid="alert-detail"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('温度过高告警');
    wrapper.unmount();
  });

  it('leaves metric, value, and threshold blank when the alert was entered by hand', async () => {
    httpGet.mockResolvedValue({
      data: {
        ...alert,
        metric: null,
        metricValue: null,
        threshold: null,
        title: '人工抽查',
        message: '请到棚里看一下',
        closeReason: 'false_positive',
        closeNote: '现场无异常',
        claimedBy: 'shed-a',
      },
    });
    const wrapper = await mountDetail();

    expect(wrapper.get('[data-field="metric"]').text()).toBe('—');
    expect(wrapper.get('[data-field="value"]').text()).toBe('—');
    expect(wrapper.get('[data-field="threshold"]').text()).toBe('—');
    expect(wrapper.get('[data-field="closeReason"]').text()).toBe('误报');
    expect(wrapper.get('[data-field="closeNote"]').text()).toBe('现场无异常');
    expect(wrapper.get('[data-field="claimedBy"]').text()).toBe('shed-a');
    wrapper.unmount();
  });
});
