import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UsersView from './UsersView.vue';

const httpGet = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: { get: httpGet },
  errorText: () => '请求失败',
}));

describe('UsersView', () => {
  beforeEach(() => {
    httpGet.mockReset();
  });

  it('lists accounts from GET /users without a password column', async () => {
    httpGet.mockResolvedValue({
      data: [
        {
          id: 'user-admin',
          username: 'admin',
          displayName: '系统管理员',
          role: 'super_admin',
          shedCodes: [],
          enabled: true,
        },
        {
          id: 'user-viewer',
          username: 'viewer',
          displayName: '只读查看',
          role: 'viewer',
          shedCodes: ['S01'],
          enabled: true,
        },
      ],
    });

    const wrapper = mount(UsersView);
    await flushPromises();

    expect(httpGet).toHaveBeenCalledWith('/users');
    expect(wrapper.text()).toContain('admin');
    expect(wrapper.text()).toContain('系统管理员');
    expect(wrapper.text()).toContain('超管');
    expect(wrapper.text()).toContain('全场');
    expect(wrapper.text()).toContain('viewer');
    expect(wrapper.text()).toContain('查看');
    expect(wrapper.text()).toContain('S01');
    expect(wrapper.text()).not.toContain('password');
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
});
