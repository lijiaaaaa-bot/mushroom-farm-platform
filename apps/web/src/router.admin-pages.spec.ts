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
import AlertsView from './views/AlertsView.vue';
import DevicesView from './views/DevicesView.vue';
import EnvironmentView from './views/EnvironmentView.vue';
import DiseasesView from './views/DiseasesView.vue';
import HarvestView from './views/HarvestView.vue';
import ReportsView from './views/ReportsView.vue';
import RulesView from './views/RulesView.vue';

const pages = [
  { path: '/devices', component: DevicesView, title: '设备', label: '设备' },
  { path: '/environment', component: EnvironmentView, title: '环境读数', label: '环境读数' },
  { path: '/diseases', component: DiseasesView, title: '病害', label: '病害' },
  { path: '/alerts', component: AlertsView, title: '告警', label: '告警' },
  { path: '/alert-rules', component: RulesView, title: '阈值规则', label: '阈值规则' },
  { path: '/harvest', component: HarvestView, title: '采摘', label: '采摘' },
  { path: '/reports', component: ReportsView, title: '报表', label: '报表' },
] as const;

describe('admin list routes', () => {
  beforeEach(async () => {
    localStorage.clear();
    await router.push('/login');
    await router.isReady();
  });

  it('registers the admin list pages on their page components', () => {
    for (const page of pages) {
      const route = router.getRoutes().find((record) => record.path === page.path);
      expect(route, page.path).toBeTruthy();
      expect(route?.components?.default).toBe(page.component);
      expect(route?.meta.title).toBe(page.title);
    }
  });

  it('opens each admin page after login inside the admin shell', async () => {
    localStorage.setItem('token', 'test-token');
    for (const page of pages) {
      await router.push(page.path);
      await flushPromises();
      expect(router.currentRoute.value.path).toBe(page.path);
      const matched = router.currentRoute.value.matched.map((record) => record.path);
      expect(matched).toContain('/');
      expect(matched).toContain(page.path);
      const record = router.currentRoute.value.matched.find((item) => item.path === page.path);
      expect(record?.components?.default).toBe(page.component);
    }
  });

  it('links the admin list pages from the admin nav', async () => {
    localStorage.setItem('token', 'test-token');
    await router.push('/');
    await flushPromises();

    const wrapper = mount(AdminLayout, { global: { plugins: [router] } });
    for (const page of pages) {
      const link = wrapper.findAll('a').find((anchor) => anchor.text() === page.label);
      expect(link?.attributes('href')).toBe(page.path);
    }
    wrapper.unmount();
  });
});
