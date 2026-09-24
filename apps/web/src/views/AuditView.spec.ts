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

    expect(httpGet).toHaveBeenCalledWith('/login-logs');
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
});
