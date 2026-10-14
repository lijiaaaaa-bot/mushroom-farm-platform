import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { currentUser, type SessionUser } from '../auth';
import AlertDetailView from './AlertDetailView.vue';

const httpGet = vi.hoisted(() => vi.fn());
const httpPost = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: { get: httpGet, post: httpPost },
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

function asUser(role: SessionUser['role']) {
  currentUser.value = {
    id: 'user-1',
    username: role === 'shed_manager' ? 'shed-a' : role,
    displayName: role,
    role,
    shedCodes: ['S01'],
  };
}

describe('AlertDetailView', () => {
  beforeEach(() => {
    localStorage.clear();
    httpGet.mockReset();
    httpPost.mockReset();
    currentUser.value = null;
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
    expect(wrapper.find('[data-testid="alert-actions"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('confirms a pending alert and still shows 已确认 after refresh', async () => {
    asUser('shed_manager');
    httpGet.mockResolvedValueOnce({ data: alert });
    const wrapper = await mountDetail();

    expect(wrapper.get('[data-field="status"]').text()).toBe('待确认');
    expect(wrapper.get('[data-testid="alert-ack"]').text()).toBe('确认');
    const acked = { ...alert, status: 'acked' as const, ackNote: '已确认' };
    httpPost.mockResolvedValue({ data: acked });
    httpGet.mockResolvedValueOnce({ data: acked });
    await wrapper.get('[data-testid="alert-ack"]').trigger('click');
    await flushPromises();

    expect(httpPost).toHaveBeenCalledWith('/alerts/alert-1/ack', { note: '已确认' });
    expect(httpGet).toHaveBeenLastCalledWith('/alerts/alert-1');
    expect(wrapper.get('[data-field="status"]').text()).toBe('已确认');
    expect(wrapper.get('[data-field="ackNote"]').text()).toBe('已确认');
    expect(wrapper.find('[data-testid="alert-ack"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="alert-close"]').text()).toBe('关闭');
    wrapper.unmount();

    httpGet.mockResolvedValue({ data: acked });
    const refreshed = await mountDetail();
    expect(refreshed.get('[data-field="status"]').text()).toBe('已确认');
    expect(refreshed.get('[data-field="ackNote"]').text()).toBe('已确认');
    expect(refreshed.find('[data-testid="alert-ack"]').exists()).toBe(false);
    refreshed.unmount();
  });

  it('closes a pending alert and still shows 已关闭 after refresh', async () => {
    asUser('production_admin');
    httpGet.mockResolvedValueOnce({ data: alert });
    const wrapper = await mountDetail();
    const closed = {
      ...alert,
      status: 'closed' as const,
      closeReason: 'resolved' as const,
      closeNote: '已关闭',
      ackNote: '关闭时自动确认',
    };
    httpPost.mockResolvedValue({ data: closed });
    httpGet.mockResolvedValueOnce({ data: closed });
    await wrapper.get('[data-testid="alert-close"]').trigger('click');
    await flushPromises();

    expect(httpPost).toHaveBeenCalledWith('/alerts/alert-1/close', { note: '已关闭' });
    expect(wrapper.get('[data-field="status"]').text()).toBe('已关闭');
    expect(wrapper.get('[data-field="closeReason"]').text()).toBe('正常关闭');
    expect(wrapper.get('[data-field="closeNote"]').text()).toBe('已关闭');
    expect(wrapper.find('[data-testid="alert-actions"]').exists()).toBe(false);
    wrapper.unmount();

    httpGet.mockResolvedValue({ data: closed });
    const refreshed = await mountDetail();
    expect(refreshed.get('[data-field="status"]').text()).toBe('已关闭');
    expect(refreshed.get('[data-field="closeReason"]').text()).toBe('正常关闭');
    expect(refreshed.find('[data-testid="alert-ack"]').exists()).toBe(false);
    expect(refreshed.find('[data-testid="alert-close"]').exists()).toBe(false);
    refreshed.unmount();
  });

  it('keeps the pending alert on screen when confirm fails', async () => {
    asUser('shed_manager');
    httpGet.mockResolvedValue({ data: alert });
    httpPost.mockRejectedValue(new Error('down'));
    const wrapper = await mountDetail();
    const reads = httpGet.mock.calls.length;

    await wrapper.get('[data-testid="alert-ack"]').trigger('click');
    await flushPromises();

    expect(httpGet.mock.calls.length).toBe(reads);
    expect(wrapper.get('[data-testid="alert-action-error"]').text()).toBe('请求失败');
    expect(wrapper.get('[data-field="status"]').text()).toBe('待确认');
    expect(wrapper.get('[data-testid="alert-ack"]').text()).toBe('确认');
    wrapper.unmount();
  });

  it('hides confirm and close for a viewer', async () => {
    asUser('viewer');
    httpGet.mockResolvedValue({ data: alert });
    const wrapper = await mountDetail();

    expect(wrapper.get('[data-field="status"]').text()).toBe('待确认');
    expect(wrapper.find('[data-testid="alert-actions"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="alert-ack"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="alert-close"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
