import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  http: {
    get: vi.fn().mockResolvedValue({ data: { unreadCount: 0, items: [] } }),
    post: vi.fn(),
  },
  errorText: () => '请求失败',
}));

import AdminLayout from './layouts/AdminLayout.vue';
import router from './router';
import BigScreenView from './views/BigScreenView.vue';
import DutyScreenView from './views/DutyScreenView.vue';

describe('/duty-screen route', () => {
  beforeEach(async () => {
    localStorage.clear();
    await router.push('/login');
    await router.isReady();
  });

  it('registers /duty-screen on DutyScreenView and leaves /big-screen in place', () => {
    const duty = router.getRoutes().find((record) => record.path === '/duty-screen');
    expect(duty?.components?.default).toBe(DutyScreenView);
    expect(duty?.meta.title).toBe('值班看板');

    const screen = router.getRoutes().find((record) => record.path === '/big-screen');
    expect(screen?.components?.default).toBe(BigScreenView);
    expect(screen?.meta.title).toBe('基地大屏');
  });

  it('opens /duty-screen after login outside the admin shell', async () => {
    localStorage.setItem('token', 'test-token');
    await router.push('/duty-screen');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/duty-screen');
    expect(router.currentRoute.value.matched.map((record) => record.path)).toEqual(['/duty-screen']);
    expect(router.currentRoute.value.matched[0]?.components?.default).toBe(DutyScreenView);
  });

  it('places 值班看板 in the sidebar and top bar next to 基地大屏', async () => {
    localStorage.setItem('token', 'test-token');
    await router.push('/');
    await flushPromises();

    const wrapper = mount(AdminLayout, { global: { plugins: [router] } });
    const navLinks = wrapper.get('nav').findAll('a');
    expect(navLinks[0]?.text()).toBe('总览');
    expect(navLinks[1]?.text()).toBe('基地大屏');
    expect(navLinks[1]?.attributes('href')).toBe('/big-screen');
    expect(navLinks[2]?.text()).toBe('值班看板');
    expect(navLinks[2]?.attributes('href')).toBe('/duty-screen');

    const topbar = wrapper.get('.admin-topbar');
    expect(topbar.find('a[href="/big-screen"]').text()).toBe('基地大屏');
    expect(topbar.find('a[href="/duty-screen"]').text()).toBe('值班看板');
    wrapper.unmount();
  });
});
