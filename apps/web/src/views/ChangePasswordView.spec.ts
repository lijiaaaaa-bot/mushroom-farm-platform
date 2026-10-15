import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { currentUser } from '../auth';
import ChangePasswordView from './ChangePasswordView.vue';

const httpPost = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: { post: httpPost },
  errorText: (cause: unknown) =>
    cause instanceof Error && cause.message !== '403' ? cause.message : '请求失败',
}));

describe('ChangePasswordView', () => {
  beforeEach(() => {
    httpPost.mockReset();
    currentUser.value = {
      id: 'user-self',
      username: 'pwd-self-demo',
      displayName: '改密演示',
      role: 'viewer',
      shedCodes: ['S01'],
    };
  });

  it('shows the current account and posts only the two password fields', async () => {
    httpPost.mockResolvedValue({ data: { username: 'pwd-self-demo', changed: true } });
    const wrapper = mount(ChangePasswordView);

    expect(wrapper.get('[data-testid="password-self-account"]').text()).toContain('pwd-self-demo');
    expect(wrapper.get('[data-testid="password-self-account"]').text()).toContain('查看');
    expect(wrapper.get('[data-testid="password-self-contrast"]').text()).toContain('旧密码不能登录');
    expect(wrapper.get('[data-testid="password-self-contrast"]').text()).toContain('新密码可以登录');
    expect(wrapper.get('[data-testid="password-self-current"]').attributes('type')).toBe('password');
    expect(wrapper.get('[data-testid="password-self-new"]').attributes('type')).toBe('password');
    expect(wrapper.get('[data-testid="password-self-confirm"]').attributes('type')).toBe('password');

    await wrapper.get('[data-testid="password-self-current"]').setValue('PwdOld@123456');
    await wrapper.get('[data-testid="password-self-new"]').setValue('PwdNew@123456');
    await wrapper.get('[data-testid="password-self-confirm"]').setValue('PwdNew@123456');
    await wrapper.get('[data-testid="password-self-form"]').trigger('submit');
    await flushPromises();

    expect(httpPost).toHaveBeenCalledWith('/auth/change-password', {
      currentPassword: 'PwdOld@123456',
      newPassword: 'PwdNew@123456',
    });
    expect(wrapper.get('[data-testid="password-self-result"]').text()).toContain('旧密码：不能登录');
    expect(wrapper.get('[data-testid="password-self-result"]').text()).toContain('新密码：可以登录');
    expect(wrapper.text()).not.toContain('PwdNew@123456');
    wrapper.unmount();
  });

  it('keeps a mismatched confirmation off the API', async () => {
    const wrapper = mount(ChangePasswordView);
    await wrapper.get('[data-testid="password-self-current"]').setValue('PwdOld@123456');
    await wrapper.get('[data-testid="password-self-new"]').setValue('PwdNew@123456');
    await wrapper.get('[data-testid="password-self-confirm"]').setValue('Other@123456');
    await wrapper.get('[data-testid="password-self-form"]').trigger('submit');
    await flushPromises();

    expect(httpPost).not.toHaveBeenCalled();
    expect(wrapper.get('[data-testid="password-self-error"]').text()).toContain('两次新密码不一致');
    expect(wrapper.find('[data-testid="password-self-result"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows the API error and stays on the page', async () => {
    httpPost.mockRejectedValue(new Error('当前密码不正确'));
    const wrapper = mount(ChangePasswordView);
    await wrapper.get('[data-testid="password-self-current"]').setValue('Wrong@123456');
    await wrapper.get('[data-testid="password-self-new"]').setValue('PwdNew@123456');
    await wrapper.get('[data-testid="password-self-confirm"]').setValue('PwdNew@123456');
    await wrapper.get('[data-testid="password-self-form"]').trigger('submit');
    await flushPromises();

    expect(wrapper.get('[data-testid="password-self-error"]').text()).toContain('当前密码不正确');
    expect(wrapper.find('[data-testid="password-self-result"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
