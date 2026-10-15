import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BackupView from './BackupView.vue';

const httpGet = vi.hoisted(() => vi.fn());
const httpPost = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: { get: httpGet, post: httpPost },
  errorText: (cause: unknown) =>
    cause instanceof Error && cause.message !== '403' ? cause.message : '请求失败',
}));

const empty = {
  lastSuccessAt: null,
  lastRunAt: null,
  lastStatus: 'never' as const,
  lastFileName: null,
  lastBytes: null,
  lastError: null,
  triggeredBy: null,
};

const success = {
  lastSuccessAt: '2026-10-15T03:00:00.000Z',
  lastRunAt: '2026-10-15T03:00:00.000Z',
  lastStatus: 'success' as const,
  lastFileName: 'mushroom-20261015T030000Z.sql',
  lastBytes: 128,
  lastError: null,
  triggeredBy: 'admin',
};

function shanghai(value: string) {
  return new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

describe('BackupView', () => {
  beforeEach(() => {
    httpGet.mockReset();
    httpPost.mockReset();
  });

  it('shows 尚未成功备份 when no run has been recorded', async () => {
    httpGet.mockResolvedValue({ data: empty });
    const wrapper = mount(BackupView);
    await flushPromises();

    expect(httpGet).toHaveBeenCalledWith('/backups/status');
    expect(wrapper.text()).toContain('数据备份');
    expect(wrapper.get('[data-field="lastSuccessAt"]').text()).toBe('尚未成功备份');
    expect(wrapper.get('[data-field="lastStatus"]').attributes('data-status')).toBe('never');
    expect(wrapper.text()).toContain('尚未运行');
    expect(wrapper.text()).toContain('立即备份');
    expect(wrapper.find('[data-testid="backup-notice"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows the request error instead of an empty success time', async () => {
    httpGet.mockRejectedValue(new Error('403'));
    const wrapper = mount(BackupView);
    await flushPromises();
    expect(wrapper.text()).toContain('请求失败');
    expect(wrapper.text()).not.toContain('尚未成功备份');
    expect(wrapper.find('[data-field="lastSuccessAt"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('replaces 尚未成功备份 with the new success time after 立即备份', async () => {
    httpGet.mockResolvedValue({ data: empty });
    httpPost.mockResolvedValue({ data: success });
    const wrapper = mount(BackupView);
    await flushPromises();

    await wrapper.get('[data-testid="backup-run"]').trigger('click');
    await flushPromises();

    expect(httpPost).toHaveBeenCalledWith('/backups/run');
    expect(wrapper.get('[data-field="lastSuccessAt"]').attributes('data-at')).toBe(success.lastSuccessAt);
    expect(wrapper.get('[data-field="lastSuccessAt"]').text()).toBe(shanghai(success.lastSuccessAt));
    expect(wrapper.get('[data-field="lastStatus"]').attributes('data-status')).toBe('success');
    expect(wrapper.get('[data-field="lastFileName"]').text()).toBe(success.lastFileName);
    expect(wrapper.text()).toContain('128 字节');
    expect(wrapper.text()).toContain('admin');
    expect(wrapper.get('[data-testid="backup-notice"]').text()).toBe(
      `本次备份成功。最近成功时间是 ${shanghai(success.lastSuccessAt)}。`,
    );
    wrapper.unmount();
  });

  it('keeps the previous success time visible when the new run fails', async () => {
    httpGet.mockResolvedValue({ data: success });
    const failed = {
      ...success,
      lastRunAt: '2026-10-15T04:00:00.000Z',
      lastStatus: 'failed' as const,
      lastFileName: 'mushroom-20261015T040000Z.sql',
      lastBytes: null,
      lastError: '找不到 pg_dump 或 docker。未写出备份。',
    };
    httpPost.mockResolvedValue({ data: failed });
    const wrapper = mount(BackupView);
    await flushPromises();
    expect(wrapper.get('[data-field="lastSuccessAt"]').text()).toBe(shanghai(success.lastSuccessAt));

    await wrapper.get('[data-testid="backup-run"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-field="lastSuccessAt"]').attributes('data-at')).toBe(success.lastSuccessAt);
    expect(wrapper.get('[data-field="lastStatus"]').attributes('data-status')).toBe('failed');
    expect(wrapper.get('[data-testid="backup-notice"]').text()).toContain('本次备份失败');
    expect(wrapper.get('[data-testid="backup-notice"]').text()).toContain(shanghai(success.lastSuccessAt));
    expect(wrapper.get('[data-field="lastError"]').text()).toContain('找不到 pg_dump');
    wrapper.unmount();
  });
});