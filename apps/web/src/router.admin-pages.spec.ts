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
import AlertDetailView from './views/AlertDetailView.vue';
import AlertsView from './views/AlertsView.vue';
import DeviceDetailView from './views/DeviceDetailView.vue';
import DevicesView from './views/DevicesView.vue';
import EnvironmentView from './views/EnvironmentView.vue';
import EnvironmentReadingView from './views/EnvironmentReadingView.vue';
import ShedEnv24hView from './views/ShedEnv24hView.vue';
import IngestObservabilityView from './views/IngestObservabilityView.vue';
import DiseaseDetailView from './views/DiseaseDetailView.vue';
import DiseasesView from './views/DiseasesView.vue';
import BatchesView from './views/BatchesView.vue';
import GrowthCompareView from './views/GrowthCompareView.vue';
import GrowthTrendsView from './views/GrowthTrendsView.vue';
import ShedGrowthDeltaView from './views/ShedGrowthDeltaView.vue';
import HarvestDetailView from './views/HarvestDetailView.vue';
import HarvestView from './views/HarvestView.vue';
import ReportsView from './views/ReportsView.vue';
import RuleDetailView from './views/RuleDetailView.vue';
import RulesView from './views/RulesView.vue';

const pages = [
  { path: '/devices', component: DevicesView, title: '设备', label: '设备' },
  { path: '/environment', component: EnvironmentView, title: '环境读数', label: '环境读数' },
  { path: '/shed-env-24h', component: ShedEnv24hView, title: '单棚环境24小时', label: '环境24小时' },
  { path: '/ingest-observability', component: IngestObservabilityView, title: '接入观测', label: '接入观测' },
  { path: '/diseases', component: DiseasesView, title: '病害', label: '病害' },
  { path: '/alerts', component: AlertsView, title: '告警', label: '告警' },
  { path: '/alert-rules', component: RulesView, title: '阈值规则', label: '阈值规则' },
  { path: '/harvest', component: HarvestView, title: '采摘', label: '采摘' },
  { path: '/growth-trends', component: GrowthTrendsView, title: '生长趋势', label: '生长趋势' },
  { path: '/shed-growth-delta', component: ShedGrowthDeltaView, title: '单棚生长增量', label: '生长增量' },
  { path: '/growth-compare', component: GrowthCompareView, title: '棚间对比', label: '棚间对比' },
  { path: '/batches', component: BatchesView, title: '出菇批次', label: '出菇批次' },
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

  it('opens a camera detail page inside the admin shell', async () => {
    localStorage.setItem('token', 'test-token');
    const route = router.getRoutes().find((record) => record.path === '/devices/:id');
    expect(route?.components?.default).toBe(DeviceDetailView);
    expect(route?.meta.title).toBe('镜头详情');
    await router.push('/devices/dev-1');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/devices/dev-1');
    const matched = router.currentRoute.value.matched.map((record) => record.path);
    expect(matched).toContain('/');
    expect(matched).toContain('/devices/:id');
  });

  it('opens an environment reading detail page inside the admin shell', async () => {
    localStorage.setItem('token', 'test-token');
    const route = router.getRoutes().find((record) => record.path === '/environment/:id');
    expect(route?.components?.default).toBe(EnvironmentReadingView);
    expect(route?.meta.title).toBe('环境读数详情');
    await router.push('/environment/env-1');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/environment/env-1');
    const matched = router.currentRoute.value.matched.map((record) => record.path);
    expect(matched).toContain('/');
    expect(matched).toContain('/environment/:id');
  });

  it('opens a harvest detail page inside the admin shell', async () => {
    localStorage.setItem('token', 'test-token');
    const route = router.getRoutes().find((record) => record.path === '/harvest/:id');
    expect(route?.components?.default).toBe(HarvestDetailView);
    expect(route?.meta.title).toBe('采摘详情');
    await router.push('/harvest/rec-1');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/harvest/rec-1');
    const matched = router.currentRoute.value.matched.map((record) => record.path);
    expect(matched).toContain('/');
    expect(matched).toContain('/harvest/:id');
  });

  it('opens a disease detail page inside the admin shell', async () => {
    localStorage.setItem('token', 'test-token');
    const route = router.getRoutes().find((record) => record.path === '/diseases/:id');
    expect(route?.components?.default).toBe(DiseaseDetailView);
    expect(route?.meta.title).toBe('病害详情');
    await router.push('/diseases/d-1');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/diseases/d-1');
    const matched = router.currentRoute.value.matched.map((record) => record.path);
    expect(matched).toContain('/');
    expect(matched).toContain('/diseases/:id');
  });

  it('opens a threshold rule detail page inside the admin shell', async () => {
    localStorage.setItem('token', 'test-token');
    const route = router.getRoutes().find((record) => record.path === '/alert-rules/:id');
    expect(route?.components?.default).toBe(RuleDetailView);
    expect(route?.meta.title).toBe('阈值规则详情');
    await router.push('/alert-rules/rule-1');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/alert-rules/rule-1');
    const matched = router.currentRoute.value.matched.map((record) => record.path);
    expect(matched).toContain('/');
    expect(matched).toContain('/alert-rules/:id');
  });

  it('opens an alert detail page inside the admin shell', async () => {
    localStorage.setItem('token', 'test-token');
    const route = router.getRoutes().find((record) => record.path === '/alerts/:id');
    expect(route?.components?.default).toBe(AlertDetailView);
    expect(route?.meta.title).toBe('告警详情');
    await router.push('/alerts/alert-1');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/alerts/alert-1');
    const matched = router.currentRoute.value.matched.map((record) => record.path);
    expect(matched).toContain('/');
    expect(matched).toContain('/alerts/:id');
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
