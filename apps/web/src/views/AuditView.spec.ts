import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AuditView from './AuditView.vue';

const httpGet = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: { get: httpGet },
  errorText: () => '请求失败',
}));

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
    const wrapper = mount(AuditView);
    await flushPromises();

    const loginCall = httpGet.mock.calls.find((call) => call[0] === '/login-logs');
    expect(loginCall?.[1].params).toEqual({
      username: undefined,
      from: undefined,
      to: undefined,
    });
    expect(httpGet).toHaveBeenCalledWith('/audit-logs');
    expect(wrapper.text()).toContain('admin');
    expect(wrapper.text()).toContain('失败');
    expect(wrapper.text()).toContain('10.0.0.8');
    expect(wrapper.text()).toContain('shed-console/1');
    expect(wrapper.text()).toContain('production_admin');
    expect(wrapper.text()).toContain('harvest.correct');
    expect(wrapper.text()).toContain('S01');
    expect(wrapper.text()).toContain('CAM-S01');
    expect(wrapper.text()).toContain('成熟数 4→6');
    wrapper.unmount();
  });

  it('shows the demo login failure in both sections', async () => {
    httpGet.mockImplementation((url: string) => {
      if (url.startsWith('/login-logs')) {
        return Promise.resolve({
          data: {
            items: [
              {
                id: 'login-demo',
                username: 'audit-demo',
                result: 'failure',
                ip: '127.0.0.1',
                userAgent: 'audit-log-demo/1',
                createdAt: '2026-10-14T03:00:00.000Z',
              },
              {
                id: 'login-admin',
                username: 'admin',
                result: 'success',
                ip: '127.0.0.1',
                userAgent: 'audit-log-demo/1',
                createdAt: '2026-10-14T02:59:00.000Z',
              },
            ],
          },
        });
      }
      return Promise.resolve({
        data: {
          items: [
            {
              id: 'audit-failed',
              username: null,
              action: 'auth.login_failed',
              resource: 'auth',
              createdAt: '2026-10-14T03:00:00.000Z',
              detail: { username: 'audit-demo' },
            },
            {
              id: 'audit-ok',
              username: 'admin',
              action: 'auth.login',
              resource: 'auth',
              createdAt: '2026-10-14T02:59:00.000Z',
              detail: null,
            },
          ],
        },
      });
    });
    const wrapper = mount(AuditView);
    await flushPromises();
    expect(wrapper.text()).toContain('登录日志');
    expect(wrapper.text()).toContain('操作审计');
    expect(wrapper.text()).toContain('audit-demo');
    expect(wrapper.text()).toContain('失败');
    expect(wrapper.text()).toContain('audit-log-demo/1');
    expect(wrapper.text()).toContain('登录失败');
    expect(wrapper.text()).toContain('登录成功');
    expect(wrapper.text()).toContain('admin');
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
    const wrapper = mount(AuditView);
    await flushPromises();
    expect(wrapper.text()).toContain('请求失败');
    expect(wrapper.text()).toContain('harvest.correct');
    wrapper.unmount();
  });

  it('sends username, from, and to when set and omits them when blank', async () => {
    httpGet.mockResolvedValue({ data: { items: [] } });
    const wrapper = mount(AuditView);
    await flushPromises();

    await wrapper.get('[data-testid="login-log-username"]').setValue('admin');
    await wrapper.get('[data-testid="login-log-from"]').setValue('2026-09-01');
    await wrapper.get('[data-testid="login-log-to"]').setValue('2026-09-30');
    await wrapper.get('form[data-testid="login-log-filters"]').trigger('submit');
    await flushPromises();

    expect(httpGet).toHaveBeenCalledWith('/login-logs', {
      params: {
        username: 'admin',
        from: '2026-09-01',
        to: '2026-09-30',
      },
    });

    await wrapper.get('[data-testid="login-log-username"]').setValue('');
    await wrapper.get('[data-testid="login-log-from"]').setValue('');
    await wrapper.get('[data-testid="login-log-to"]').setValue('');
    await wrapper.get('form[data-testid="login-log-filters"]').trigger('submit');
    await flushPromises();

    const loginCalls = httpGet.mock.calls.filter((call) => call[0] === '/login-logs');
    const blank = loginCalls[loginCalls.length - 1];
    expect(blank?.[1].params.username).toBeUndefined();
    expect(blank?.[1].params.from).toBeUndefined();
    expect(blank?.[1].params.to).toBeUndefined();
    wrapper.unmount();
  });
});
