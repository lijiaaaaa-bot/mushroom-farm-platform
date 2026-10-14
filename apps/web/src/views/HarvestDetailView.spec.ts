import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shanghaiStamp } from '../disease-level';
import HarvestDetailView from './HarvestDetailView.vue';

const httpGet = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: { get: httpGet },
  errorText: (error: { response?: { data?: { message?: string } } }) =>
    error.response?.data?.message || '请求失败',
}));

const row = {
  id: 'rec-1',
  shedCode: 'S01',
  cameraCode: 'CAM-HAR-01',
  recognizedAt: '2026-10-14T01:02:00.000Z',
  matureCount: 5,
  mushroomCount: 12,
  avgCapDiameter: 4.7,
};

async function mountView(id = 'rec-1', query: Record<string, string> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/harvest', component: { template: '<div />' } },
      { path: '/harvest/:id', component: HarvestDetailView },
    ],
  });
  await router.push({ path: `/harvest/${id}`, query });
  await router.isReady();
  const wrapper = mount(HarvestDetailView, { global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router };
}

describe('HarvestDetailView', () => {
  beforeEach(() => {
    httpGet.mockReset();
  });

  it('shows the harvest fields and returns to the filtered list', async () => {
    httpGet.mockResolvedValue({ data: row });
    const { wrapper } = await mountView('rec-1', {
      date: '2026-10-14',
      cameraCode: 'CAM-HAR-01',
    });

    expect(httpGet).toHaveBeenCalledWith('/harvest/daily/rec-1');
    const detail = wrapper.get('[data-testid="harvest-detail"]');
    expect(detail.get('[data-field="time"]').text()).toBe(shanghaiStamp(row.recognizedAt));
    expect(detail.get('[data-field="shed"]').text()).toBe('S01');
    expect(detail.get('[data-field="camera"]').text()).toBe('CAM-HAR-01');
    expect(detail.get('[data-field="mature"]').text()).toBe('5');
    expect(detail.get('[data-field="mushroom"]').text()).toBe('12');
    expect(detail.get('[data-field="diameter"]').text()).toBe('4.7');
    expect(wrapper.get('[data-testid="harvest-back"]').attributes('href')).toBe(
      '/harvest?date=2026-10-14&cameraCode=CAM-HAR-01',
    );
    wrapper.unmount();
  });

  it('returns to the shed and time window', async () => {
    httpGet.mockResolvedValue({ data: row });
    const { wrapper } = await mountView('rec-1', {
      shedCode: 'S01',
      from: '2026-10-14T00:00:00.000Z',
      to: '2026-10-14T05:00:00.000Z',
    });

    expect(wrapper.get('[data-testid="harvest-back"]').attributes('href')).toBe(
      '/harvest?shedCode=S01&from=2026-10-14T00:00:00.000Z&to=2026-10-14T05:00:00.000Z',
    );
    wrapper.unmount();
  });

  it('writes a dash when the cap diameter is missing', async () => {
    httpGet.mockResolvedValue({ data: { ...row, avgCapDiameter: null } });
    const { wrapper } = await mountView();
    expect(wrapper.get('[data-field="diameter"]').text()).toBe('—');
    wrapper.unmount();
  });

  it('shows the missing-record error', async () => {
    httpGet.mockRejectedValue({ response: { data: { message: '采摘记录不存在' } } });
    const { wrapper } = await mountView('missing');
    expect(wrapper.get('[data-testid="harvest-detail-error"]').text()).toBe('采摘记录不存在');
    expect(wrapper.find('[data-testid="harvest-detail"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
