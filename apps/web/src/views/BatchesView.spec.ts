import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { currentUser, type SessionUser } from '../auth';
import BatchesView from './BatchesView.vue';

const httpGet = vi.hoisted(() => vi.fn());
const httpPost = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: {
    get: httpGet,
    post: httpPost,
  },
  errorText: () => '请求失败',
}));

function asUser(role: SessionUser['role']) {
  currentUser.value = {
    id: 'user-1',
    username: role,
    displayName: role,
    role,
    shedCodes: ['S01'],
  };
}

const batch = {
  id: 'batch-1',
  shedCode: 'S01',
  batchCode: 'B-0901',
  startedAt: '2026-09-01T00:00:00.000Z',
  phase: 'mature' as const,
  closedAt: null,
  note: null,
};

describe('BatchesView', () => {
  beforeEach(() => {
    currentUser.value = null;
    httpGet.mockReset();
    httpPost.mockReset();
  });

  it('creates a batch and replays phases with the bucket curve', async () => {
    asUser('production_admin');
    httpGet.mockImplementation((url: string) => {
      if (String(url).includes('/replay')) {
        return Promise.resolve({
          data: {
            batch,
            phases: [
              { id: 'e1', phase: 'flush', occurredAt: '2026-09-01T00:00:00.000Z', note: null, recordedBy: 'admin' },
              { id: 'e2', phase: 'fast_growth', occurredAt: '2026-09-05T00:00:00.000Z', note: null, recordedBy: 'admin' },
              { id: 'e3', phase: 'mature', occurredAt: '2026-09-12T00:00:00.000Z', note: null, recordedBy: 'admin' },
            ],
            curve: [{ day: '2026-09-03', mushroomCount: 40, matureCount: 8, capDiameterMean: 3.2 }],
          },
        });
      }
      return Promise.resolve({ data: { items: [batch] } });
    });
    httpPost.mockResolvedValue({ data: { batch } });
    const wrapper = mount(BatchesView);
    await flushPromises();

    await wrapper.get('input[required]').setValue('B-0901');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(httpPost).toHaveBeenCalledWith(
      '/batches',
      expect.objectContaining({ shedCode: 'S01', batchCode: 'B-0901' }),
    );
    expect(wrapper.text()).toContain('B-0901');
    expect(wrapper.text()).toContain('成熟');

    await wrapper.get('button.btn-ghost').trigger('click');
    await flushPromises();
    const replay = wrapper.get('[data-testid="batch-replay"]');
    expect(replay.text()).toContain('出菇');
    expect(replay.text()).toContain('快速生长');
    expect(replay.text()).toContain('成熟');
    expect(wrapper.get('[data-testid="batch-curve"]').text()).toContain('2026-09-03');
    expect(wrapper.get('[data-testid="batch-curve"]').text()).toContain('40');
    wrapper.unmount();
  });

  it('shows the error and no empty table when the list fails', async () => {
    asUser('viewer');
    httpGet.mockRejectedValue(new Error('down'));
    const wrapper = mount(BatchesView);
    await flushPromises();
    expect(wrapper.text()).toContain('请求失败');
    expect(wrapper.text()).not.toContain('还没有批次');
    expect(wrapper.find('table').exists()).toBe(false);
    expect(wrapper.find('form').exists()).toBe(false);
    wrapper.unmount();
  });
});
