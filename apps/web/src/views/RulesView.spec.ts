import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { currentUser, type SessionUser } from '../auth';
import RulesView from './RulesView.vue';

const httpGet = vi.hoisted(() => vi.fn());
const httpPost = vi.hoisted(() => vi.fn());
const httpPatch = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: {
    get: httpGet,
    post: httpPost,
    patch: httpPatch,
  },
  errorText: () => '请求失败',
}));

const rule = {
  id: 'rule-1',
  name: '高温规则',
  metric: 'temperature_high' as const,
  threshold: 35,
  level: 'warning' as const,
  enabled: false,
  windowMinutes: 60,
  shedCode: null,
};

function asUser(role: SessionUser['role']) {
  currentUser.value = {
    id: 'user-1',
    username: role,
    displayName: role,
    role,
    shedCodes: ['S01'],
  };
}

async function mountView(query: Record<string, string> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/alert-rules', component: RulesView },
      { path: '/alert-rules/:id', component: { template: '<div />' } },
    ],
  });
  await router.push({ path: '/alert-rules', query });
  await router.isReady();
  const wrapper = mount(RulesView, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

describe('RulesView', () => {
  beforeEach(() => {
    localStorage.clear();
    httpGet.mockReset();
    httpPost.mockReset();
    httpPatch.mockReset();
    asUser('production_admin');
  });

  it('shows error text without the empty copy when the rule list fails', async () => {
    httpGet.mockRejectedValue(new Error('down'));
    const wrapper = await mountView();

    expect(httpGet).toHaveBeenCalledWith('/alert-rules');
    expect(wrapper.text()).toContain('请求失败');
    expect(wrapper.text()).not.toContain('暂无阈值规则');
    expect(wrapper.find('table').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows empty copy when the rule list is empty', async () => {
    httpGet.mockResolvedValue({ data: [] });
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('暂无阈值规则。');
    expect(wrapper.find('table').exists()).toBe(false);
    wrapper.unmount();
  });

  it('creates a rule and shows it after the list reloads', async () => {
    const created = { ...rule, enabled: true, threshold: 30, windowMinutes: 720 };
    httpGet.mockResolvedValueOnce({ data: [] }).mockResolvedValue({ data: [created] });
    httpPost.mockResolvedValue({ data: created });
    const wrapper = await mountView();

    await wrapper.get('input[placeholder="规则名称"]').setValue('高温规则');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(httpPost).toHaveBeenCalledWith('/alert-rules', {
      name: '高温规则',
      metric: 'temperature_high',
      threshold: 30,
      level: 'warning',
      windowMinutes: 720,
    });
    expect(wrapper.text()).toContain('高温规则');
    expect(wrapper.text()).toContain('温度过高');
    expect(wrapper.get('[data-field="shed"]').text()).toBe('全场');
    expect(wrapper.get('[data-testid="rule-open"]').attributes('href')).toBe('/alert-rules/rule-1');
    expect(wrapper.get('[data-testid="rule-notice"]').text()).toContain('已新建「高温规则」');
    expect(wrapper.get('[data-testid="rule-notice"]').text()).toContain('阈值 30');
    expect(wrapper.get('[data-testid="rule-notice"]').text()).toContain('下方列表有这一行');
    expect(wrapper.get('[data-testid="rule-notice-detail"]').attributes('href')).toBe('/alert-rules/rule-1');
    expect(wrapper.get('tr[data-rule-id="rule-1"]').attributes('data-highlight')).toBe('true');
    expect(wrapper.text()).not.toContain('暂无阈值规则');
    wrapper.unmount();

    httpGet.mockResolvedValue({ data: [created] });
    const refreshed = await mountView();
    expect(refreshed.text()).toContain('高温规则');
    expect(refreshed.text()).toContain('是');
    refreshed.unmount();
  });

  it('enables a rule and shows the updated list', async () => {
    const enabled = { ...rule, enabled: true };
    httpGet.mockResolvedValueOnce({ data: [rule] }).mockResolvedValue({ data: [enabled] });
    httpPatch.mockResolvedValue({ data: enabled });
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('否');
    const enable = wrapper.findAll('button').find((button) => button.text() === '启用');
    expect(enable).toBeTruthy();
    await enable!.trigger('click');
    await flushPromises();

    expect(httpPatch).toHaveBeenCalledWith('/alert-rules/rule-1', { enabled: true });
    expect(wrapper.text()).toContain('是');
    expect(wrapper.text()).toContain('停用');
    expect(wrapper.get('[data-testid="rule-notice"]').text()).toContain('已保存「高温规则」');
    expect(wrapper.get('[data-testid="rule-notice"]').text()).toContain('启用 是');
    wrapper.unmount();
  });

  it('saves an edited threshold and shows the updated list', async () => {
    const updated = { ...rule, threshold: 41, enabled: true };
    httpGet.mockResolvedValueOnce({ data: [{ ...rule, enabled: true }] }).mockResolvedValue({ data: [updated] });
    httpPatch.mockResolvedValue({ data: updated });
    const wrapper = await mountView();

    await wrapper.get('input[aria-label="高温规则 阈值"]').setValue('41');
    const save = wrapper.findAll('button').find((button) => button.text() === '保存');
    expect(save).toBeTruthy();
    await save!.trigger('click');
    await flushPromises();

    expect(httpPatch).toHaveBeenCalledWith('/alert-rules/rule-1', {
      threshold: 41,
      level: 'warning',
      windowMinutes: 60,
    });
    expect((wrapper.get('input[aria-label="高温规则 阈值"]').element as HTMLInputElement).value).toBe('41');
    expect(wrapper.get('[data-testid="rule-notice"]').text()).toContain('已保存「高温规则」');
    expect(wrapper.get('[data-testid="rule-notice"]').text()).toContain('阈值 41');
    expect(wrapper.get('[data-testid="rule-notice"]').text()).toContain('等级 一般');
    expect(wrapper.get('[data-testid="rule-notice"]').text()).toContain('窗口分钟 60');
    expect(wrapper.get('tr[data-rule-id="rule-1"]').attributes('data-highlight')).toBe('true');
    expect(wrapper.get('[data-testid="rule-notice-detail"]').attributes('href')).toBe('/alert-rules/rule-1');
    wrapper.unmount();
  });

  it('hides create and edit controls for shed manager and viewer', async () => {
    httpGet.mockResolvedValue({ data: [{ ...rule, enabled: true, shedCode: 'S01' }] });
    for (const role of ['shed_manager', 'viewer'] as const) {
      asUser(role);
      const wrapper = await mountView();
      expect(wrapper.text()).toContain('当前角色只能查看阈值规则。');
      expect(wrapper.text()).toContain('高温规则');
      expect(wrapper.get('[data-field="shed"]').text()).toBe('S01');
      expect(wrapper.text()).toContain('35');
      expect(wrapper.get('[data-testid="rule-open"]').attributes('href')).toBe('/alert-rules/rule-1');
      expect(wrapper.find('form').exists()).toBe(false);
      expect(wrapper.find('button').exists()).toBe(false);
      wrapper.unmount();
    }
  });

  it('highlights the rule named in the address', async () => {
    httpGet.mockResolvedValue({ data: [rule, { ...rule, id: 'rule-2', name: '另一条', shedCode: 'S02' }] });
    const wrapper = await mountView({ ruleId: 'rule-2' });
    expect(wrapper.get('tr[data-rule-id="rule-2"]').attributes('data-highlight')).toBe('true');
    expect(wrapper.get('tr[data-rule-id="rule-1"]').attributes('data-highlight')).toBeUndefined();
    expect(wrapper.get('tr[data-rule-id="rule-2"]').get('[data-field="shed"]').text()).toBe('S02');
    wrapper.unmount();
  });
});
