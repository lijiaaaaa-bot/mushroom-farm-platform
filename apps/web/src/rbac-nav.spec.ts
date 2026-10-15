import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@mushroom/contracts';

vi.mock('./api', () => ({
  http: {
    get: vi.fn().mockResolvedValue({ data: { unreadCount: 0, items: [] } }),
    post: vi.fn(),
  },
  errorText: () => '请求失败',
}));

import { currentUser, type SessionUser } from './auth';
import AdminLayout from './layouts/AdminLayout.vue';
import { navRoles, visibleNav } from './nav';
import router from './router';

function asUser(role: Role): SessionUser {
  return {
    id: `id-${role}`,
    username: role === 'super_admin' ? 'admin' : role,
    displayName: role,
    role,
    shedCodes: role === 'super_admin' || role === 'production_admin' ? [] : ['S01'],
  };
}

function storeUser(role: Role) {
  const user = asUser(role);
  localStorage.setItem('token', 'test-token');
  localStorage.setItem('user', JSON.stringify(user));
  currentUser.value = user;
}

describe('role menus', () => {
  beforeEach(async () => {
    localStorage.clear();
    currentUser.value = null;
    await router.push('/login');
    await router.isReady();
  });

  it('gives 审计 to super admin and production admin, and 用户 only to super admin', () => {
    expect(navRoles('/audit')).toEqual(['super_admin', 'production_admin']);
    expect(navRoles('/users')).toEqual(['super_admin']);
    expect(navRoles('/backup')).toEqual(['super_admin']);
    expect(navRoles('/system-params')).toEqual(['super_admin']);
    expect(router.getRoutes().find((record) => record.path === '/audit')?.meta.roles).toEqual(
      navRoles('/audit'),
    );
    expect(router.getRoutes().find((record) => record.path === '/users')?.meta.roles).toEqual(
      navRoles('/users'),
    );
    expect(router.getRoutes().find((record) => record.path === '/backup')?.meta.roles).toEqual(
      navRoles('/backup'),
    );
    expect(router.getRoutes().find((record) => record.path === '/system-params')?.meta.roles).toEqual(
      navRoles('/system-params'),
    );

    const admin = visibleNav('super_admin').map((link) => link.label);
    const producer = visibleNav('production_admin').map((link) => link.label);
    const shed = visibleNav('shed_manager').map((link) => link.label);
    const viewer = visibleNav('viewer').map((link) => link.label);

    expect(admin).toContain('审计');
    expect(admin).toContain('用户');
    expect(admin).toContain('数据备份');
    expect(admin).toContain('系统参数');
    expect(producer).toContain('审计');
    expect(producer).not.toContain('用户');
    expect(producer).not.toContain('数据备份');
    expect(producer).not.toContain('系统参数');
    expect(shed).not.toContain('审计');
    expect(shed).not.toContain('用户');
    expect(shed).not.toContain('数据备份');
    expect(shed).not.toContain('系统参数');
    expect(viewer).not.toContain('审计');
    expect(viewer).not.toContain('用户');
    expect(viewer).not.toContain('数据备份');
    expect(viewer).not.toContain('系统参数');
    expect(navRoles('/account/password')).toBeUndefined();
    for (const label of ['总览', '基地大屏', '值班看板', '设备', '告警', '棚区', '修改密码']) {
      expect(viewer).toContain(label);
      expect(admin).toContain(label);
    }
  });

  it('hides 审计 and 用户 in the sidebar for 查看', async () => {
    storeUser('viewer');
    await router.push('/');
    await flushPromises();

    const wrapper = mount(AdminLayout, { global: { plugins: [router] } });
    const labels = wrapper.get('nav').findAll('a').map((anchor) => anchor.text());
    expect(labels).not.toContain('审计');
    expect(labels).not.toContain('用户');
    expect(labels).not.toContain('数据备份');
    expect(labels).not.toContain('系统参数');
    expect(labels).toContain('总览');
    expect(labels).toContain('基地大屏');
    expect(labels).toContain('修改密码');
    expect(wrapper.get('nav').find('a[href="/account/password"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('lets every logged-in role open 修改密码', async () => {
    for (const role of ['super_admin', 'production_admin', 'shed_manager', 'viewer'] as const) {
      expect(visibleNav(role).map((link) => link.label)).toContain('修改密码');
      storeUser(role);
      await router.push('/account/password');
      await flushPromises();
      expect(router.currentRoute.value.path).toBe('/account/password');
      expect(router.currentRoute.value.meta.title).toBe('修改密码');
      expect(router.currentRoute.value.meta.roles).toBeUndefined();
    }
  });

  it('shows 审计 and 用户 in the sidebar for 超管', async () => {
    storeUser('super_admin');
    await router.push('/');
    await flushPromises();

    const wrapper = mount(AdminLayout, { global: { plugins: [router] } });
    const labels = wrapper.get('nav').findAll('a').map((anchor) => anchor.text());
    expect(labels).toContain('审计');
    expect(wrapper.get('nav').find('a[href="/audit"]').exists()).toBe(true);
    expect(labels).toContain('用户');
    expect(wrapper.get('nav').find('a[href="/users"]').exists()).toBe(true);
    expect(labels).toContain('数据备份');
    expect(wrapper.get('nav').find('a[href="/backup"]').exists()).toBe(true);
    expect(labels).toContain('系统参数');
    expect(wrapper.get('nav').find('a[href="/system-params"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('sends 查看 away from /audit and /users, and lets 超管 open both', async () => {
    storeUser('viewer');
    await router.push('/audit');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/');

    await router.push('/users');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/');

    await router.push('/backup');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/');

    await router.push('/system-params');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/');

    storeUser('super_admin');
    await router.push('/audit');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/audit');

    await router.push('/users');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/users');

    await router.push('/backup');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/backup');

    await router.push('/system-params');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/system-params');
  });

  it('lets 生产管理员 open /audit and sends them away from /users', async () => {
    storeUser('production_admin');
    await router.push('/audit');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/audit');

    await router.push('/users');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/');

    await router.push('/backup');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/');

    await router.push('/system-params');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/');
  });
});
