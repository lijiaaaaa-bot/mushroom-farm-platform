import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AuditView from './AuditView.vue';

const httpGet = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: { get: httpGet },
  errorText: (error: unknown) =>
    error instanceof Error && error.message === '开始时间无效' ? error.message : '请求失败',
}));

const failureLogin = {
  id: 'login-demo',
  username: 'login-log-fail',
  result: 'failure',
  ip: '127.0.0.1',
  userAgent: 'audit-login-log-demo/1',
  createdAt: '2026-10-15T01:00:00.000Z',
};

const successLogin = {
  id: 'login-admin',
  username: 'admin',
  result: 'success',
  ip: '127.0.0.1',
  userAgent: 'audit-login-log-demo/1',
  createdAt: '2026-10-15T04:00:00.000Z',
};

const failedAudit = {
  id: 'audit-failed',
  username: null,
  action: 'auth.login_failed',
  resource: 'auth',
  createdAt: '2026-10-15T01:00:00.000Z',
  detail: { username: 'login-log-fail' },
};

const successAudit = {
  id: 'audit-ok',
  username: 'admin',
  action: 'auth.login',
  resource: 'auth',
  createdAt: '2026-10-15T04:00:00.000Z',
  detail: null,
};

async function mountView(query?: Record<string, string>) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/audit', component: AuditView }],
  });
  await router.push({ path: '/audit', query });
  await router.isReady();
  const wrapper = mount(AuditView, { global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router };
}

