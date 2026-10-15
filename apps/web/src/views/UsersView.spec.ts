import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UsersView from './UsersView.vue';

const httpGet = vi.hoisted(() => vi.fn());
const httpPost = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: { get: httpGet, post: httpPost },
  errorText: (cause: unknown) =>
    cause instanceof Error && cause.message !== '403' ? cause.message : '请求失败',
}));

const admin = {
  id: 'user-admin',
  username: 'admin',
  displayName: '系统管理员',
  role: 'super_admin' as const,
  shedCodes: [] as string[],
  enabled: true,
};

const viewer = {
  id: 'user-viewer',
  username: 'viewer',
  displayName: '只读查看',
  role: 'viewer' as const,
  shedCodes: ['S01'],
  enabled: true,
};

describe('UsersView', () => {
  beforeEach(() => {
    httpGet.mockReset();
    httpPost.mockReset();
  });

  it('lists accounts from GET /users without a password column', async () => {
    httpGet.mockResolvedValue({ data: [admin, viewer] });

    const wrapper = mount(UsersView);
    await flushPromises();

    expect(httpGet).toHaveBeenCalledWith('/users');
    expect(wrapper.text()).toContain('新建用户');
    expect(wrapper.text()).toContain('admin');
    expect(wrapper.text()).toContain('系统管理员');
    expect(wrapper.text()).toContain('超管');
    expect(wrapper.text()).toContain('全场');
    expect(wrapper.text()).toContain('viewer');
    expect(wrapper.text()).toContain('查看');
    expect(wrapper.text()).toContain('S01');
    expect(wrapper.text()).toContain('重设密码');
    expect(wrapper.text()).not.toContain('password');
    expect(wrapper.text()).not.toContain('Admin@123456');
    wrapper.unmount();
  });

  it('shows the request error instead of an empty table', async () => {
    httpGet.mockRejectedValue(new Error('403'));
    const wrapper = mount(UsersView);
    await flushPromises();
    expect(wrapper.text()).toContain('请求失败');
    expect(wrapper.find('table').exists()).toBe(false);
    wrapper.unmount();
  });

  it('creates a user with the POST fields and shows the new row without the password', async () => {
    const created = {
      id: 'user-new',
      username: 'user-create-demo',
      displayName: '新建演示',
      role: 'viewer' as const,
      shedCodes: ['S01', 'S02'],
      enabled: true,
    };
    httpGet.mockResolvedValueOnce({ data: [admin] }).mockResolvedValue({ data: [admin, created] });
    httpPost.mockResolvedValue({
      data: {
        id: created.id,
        username: created.username,
        displayName: created.displayName,
        role: created.role,
        shedCodes: created.shedCodes,
      },
    });

    const wrapper = mount(UsersView);
    await flushPromises();

    await wrapper.get('input[aria-label="用户名"]').setValue('user-create-demo');
    await wrapper.get('input[aria-label="密码"]').setValue('Create@123456');
    await wrapper.get('input[aria-label="显示名"]').setValue('新建演示');
    await wrapper.get('select[aria-label="角色"]').setValue('viewer');
    await wrapper.get('input[aria-label="棚号"]').setValue('S01、S02');
    await wrapper.get('[data-testid="user-create-form"]').trigger('submit');
    await flushPromises();

    expect(httpPost).toHaveBeenCalledWith('/users', {
      username: 'user-create-demo',
      password: 'Create@123456',
      displayName: '新建演示',
      role: 'viewer',
      shedCodes: ['S01', 'S02'],
    });
    expect(httpPost.mock.calls[0][1]).not.toHaveProperty('resetPassword');
    expect(wrapper.text()).toContain('user-create-demo');
    expect(wrapper.text()).toContain('新建演示');
    expect(wrapper.text()).toContain('S01、S02');
    expect(wrapper.text()).not.toContain('Create@123456');
    expect((wrapper.get('input[aria-label="密码"]').element as HTMLInputElement).value).toBe('');
    expect(wrapper.get('[data-testid="user-notice"]').text()).toContain('已新建 user-create-demo');
    expect(wrapper.get('[data-testid="user-notice"]').text()).toContain('没有密码');
    expect(wrapper.get('tr[data-user-id="user-new"]').attributes('data-highlight')).toBe('true');
    wrapper.unmount();
  });

  it('shows 用户名已存在 and keeps the list when create conflicts', async () => {
    httpGet.mockResolvedValue({ data: [viewer] });
    httpPost.mockRejectedValue(new Error('用户名已存在'));
    const wrapper = mount(UsersView);
    await flushPromises();

    await wrapper.get('input[aria-label="用户名"]').setValue('viewer');
    await wrapper.get('input[aria-label="密码"]').setValue('Other@123456');
    await wrapper.get('input[aria-label="显示名"]').setValue('另一个');
    await wrapper.get('[data-testid="user-create-form"]').trigger('submit');
    await flushPromises();

    expect(httpPost).toHaveBeenCalledTimes(1);
    expect(httpPost.mock.calls[0][1]).not.toHaveProperty('resetPassword');
    expect(wrapper.get('[data-testid="user-action-error"]').text()).toBe('用户名已存在');
    expect(wrapper.text()).toContain('viewer');
    expect(wrapper.find('[data-testid="user-notice"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('resets an existing row with resetPassword and keeps that row without the new password', async () => {
    const updated = {
      ...viewer,
      displayName: '改名查看',
      role: 'shed_manager' as const,
      shedCodes: ['S03'],
    };
    httpGet.mockResolvedValueOnce({ data: [viewer] }).mockResolvedValue({ data: [updated] });
    httpPost.mockResolvedValue({
      data: {
        id: updated.id,
        username: updated.username,
        displayName: updated.displayName,
        role: updated.role,
        shedCodes: updated.shedCodes,
      },
    });

    const wrapper = mount(UsersView);
    await flushPromises();

    await wrapper.get('button[aria-label="viewer 重设密码"]').trigger('click');
    await wrapper.get('input[aria-label="新密码"]').setValue('ResetNew@123456');
    await wrapper.get('input[aria-label="重设显示名"]').setValue('改名查看');
    await wrapper.get('select[aria-label="重设角色"]').setValue('shed_manager');
    await wrapper.get('input[aria-label="重设棚号"]').setValue('S03');
    await wrapper.get('[data-testid="user-reset-form"]').trigger('submit');
    await flushPromises();

    expect(httpPost).toHaveBeenCalledWith('/users', {
      username: 'viewer',
      password: 'ResetNew@123456',
      displayName: '改名查看',
      role: 'shed_manager',
      shedCodes: ['S03'],
      resetPassword: true,
    });
    expect(wrapper.text()).toContain('viewer');
    expect(wrapper.text()).toContain('改名查看');
    expect(wrapper.text()).toContain('棚区负责人');
    expect(wrapper.text()).toContain('S03');
    expect(wrapper.text()).not.toContain('ResetNew@123456');
    expect(wrapper.get('[data-testid="user-notice"]').text()).toContain('已重设 viewer 的密码');
    expect(wrapper.get('[data-testid="user-notice"]').text()).toContain('仍有这一行');
    expect(wrapper.get('tr[data-user-id="user-viewer"]').attributes('data-highlight')).toBe('true');
    expect(wrapper.find('[data-testid="user-reset-form"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
