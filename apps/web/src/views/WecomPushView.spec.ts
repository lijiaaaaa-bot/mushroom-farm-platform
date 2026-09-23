import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WecomPushView from './WecomPushView.vue';

const httpGet = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: { get: httpGet },
  errorText: () => '请求失败',
}));

describe('WecomPushView', () => {
  beforeEach(() => {
    httpGet.mockReset();
  });

  it('shows which channels are enabled and how to set the webhook env', async () => {
    httpGet.mockResolvedValue({
      data: { wecomEnabled: false, dingtalkEnabled: true },
    });
    const wrapper = mount(WecomPushView);
    await flushPromises();

    expect(httpGet).toHaveBeenCalledWith('/alerts/push-channels');
    expect(wrapper.text()).toContain('企微 未启用');
    expect(wrapper.text()).toContain('钉钉 已启用');
    expect(wrapper.text()).toContain('WECOM_WEBHOOK_URL');
    expect(wrapper.text()).toContain('DINGTALK_WEBHOOK_URL');
    expect(wrapper.text()).toContain('DINGTALK_WEBHOOK_SECRET');
    expect(wrapper.text()).toContain('认领');
    expect(wrapper.find('.ops-page').exists()).toBe(true);
    wrapper.unmount();
  });

  it('shows the request error and does not present channels as loaded', async () => {
    httpGet.mockRejectedValue(new Error('down'));
    const wrapper = mount(WecomPushView);
    await flushPromises();

    expect(wrapper.text()).toContain('请求失败');
    expect(wrapper.text()).not.toContain('未启用');
    expect(wrapper.text()).not.toContain('已启用');
    expect(wrapper.text()).toContain('WECOM_WEBHOOK_URL');
    wrapper.unmount();
  });
});
