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

describe('/big-screen route', () => {
  beforeEach(async () => {
    localStorage.clear();
    await router.push('/login');
    await router.isReady();
  });

  it('registers /big-screen on BigScreenView', () => {
    const route = router.getRoutes().find((record) => record.path === '/big-screen');
    expect(route).toBeTruthy();
    expect(route?.components?.default).toBe(BigScreenView);
    expect(route?.meta.title).toBe('基地大屏');
  });

  it('opens /big-screen after login and keeps it outside the admin shell', async () => {
    localStorage.setItem('token', 'test-token');
    await router.push('/big-screen');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/big-screen');
    expect(router.currentRoute.value.matched.map((record) => record.path)).toEqual(['/big-screen']);
    expect(router.currentRoute.value.matched[0]?.components?.default).toBe(BigScreenView);
  });

  it('places 基地大屏 right after 总览 and opens /big-screen', async () => {
    localStorage.setItem('token', 'test-token');
    await router.push('/');
    await flushPromises();

    const wrapper = mount(AdminLayout, { global: { plugins: [router] } });
    const navLinks = wrapper.get('nav').findAll('a');
    expect(navLinks[0]?.text()).toBe('总览');
    const screenLink = navLinks[1];
    expect(screenLink?.attributes('href')).toBe('/big-screen');
    expect(screenLink?.text()).toBe('基地大屏');
    expect(screenLink?.findAll('span')).toHaveLength(1);
    const hrefs = navLinks.map((anchor) => anchor.attributes('href'));
    expect(hrefs).not.toContain('/phase2/big-screen');
    expect(hrefs).not.toContain('/phase2/wecom');
    expect(wrapper.get('nav').text()).not.toContain('二期槽位');
    expect(wrapper.get('nav').text()).not.toMatch(/phase-?2|槽位|企微/i);
    const topbar = wrapper.get('.admin-topbar').findAll('a').find((anchor) => anchor.text() === '基地大屏');
    expect(topbar?.attributes('href')).toBe('/big-screen');
    expect(wrapper.text()).not.toContain('二期');
    expect(wrapper.find('a[href="/phase2/big-screen"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('redirects the old big-screen placeholder to /big-screen', async () => {
    localStorage.setItem('token', 'test-token');
    await router.push('/phase2/big-screen');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/big-screen');
  });
});
