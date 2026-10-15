import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SystemParamsView from './SystemParamsView.vue';

const httpGet = vi.hoisted(() => vi.fn());
const httpPatch = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: { get: httpGet, patch: httpPatch },
  errorText: (cause: unknown) =>
    cause instanceof Error && cause.message !== '403' ? cause.message : '请求失败',
}));

const current = {
  imageRetentionDays: 30,
  timeseriesRetentionDays: 90,
  alertUnreadPollSeconds: 15,
  updatedAt: null,
  updatedBy: null,
};

const saved = {
  ...current,
  alertUnreadPollSeconds: 45,
  updatedAt: '2026-10-15T03:00:00.000Z',
  updatedBy: 'admin',
  changes: [
    {
      key: 'alertUnreadPollSeconds' as const,
      label: '告警未读轮询',
      beforeText: '15 秒',
      afterText: '45 秒',
    },
  ],
};

describe('SystemParamsView', () => {
  beforeEach(() => {
    httpGet.mockReset();
    httpPatch.mockReset();
  });

  it('shows the current retention days and unread poll', async () => {
    httpGet.mockResolvedValue({ data: current });
    const wrapper = mount(SystemParamsView);
    await flushPromises();

    expect(httpGet).toHaveBeenCalledWith('/system-params');
    expect(wrapper.text()).toContain('系统参数');
    expect(wrapper.get('[data-field="imageRetentionDays"]').text()).toContain('当前 30 天');
    expect(wrapper.get('[data-field="timeseriesRetentionDays"]').text()).toContain('当前 90 天');
    expect(wrapper.get('[data-field="alertUnreadPollSeconds"]').attributes('data-current')).toBe('15');
    expect(wrapper.get('[data-field="alertUnreadPollSeconds"]').text()).toContain('当前 15 秒');
    expect(wrapper.find('[data-testid="sys-params-notice"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows the request error instead of the default numbers', async () => {
    httpGet.mockRejectedValue(new Error('403'));
    const wrapper = mount(SystemParamsView);
    await flushPromises();
    expect(wrapper.text()).toContain('请求失败');
    expect(wrapper.text()).not.toContain('当前 30 天');
    expect(wrapper.find('[data-field="imageRetentionDays"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('writes 15 秒 → 45 秒 after saving the unread poll', async () => {
    httpGet.mockResolvedValue({ data: current });
    httpPatch.mockResolvedValue({ data: saved });
    const wrapper = mount(SystemParamsView);
    await flushPromises();

    await wrapper.get('[aria-label="告警未读轮询"]').setValue(45);
    await wrapper.get('[data-testid="sys-params-save"]').trigger('click');
    await flushPromises();

    expect(httpPatch).toHaveBeenCalledWith('/system-params', { alertUnreadPollSeconds: 45 });
    expect(wrapper.get('[data-testid="sys-params-notice"]').text()).toBe('告警未读轮询：15 秒 → 45 秒');
    expect(wrapper.get('[data-field="alertUnreadPollSeconds"]').attributes('data-current')).toBe('45');
    expect(wrapper.get('[data-field="alertUnreadPollSeconds"]').text()).toContain('当前 45 秒');
    expect(wrapper.get('[data-field="alertUnreadPollSeconds"]').attributes('data-highlight')).toBe('true');
    expect(wrapper.get('[data-field="imageRetentionDays"]').text()).toContain('当前 30 天');
    expect(wrapper.get('[data-field="timeseriesRetentionDays"]').text()).toContain('当前 90 天');
    wrapper.unmount();
  });
});
