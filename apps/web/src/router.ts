import { createRouter, createWebHistory } from 'vue-router';
import AdminLayout from './layouts/AdminLayout.vue';
import AlertsView from './views/AlertsView.vue';
import AuditView from './views/AuditView.vue';
import DashboardView from './views/DashboardView.vue';
import DevicesView from './views/DevicesView.vue';
import HarvestView from './views/HarvestView.vue';
import LoginView from './views/LoginView.vue';
import Phase2View from './views/phase2/Phase2View.vue';
import RecognitionsView from './views/RecognitionsView.vue';
import ReportsView from './views/ReportsView.vue';
import RulesView from './views/RulesView.vue';
import ShedsView from './views/ShedsView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: LoginView, meta: { public: true, title: '登录' } },
    {
      path: '/',
      component: AdminLayout,
      children: [
        { path: '', component: DashboardView, meta: { title: '总览' } },
        { path: 'devices', component: DevicesView, meta: { title: '设备' } },
        { path: 'recognitions', component: RecognitionsView, meta: { title: '识别记录' } },
        { path: 'alerts', component: AlertsView, meta: { title: '告警' } },
        { path: 'alert-rules', component: RulesView, meta: { title: '阈值规则' } },
        { path: 'harvest', component: HarvestView, meta: { title: '采摘' } },
        { path: 'reports', component: ReportsView, meta: { title: '报表' } },
        { path: 'sheds', component: ShedsView, meta: { title: '棚区' } },
        { path: 'audit', component: AuditView, meta: { title: '审计' } },
        {
          path: 'phase2/big-screen',
          component: Phase2View,
          props: { title: '基地大屏', summary: '基地与单棚大屏。' },
          meta: { title: '大屏' },
        },
        {
          path: 'phase2/trends',
          component: Phase2View,
          props: { title: '生长趋势', summary: '抓拍对比与生长复盘。' },
          meta: { title: '趋势' },
        },
        {
          path: 'phase2/yield',
          component: Phase2View,
          props: { title: '产量预估', summary: '未来 2–3 天可采量预估。' },
          meta: { title: '产量预估' },
        },
        {
          path: 'phase2/wecom',
          component: Phase2View,
          props: { title: '企微推送', summary: '企微 / 钉钉告警推送。' },
          meta: { title: '企微' },
        },
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