describe('AuditView', () => {
  beforeEach(() => {
    httpGet.mockReset();
  });

  it('shows login results and who corrected which shed', async () => {
    httpGet.mockImplementation((url: string) => {
      if (url.startsWith('/login-logs')) {
        return Promise.resolve({
          data: {
            items: [
              {
                id: 'login-1',
                username: 'admin',
                result: 'failure',
                ip: '10.0.0.8',
                userAgent: 'shed-console/1',
                createdAt: '2026-09-24T01:00:00.000Z',
              },
            ],
            total: 1,
          },
        });
      }
      return Promise.resolve({
        data: {
          items: [
            {
              id: 'audit-1',
              username: 'production_admin',
              action: 'harvest.correct',
              resource: 'recognition:rec-1',
              createdAt: '2026-09-23T02:00:00.000Z',
              detail: {
                shedCode: 'S01',
                cameraCode: 'CAM-S01',
                changes: {
                  matureCount: { old: 4, new: 6 },
                },
              },
            },
          ],
        },
      });
    });
    const { wrapper } = await mountView();

    expect(httpGet).toHaveBeenCalledWith('/login-logs', { params: { pageSize: '100' } });
    expect(httpGet).toHaveBeenCalledWith('/audit-logs', { params: { pageSize: '100' } });
    expect(wrapper.text()).toContain('admin');
    expect(wrapper.text()).toContain('失败');
    expect(wrapper.text()).toContain('10.0.0.8');
    expect(wrapper.text()).toContain('shed-console/1');
    expect(wrapper.text()).toContain('production_admin');
    expect(wrapper.text()).toContain('harvest.correct');
    expect(wrapper.text()).toContain('S01');
    expect(wrapper.text()).toContain('CAM-S01');
    expect(wrapper.text()).toContain('成熟数 4→6');
    expect(wrapper.text()).not.toContain('暂无登录日志');
    wrapper.unmount();
  });

  it('shows a successful and a failed login above the operation audit', async () => {
    httpGet.mockImplementation((url: string) => {
      if (url.startsWith('/login-logs')) {
        return Promise.resolve({
          data: { items: [successLogin, failureLogin], total: 2 },
        });
      }
      return Promise.resolve({
        data: { items: [successAudit, failedAudit] },
      });
    });
    const { wrapper } = await mountView();
    expect(wrapper.text()).toContain('登录日志');
    expect(wrapper.text()).toContain('操作审计');
    expect(wrapper.get('[data-testid="login-log-table"]').text()).toContain('login-log-fail');
    expect(wrapper.get('[data-testid="login-log-table"]').text()).toContain('失败');
    expect(wrapper.get('[data-testid="login-log-table"]').text()).toContain('成功');
    expect(wrapper.get('[data-testid="login-log-table"]').text()).toContain('audit-login-log-demo/1');
    expect(wrapper.get('[data-testid="audit-log-table"]').text()).toContain('登录失败');
    expect(wrapper.get('[data-testid="audit-log-table"]').text()).toContain('登录成功');
    expect(wrapper.get('[data-testid="audit-log-table"]').text()).toContain('login-log-fail');
    expect(wrapper.get('[data-login-username="login-log-fail"]').attributes('data-login-result')).toBe('failure');
    expect(wrapper.get('[data-login-username="admin"]').attributes('data-login-result')).toBe('success');
    wrapper.unmount();
  });

  it('keeps the audit table when login logs fail to load', async () => {
    httpGet.mockImplementation((url: string) => {
      if (url.startsWith('/login-logs')) return Promise.reject(new Error('no'));
      return Promise.resolve({
        data: {
          items: [
            {
              id: 'audit-1',
              username: 'production_admin',
              action: 'harvest.correct',
              resource: 'recognition:rec-1',
              createdAt: '2026-09-23T02:00:00.000Z',
              detail: null,
            },
          ],
        },
      });
    });
    const { wrapper } = await mountView();
    expect(wrapper.text()).toContain('请求失败');
    expect(wrapper.text()).toContain('harvest.correct');
    expect(wrapper.find('[data-testid="login-log-empty"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('writes username and time into the address and omits them when cleared', async () => {
    httpGet.mockResolvedValue({ data: { items: [], total: 0 } });
    const { wrapper, router } = await mountView();

    const from = '2026-09-01T08:00';
    const to = '2026-09-30T18:00';
    await wrapper.get('[data-testid="login-log-username"]').setValue('admin');
    await wrapper.get('[data-testid="login-log-from"]').setValue(from);
    await wrapper.get('[data-testid="login-log-to"]').setValue(to);
    await wrapper.get('form[data-testid="login-log-filters"]').trigger('submit');
    await flushPromises();

    expect(router.currentRoute.value.query.username).toBe('admin');
    expect(router.currentRoute.value.query.from).toBe(new Date(from).toISOString());
    expect(router.currentRoute.value.query.to).toBe(new Date(to).toISOString());
    expect(httpGet).toHaveBeenCalledWith('/login-logs', {
      params: {
        pageSize: '100',
        username: 'admin',
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
      },
    });

    await wrapper.get('[data-testid="login-log-clear"]').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.query.username).toBeUndefined();
    expect(router.currentRoute.value.query.from).toBeUndefined();
    expect(router.currentRoute.value.query.to).toBeUndefined();
    const loginCalls = httpGet.mock.calls.filter((call) => call[0] === '/login-logs');
    expect(loginCalls[loginCalls.length - 1]?.[1].params).toEqual({ pageSize: '100' });
    wrapper.unmount();
  });

  it('opens a username and time query and shows only the matching login rows', async () => {
    const from = '2026-10-15T00:00:00.000Z';
    const to = '2026-10-15T02:00:00.000Z';
    httpGet.mockImplementation((url: string) => {
      if (url.startsWith('/login-logs')) {
        return Promise.resolve({ data: { items: [failureLogin], total: 1 } });
      }
      return Promise.resolve({ data: { items: [failedAudit, successAudit] } });
    });
    const { wrapper } = await mountView({
      username: 'login-log-fail',
      from,
      to,
    });

    expect(httpGet).toHaveBeenCalledWith('/login-logs', {
      params: {
        pageSize: '100',
        username: 'login-log-fail',
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
      },
    });
    const scope = wrapper.get('[data-testid="login-log-scope"]');
    expect(scope.text()).toContain('用户 login-log-fail');
    expect(scope.text()).toContain('时间');
    expect(wrapper.get('[data-testid="login-log-count"]').text()).toBe('1');
    expect(wrapper.get('[data-testid="login-log-table"]').text()).toContain('失败');
    expect(wrapper.get('[data-testid="login-log-table"]').text()).not.toContain('成功');
    expect(wrapper.get('[data-testid="audit-log-table"]').text()).toContain('登录失败');
    expect(wrapper.get('[data-testid="audit-log-table"]').text()).toContain('登录成功');
    wrapper.unmount();
  });

  it('says there is no matching login when the filter is empty', async () => {
    httpGet.mockImplementation((url: string) => {
      if (url.startsWith('/login-logs')) return Promise.resolve({ data: { items: [], total: 0 } });
      return Promise.resolve({ data: { items: [successAudit] } });
    });
    const { wrapper } = await mountView({ username: 'login-log-fail' });

    expect(wrapper.get('[data-testid="login-log-scope"]').text()).toContain('用户 login-log-fail');
    expect(wrapper.get('[data-testid="login-log-count"]').text()).toBe('0');
    expect(wrapper.get('[data-testid="login-log-empty"]').text()).toBe('没有符合条件的登录日志。');
    expect(wrapper.find('[data-testid="login-log-table"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('暂无登录日志');
    expect(wrapper.get('[data-testid="audit-log-table"]').text()).toContain('登录成功');
    wrapper.unmount();
  });

  it('says there are no login logs when the unfiltered list is empty', async () => {
    httpGet.mockResolvedValue({ data: { items: [], total: 0 } });
    const { wrapper } = await mountView();
    expect(wrapper.get('[data-testid="login-log-empty"]').text()).toBe('暂无登录日志。');
    expect(wrapper.find('[data-testid="login-log-scope"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('does not request login logs when the address time window is invalid', async () => {
    httpGet.mockResolvedValue({ data: { items: [successAudit] } });
    const { wrapper } = await mountView({
      from: 'not-a-time',
      to: '2026-10-15T00:00:00.000Z',
    });

    expect(wrapper.get('[data-testid="login-log-time-error"]').text()).toBe('时间筛选无效');
    expect(httpGet.mock.calls.filter((call) => call[0] === '/login-logs')).toHaveLength(0);
    expect(httpGet).toHaveBeenCalledWith('/audit-logs', { params: { pageSize: '100' } });
    expect(wrapper.find('[data-testid="login-log-table"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="login-log-empty"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="audit-log-table"]').text()).toContain('登录成功');
    wrapper.unmount();
  });

  it('drops the login table when the start is after the end', async () => {
    httpGet.mockImplementation((url: string) => {
      if (url.startsWith('/login-logs')) {
        return Promise.resolve({ data: { items: [successLogin, failureLogin], total: 2 } });
      }
      return Promise.resolve({ data: { items: [successAudit] } });
    });
    const { wrapper } = await mountView();
    expect(wrapper.find('[data-testid="login-log-table"]').exists()).toBe(true);

    await wrapper.get('[data-testid="login-log-from"]').setValue('2026-10-15T18:00');
    await wrapper.get('[data-testid="login-log-to"]').setValue('2026-10-15T08:00');
    await wrapper.get('form[data-testid="login-log-filters"]').trigger('submit');
    await flushPromises();

    expect(wrapper.get('[data-testid="login-log-time-error"]').text()).toBe('时间筛选无效');
    expect(wrapper.find('[data-testid="login-log-table"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('没有符合条件的登录日志');
    expect(wrapper.text()).not.toContain('暂无登录日志');
    expect(wrapper.get('[data-testid="audit-log-table"]').text()).toContain('登录成功');
    wrapper.unmount();
  });

  it('writes the operation-audit filters into the address and leaves the login filters', async () => {
    httpGet.mockResolvedValue({ data: { items: [], total: 0 } });
    const { wrapper, router } = await mountView({ username: 'admin' });

    const from = '2026-10-15T01:00';
    const to = '2026-10-15T05:00';
    await wrapper.get('[data-testid="audit-log-username"]').setValue('audit-action-old');
    await wrapper.get('[data-testid="audit-log-from"]').setValue(from);
    await wrapper.get('[data-testid="audit-log-to"]').setValue(to);
    await wrapper.get('form[data-testid="audit-log-filters"]').trigger('submit');
    await flushPromises();

    expect(router.currentRoute.value.query.username).toBe('admin');
    expect(router.currentRoute.value.query.auditUsername).toBe('audit-action-old');
    expect(router.currentRoute.value.query.auditFrom).toBe(new Date(from).toISOString());
    expect(router.currentRoute.value.query.auditTo).toBe(new Date(to).toISOString());
    expect(httpGet).toHaveBeenCalledWith('/audit-logs', {
      params: {
        pageSize: '100',
        username: 'audit-action-old',
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
      },
    });
    expect(httpGet).toHaveBeenCalledWith('/login-logs', {
      params: { pageSize: '100', username: 'admin' },
    });

    await wrapper.get('[data-testid="audit-log-clear"]').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.query.username).toBe('admin');
    expect(router.currentRoute.value.query.auditUsername).toBeUndefined();
    expect(router.currentRoute.value.query.auditFrom).toBeUndefined();
    expect(router.currentRoute.value.query.auditTo).toBeUndefined();
    const auditCalls = httpGet.mock.calls.filter((call) => call[0] === '/audit-logs');
    expect(auditCalls[auditCalls.length - 1]?.[1].params).toEqual({ pageSize: '100' });
    wrapper.unmount();
  });

  it('opens an operation-audit query and shows only the matching rows', async () => {
    const from = '2026-10-15T00:00:00.000Z';
    const to = '2026-10-15T02:00:00.000Z';
    httpGet.mockImplementation((url: string) => {
      if (url.startsWith('/login-logs')) {
        return Promise.resolve({ data: { items: [successLogin, failureLogin], total: 2 } });
      }
      return Promise.resolve({ data: { items: [failedAudit], total: 1 } });
    });
    const { wrapper } = await mountView({
      auditUsername: 'login-log-fail',
      auditFrom: from,
      auditTo: to,
    });

    expect(httpGet).toHaveBeenCalledWith('/audit-logs', {
      params: {
        pageSize: '100',
        username: 'login-log-fail',
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
      },
    });
    expect(httpGet).toHaveBeenCalledWith('/login-logs', { params: { pageSize: '100' } });
    const scope = wrapper.get('[data-testid="audit-log-scope"]');
    expect(scope.text()).toContain('用户 login-log-fail');
    expect(scope.text()).toContain('时间');
    expect(wrapper.get('[data-testid="audit-log-count"]').text()).toBe('1');
    expect(wrapper.get('[data-testid="audit-log-table"]').text()).toContain('登录失败');
    expect(wrapper.get('[data-testid="audit-log-table"]').text()).not.toContain('登录成功');
    expect(wrapper.get('[data-testid="login-log-table"]').text()).toContain('成功');
    expect(wrapper.get('[data-testid="login-log-table"]').text()).toContain('失败');
    wrapper.unmount();
  });

  it('says there is no matching operation audit when the filter is empty', async () => {
    httpGet.mockImplementation((url: string) => {
      if (url.startsWith('/audit-logs')) return Promise.resolve({ data: { items: [], total: 0 } });
      return Promise.resolve({ data: { items: [successLogin], total: 1 } });
    });
    const { wrapper } = await mountView({ auditUsername: 'audit-action-old' });

    expect(wrapper.get('[data-testid="audit-log-scope"]').text()).toContain('用户 audit-action-old');
    expect(wrapper.get('[data-testid="audit-log-count"]').text()).toBe('0');
    expect(wrapper.get('[data-testid="audit-log-empty"]').text()).toBe('没有符合条件的操作审计。');
    expect(wrapper.find('[data-testid="audit-log-table"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('暂无操作审计');
    expect(wrapper.get('[data-testid="login-log-table"]').text()).toContain('成功');
    wrapper.unmount();
  });

  it('says there is no operation audit when the unfiltered list is empty', async () => {
    httpGet.mockResolvedValue({ data: { items: [], total: 0 } });
    const { wrapper } = await mountView();
    expect(wrapper.get('[data-testid="audit-log-empty"]').text()).toBe('暂无操作审计。');
    expect(wrapper.find('[data-testid="audit-log-scope"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('does not request operation audits when the address time window is invalid', async () => {
    httpGet.mockImplementation((url: string) => {
      if (url.startsWith('/login-logs')) {
        return Promise.resolve({ data: { items: [successLogin], total: 1 } });
      }
      return Promise.resolve({ data: { items: [successAudit], total: 1 } });
    });
    const { wrapper } = await mountView({
      auditFrom: 'not-a-time',
      auditTo: '2026-10-15T00:00:00.000Z',
    });

    expect(wrapper.get('[data-testid="audit-log-time-error"]').text()).toBe('时间筛选无效');
    expect(httpGet.mock.calls.filter((call) => call[0] === '/audit-logs')).toHaveLength(0);
    expect(httpGet).toHaveBeenCalledWith('/login-logs', { params: { pageSize: '100' } });
    expect(wrapper.find('[data-testid="audit-log-table"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="audit-log-empty"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="login-log-table"]').text()).toContain('成功');
    wrapper.unmount();
  });

  it('drops the operation-audit table when the start is after the end', async () => {
    httpGet.mockImplementation((url: string) => {
      if (url.startsWith('/login-logs')) {
        return Promise.resolve({ data: { items: [successLogin], total: 1 } });
      }
      return Promise.resolve({ data: { items: [successAudit, failedAudit], total: 2 } });
    });
    const { wrapper } = await mountView();
    expect(wrapper.find('[data-testid="audit-log-table"]').exists()).toBe(true);

    await wrapper.get('[data-testid="audit-log-from"]').setValue('2026-10-15T18:00');
    await wrapper.get('[data-testid="audit-log-to"]').setValue('2026-10-15T08:00');
    await wrapper.get('form[data-testid="audit-log-filters"]').trigger('submit');
    await flushPromises();

    expect(wrapper.get('[data-testid="audit-log-time-error"]').text()).toBe('时间筛选无效');
    expect(wrapper.find('[data-testid="audit-log-table"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('没有符合条件的操作审计');
    expect(wrapper.text()).not.toContain('暂无操作审计');
    expect(wrapper.get('[data-testid="login-log-table"]').text()).toContain('成功');
    wrapper.unmount();
  });
});
