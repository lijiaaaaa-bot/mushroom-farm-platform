import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
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
    expect(route?.meta.title).toBe('菇棚监测');
  });

  it('opens /big-screen after login and keeps it outside the admin shell', async () => {
    localStorage.setItem('token', 'test-token');
    await router.push('/big-screen');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/big-screen');
    expect(router.currentRoute.value.matched.map((record) => record.path)).toEqual(['/big-screen']);
    expect(router.currentRoute.value.matched[0]?.components?.default).toBe(BigScreenView);
  });

  it('links 菇棚监测 to /big-screen from the admin nav', async () => {
    localStorage.setItem('token', 'test-token');
    await router.push('/');
    await flushPromises();

    const wrapper = mount(AdminLayout, { global: { plugins: [router] } });
    const link = wrapper.findAll('a').find((anchor) => anchor.text() === '菇棚监测');
    expect(link?.attributes('href')).toBe('/big-screen');
    wrapper.unmount();
  });
});
