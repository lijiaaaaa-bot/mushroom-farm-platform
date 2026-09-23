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

  it('shows who corrected which shed and the old to new counts', async () => {
    httpGet.mockResolvedValue({
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
    const wrapper = mount(AuditView);
    await flushPromises();

    expect(httpGet).toHaveBeenCalledWith('/audit-logs');
    expect(wrapper.text()).toContain('production_admin');
    expect(wrapper.text()).toContain('harvest.correct');
    expect(wrapper.text()).toContain('S01');
    expect(wrapper.text()).toContain('CAM-S01');
    expect(wrapper.text()).toContain('成熟数 4→6');
    wrapper.unmount();
  });
});
