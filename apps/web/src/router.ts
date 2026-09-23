import { createRouter, createWebHistory } from 'vue-router';
import AdminLayout from './layouts/AdminLayout.vue';
import AlertsView from './views/AlertsView.vue';
import AuditView from './views/AuditView.vue';
import BigScreenView from './views/BigScreenView.vue';
import DashboardView from './views/DashboardView.vue';
import DiseasesView from './views/DiseasesView.vue';
import DevicesView from './views/DevicesView.vue';
import EnvironmentView from './views/EnvironmentView.vue';
import GrowthTrendsView from './views/GrowthTrendsView.vue';
import HarvestView from './views/HarvestView.vue';
import IngestObservabilityView from './views/IngestObservabilityView.vue';
import LoginView from './views/LoginView.vue';
import WecomPushView from './views/WecomPushView.vue';
import RecognitionsView from './views/RecognitionsView.vue';
import ReportsView from './views/ReportsView.vue';
import RulesView from './views/RulesView.vue';
import ShedsView from './views/ShedsView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: LoginView, meta: { public: true, title: '登录' } },
    { path: '/big-screen', component: BigScreenView, meta: { title: '基地大屏' } },
    {
      path: '/',
      component: AdminLayout,
      children: [
        { path: '', component: DashboardView, meta: { title: '总览' } },
        { path: 'devices', component: DevicesView, meta: { title: '设备' } },
        { path: 'recognitions', component: RecognitionsView, meta: { title: '识别记录' } },
        { path: 'environment', component: EnvironmentView, meta: { title: '环境读数' } },
        { path: 'ingest-observability', component: IngestObservabilityView, meta: { title: '接入观测' } },
        { path: 'diseases', component: DiseasesView, meta: { title: '病害' } },
        { path: 'alerts', component: AlertsView, meta: { title: '告警' } },
        { path: 'phase2/wecom', component: WecomPushView, meta: { title: '企微/钉钉' } },
        { path: 'alert-rules', component: RulesView, meta: { title: '阈值规则' } },
        { path: 'harvest', component: HarvestView, meta: { title: '采摘' } },
        { path: 'growth-trends', component: GrowthTrendsView, meta: { title: '生长趋势' } },
        { path: 'reports', component: ReportsView, meta: { title: '报表' } },
        { path: 'sheds', component: ShedsView, meta: { title: '棚区' } },
        { path: 'audit', component: AuditView, meta: { title: '审计' } },
        { path: 'phase2/big-screen', redirect: '/big-screen' },
        { path: 'phase2/trends', redirect: '/growth-trends' },
        { path: 'phase2/yield', redirect: '/harvest' },
      ],
    },
  ],
});

router.beforeEach((to) => {
  if (to.meta.public) return true;
  if (!localStorage.getItem('token')) return { path: '/login', query: { redirect: to.fullPath } };
  return true;
});

export default router;
