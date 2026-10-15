import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ShedLiveStatsView from './ShedLiveStatsView.vue';

const httpGet = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: { get: httpGet },
  errorText: () => '请求失败',
}));

const sheds = [
  { code: 'S01', name: '一号棚' },
  { code: 'S02', name: '二号棚' },
];

const live = {
  shedCode: 'S01',
  cameraCode: 'CAM-SLS-01',
  available: true,
  mushroomCount: 20,
  matureCount: 8,
  pendingMatureCount: 12,
  diseaseCount: 2,
  basis: 'latest_per_camera',
};

function mockLive(payload: unknown = live) {
  httpGet.mockImplementation((url: string) => {
    if (url === '/sheds') return Promise.resolve({ data: sheds });
    if (url === '/growth-trends/live') return Promise.resolve({ data: payload });
    return Promise.resolve({ data: {} });
  });
}

async function mountView(query: Record<string, string> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/shed-live-stats', component: ShedLiveStatsView }],
  });
  await router.push({ path: '/shed-live-stats', query });
  const wrapper = mount(ShedLiveStatsView, { global: { plugins: [router] } });
  await flushPromises();
  await flushPromises();
  return { wrapper, router };
}

describe('ShedLiveStatsView', () => {
  beforeEach(() => {
    httpGet.mockReset();
  });

  it('shows the four counts for one camera on the same screen', async () => {
    mockLive();
    const { wrapper } = await mountView({ shedCode: 'S01', cameraCode: 'CAM-SLS-01' });

    expect(httpGet).toHaveBeenCalledWith('/growth-trends/live', {
      params: { shedCode: 'S01', cameraCode: 'CAM-SLS-01' },
    });
    expect(httpGet).not.toHaveBeenCalledWith('/growth-trends', expect.anything());
    expect(httpGet).not.toHaveBeenCalledWith('/diseases/trends', expect.anything());
    expect(httpGet).not.toHaveBeenCalledWith('/diseases/peaks', expect.anything());
    expect(wrapper.get('[data-testid="live-stats-scope"]').text()).toContain('棚区 S01');
    expect(wrapper.get('[data-testid="live-stats-scope"]').text()).toContain('CAM-SLS-01');
    expect(wrapper.get('[data-testid="live-stats-note"]').text()).toBe(
      '蘑菇 20 · 成熟 8 · 待成熟 12 · 病害 2',
    );
    expect(wrapper.get('[data-testid="live-stats-mushroom"]').text()).toBe('20');
    expect(wrapper.get('[data-testid="live-stats-mature"]').text()).toBe('8');
    expect(wrapper.get('[data-testid="live-stats-pending"]').text()).toBe('12');
    expect(wrapper.get('[data-testid="live-stats-disease"]').text()).toBe('2');
    expect(wrapper.text()).toContain('蘑菇数');
    expect(wrapper.text()).toContain('成熟数');
    expect(wrapper.text()).toContain('待成熟');
    expect(wrapper.text()).toContain('病害数');
    expect(wrapper.find('[data-testid="live-stats-empty"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('sums the shed when no camera is selected', async () => {
    mockLive({
      shedCode: 'S01',
      cameraCode: null,
      available: true,
      mushroomCount: 25,
      matureCount: 17,
      pendingMatureCount: 8,
      diseaseCount: 3,
    });
    const { wrapper } = await mountView({ shedCode: 'S01' });
    expect(httpGet).toHaveBeenCalledWith('/growth-trends/live', {
      params: { shedCode: 'S01' },
    });
    expect(wrapper.get('[data-testid="live-stats-scope"]').text()).toContain('各摄像头汇总');
    expect(wrapper.get('[data-testid="live-stats-note"]').text()).toBe(
      '蘑菇 25 · 成熟 17 · 待成熟 8 · 病害 3',
    );
    wrapper.unmount();
  });

  it('writes dashes and the empty line when the shed has no live point', async () => {
    mockLive({
      shedCode: 'S01',
      cameraCode: 'CAM-SLS-NONE',
      available: false,
      mushroomCount: null,
      matureCount: null,
      pendingMatureCount: null,
      diseaseCount: null,
    });
    const { wrapper } = await mountView({ shedCode: 'S01', cameraCode: 'CAM-SLS-NONE' });
    expect(wrapper.get('[data-testid="live-stats-empty"]').text()).toBe('该棚暂无实时生长数据。');
    expect(wrapper.get('[data-testid="live-stats-mushroom"]').text()).toBe('—');
    expect(wrapper.get('[data-testid="live-stats-mature"]').text()).toBe('—');
    expect(wrapper.get('[data-testid="live-stats-pending"]').text()).toBe('—');
    expect(wrapper.get('[data-testid="live-stats-disease"]').text()).toBe('—');
    expect(wrapper.find('[data-testid="live-stats-note"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows zero pending when the mushroom count is zero', async () => {
    mockLive({
      shedCode: 'S01',
      cameraCode: 'CAM-ZERO',
      available: true,
      mushroomCount: 0,
      matureCount: 3,
      pendingMatureCount: 0,
      diseaseCount: 0,
    });
    const { wrapper } = await mountView({ shedCode: 'S01', cameraCode: 'CAM-ZERO' });
    expect(wrapper.get('[data-testid="live-stats-mushroom"]').text()).toBe('0');
    expect(wrapper.get('[data-testid="live-stats-pending"]').text()).toBe('0');
    expect(wrapper.get('[data-testid="live-stats-note"]').text()).toContain('待成熟 0');
    wrapper.unmount();
  });
});
