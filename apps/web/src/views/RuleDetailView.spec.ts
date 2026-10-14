import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RuleDetailView from './RuleDetailView.vue';

const httpGet = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: { get: httpGet },
  errorText: (error: { response?: { data?: { message?: string } } }) =>
    error.response?.data?.message || '请求失败',
}));

const rule = {
  id: 'rule-1',
  name: '演示规则列表',
  metric: 'humidity_high' as const,
  threshold: 95,
  level: 'info' as const,
  enabled: true,
  windowMinutes: 360,
  shedCode: 'S01',
};

async function mountView(id = 'rule-1') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/alert-rules', component: { template: '<div />' } },
      { path: '/alert-rules/:id', component: RuleDetailView },
    ],
  });
  await router.push(`/alert-rules/${id}`);
  await router.isReady();
  const wrapper = mount(RuleDetailView, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

describe('RuleDetailView', () => {
  beforeEach(() => {
    httpGet.mockReset();
  });

  it('shows the rule fields and returns to the highlighted list', async () => {
    httpGet.mockResolvedValue({ data: rule });
    const wrapper = await mountView();

    expect(httpGet).toHaveBeenCalledWith('/alert-rules/rule-1');
    expect(wrapper.text()).toContain('阈值规则详情');
    const detail = wrapper.get('[data-testid="rule-detail"]');
    expect(detail.get('[data-field="name"]').text()).toBe('演示规则列表');
    expect(detail.get('[data-field="metric"]').text()).toBe('湿度过高');
    expect(detail.get('[data-field="shed"]').text()).toBe('S01');
    expect(detail.get('[data-field="threshold"]').text()).toBe('95');
    expect(detail.get('[data-field="level"]').text()).toBe('提示');
    expect(detail.get('[data-field="window"]').text()).toBe('360');
    expect(detail.get('[data-field="enabled"]').text()).toBe('是');
    expect(wrapper.get('[data-testid="rule-back"]').attributes('href')).toBe('/alert-rules?ruleId=rule-1');
    wrapper.unmount();
  });

  it('writes 全场 when the rule is not limited to a shed', async () => {
    httpGet.mockResolvedValue({ data: { ...rule, shedCode: null } });
    const wrapper = await mountView();
    expect(wrapper.get('[data-field="shed"]').text()).toBe('全场');
    wrapper.unmount();
  });

  it('shows the missing-rule error', async () => {
    httpGet.mockRejectedValue({ response: { data: { message: '规则不存在' } } });
    const wrapper = await mountView('missing');
    expect(wrapper.get('[data-testid="rule-detail-error"]').text()).toBe('规则不存在');
    expect(wrapper.find('[data-testid="rule-detail"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
