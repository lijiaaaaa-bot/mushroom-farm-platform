import { createRouter, createWebHistory } from 'vue-router';
import AdminLayout from './layouts/AdminLayout.vue';
import AlertDetailView from './views/AlertDetailView.vue';
import AlertsView from './views/AlertsView.vue';
import BatchesView from './views/BatchesView.vue';
import AuditView from './views/AuditView.vue';
import BigScreenView from './views/BigScreenView.vue';
import DutyScreenView from './views/DutyScreenView.vue';
import DutyShedDetailView from './views/DutyShedDetailView.vue';
import DashboardView from './views/DashboardView.vue';
import DiseaseDetailView from './views/DiseaseDetailView.vue';
import DiseasesView from './views/DiseasesView.vue';
import DeviceDetailView from './views/DeviceDetailView.vue';
import DevicesView from './views/DevicesView.vue';
import EnvironmentView from './views/EnvironmentView.vue';
import EnvironmentReadingView from './views/EnvironmentReadingView.vue';
import GrowthTrendsView from './views/GrowthTrendsView.vue';
import HarvestDetailView from './views/HarvestDetailView.vue';
import HarvestView from './views/HarvestView.vue';
import IngestObservabilityView from './views/IngestObservabilityView.vue';
import LoginView from './views/LoginView.vue';
import WecomPushView from './views/WecomPushView.vue';
import RecognitionsView from './views/RecognitionsView.vue';
import ReportsView from './views/ReportsView.vue';
import RuleDetailView from './views/RuleDetailView.vue';
import RulesView from './views/RulesView.vue';
import ShedsView from './views/ShedsView.vue';
import UsersView from './views/UsersView.vue';
import { readSessionRole } from './auth';
import { navRoles, roleCanOpen } from './nav';
import type { Role } from '@mushroom/contracts';

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean;
    title?: string;
    roles?: Role[];
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: LoginView, meta: { public: true, title: '登录' } },
    { path: '/big-screen', component: BigScreenView, meta: { title: '基地大屏' } },
    { path: '/duty-screen', name: 'duty-screen', component: DutyScreenView, meta: { title: '值班看板' } },
    {
      path: '/duty-screen/:shedCode',
      name: 'duty-shed',
      component: DutyShedDetailView,
      meta: { title: '值班棚详情' },
    },
    {
      path: '/',
      component: AdminLayout,
      children: [
        { path: '', component: DashboardView, meta: { title: '总览' } },
        { path: 'devices', component: DevicesView, meta: { title: '设备' } },
        { path: 'devices/:id', component: DeviceDetailView, meta: { title: '镜头详情' } },
        { path: 'recognitions', component: RecognitionsView, meta: { title: '识别记录' } },
        { path: 'environment', component: EnvironmentView, meta: { title: '环境读数' } },
        { path: 'environment/:id', component: EnvironmentReadingView, meta: { title: '环境读数详情' } },
        { path: 'ingest-observability', component: IngestObservabilityView, meta: { title: '接入观测' } },
        { path: 'diseases', component: DiseasesView, meta: { title: '病害' } },
        { path: 'diseases/:id', component: DiseaseDetailView, meta: { title: '病害详情' } },
        { path: 'alerts', component: AlertsView, meta: { title: '告警' } },
        { path: 'alerts/:id', component: AlertDetailView, meta: { title: '告警详情' } },
        { path: 'phase2/wecom', component: WecomPushView, meta: { title: '企微/钉钉' } },
        { path: 'alert-rules', component: RulesView, meta: { title: '阈值规则' } },
        { path: 'alert-rules/:id', component: RuleDetailView, meta: { title: '阈值规则详情' } },
        { path: 'harvest', component: HarvestView, meta: { title: '采摘' } },
        { path: 'harvest/:id', component: HarvestDetailView, meta: { title: '采摘详情' } },
        { path: 'growth-trends', component: GrowthTrendsView, meta: { title: '生长趋势' } },
        { path: 'batches', component: BatchesView, meta: { title: '出菇批次' } },
        { path: 'reports', component: ReportsView, meta: { title: '报表' } },
        { path: 'sheds', component: ShedsView, meta: { title: '棚区' } },
        { path: 'audit', component: AuditView, meta: { title: '审计', roles: navRoles('/audit') } },
        { path: 'users', component: UsersView, meta: { title: '用户', roles: navRoles('/users') } },
        { path: 'phase2/big-screen', redirect: '/big-screen' },
      ],
    },
  ],
});

router.beforeEach((to) => {
  if (to.meta.public) return true;
  if (!localStorage.getItem('token')) return { path: '/login', query: { redirect: to.fullPath } };
  if (!roleCanOpen(readSessionRole(), to.path)) return { path: '/' };
  return true;
});

export default router;
