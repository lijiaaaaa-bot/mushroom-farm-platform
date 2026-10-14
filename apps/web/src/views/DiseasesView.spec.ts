import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shanghaiStamp } from '../disease-level';
import DiseasesView from './DiseasesView.vue';

const httpGet = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: { get: httpGet },
  errorText: () => '请求失败',
}));

const withSnapshot = {
  id: 'd-1',
  shedCode: 'S01',
  cameraCode: 'CAM-S01-01',
  recognizedAt: '2026-09-23T01:02:00.000Z',
  diseaseLevel: 2,
  diseaseCount: 3,
  snapshotObjectKey: 'snapshots/S01/2026-09-23/CAM-S01-01/1.jpg',
  snapshotUrl: null,
};

const withoutSnapshot = {
  id: 'd-2',
  shedCode: 'S02',
  cameraCode: 'CAM-S02-01',
  recognizedAt: '2026-09-23T02:02:00.000Z',
  diseaseLevel: 1,
  diseaseCount: 1,
  snapshotObjectKey: null,
  snapshotUrl: null,
};

async function mountView(query: Record<string, string> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/diseases', component: DiseasesView },
      { path: '/diseases/:id', component: { template: '<div />' } },
    ],
  });
  await router.push({ path: '/diseases', query });
  await router.isReady();
  const wrapper = mount(DiseasesView, { global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router };
}

describe('DiseasesView', () => {
  beforeEach(() => {
    httpGet.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows error text without the empty copy when the disease list fails', async () => {
    httpGet.mockRejectedValue(new Error('down'));
    const { wrapper } = await mountView();

    expect(httpGet).toHaveBeenCalledWith('/diseases', { params: { pageSize: '50' } });
    expect(wrapper.text()).toContain('请求失败');
    expect(wrapper.text()).not.toContain('暂无病害记录');
    expect(wrapper.text()).not.toContain('没有符合条件的病害记录');
    expect(wrapper.find('[data-testid="disease-list"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows peak counts from buckets beside the recognition archive', async () => {
    httpGet.mockImplementation((url: string) => {
      if (url === '/diseases/peaks') {
        return Promise.resolve({
          data: {
            grain: 'hour',
            byTime: [{ bucketStart: '2026-09-24T03:00:00.000Z', diseaseCount: 4 }],
            byShed: [{ shedCode: 'S01', diseaseCount: 4 }],
            peak: { bucketStart: '2026-09-24T03:00:00.000Z', diseaseCount: 4 },
          },
        });
      }
      return Promise.resolve({ data: { items: [withSnapshot], total: 1 } });
    });
    const { wrapper } = await mountView();
    expect(httpGet).toHaveBeenCalledWith('/diseases/peaks');
    expect(wrapper.get('[data-testid="disease-peaks"]').text()).toContain('S01');
    expect(wrapper.get('[data-testid="disease-peaks"]').text()).toContain('4');
    expect(wrapper.get('[data-field="count"]').text()).toBe('3');
    wrapper.unmount();
  });

  it('shows empty copy when the disease list has no rows', async () => {
    httpGet.mockResolvedValue({ data: { items: [], total: 0 } });
    const { wrapper } = await mountView();

    expect(wrapper.get('[data-testid="disease-empty"]').text()).toBe('暂无病害记录。');
    expect(wrapper.find('[data-testid="disease-list"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('lists time, shed, location and level, and opens the detail path', async () => {
    httpGet.mockImplementation((url: string) => {
      if (url === '/diseases/peaks') {
        return Promise.resolve({ data: { byTime: [], byShed: [], peak: null, grain: 'hour' } });
      }
      return Promise.resolve({ data: { items: [withSnapshot, withoutSnapshot] } });
    });
    const { wrapper } = await mountView();
    const table = wrapper.get('[data-testid="disease-list"]');
    const rows = table.findAll('tbody tr');

    expect(rows).toHaveLength(2);
    expect(rows[0].get('[data-field="time"]').text()).toBe(shanghaiStamp(withSnapshot.recognizedAt));
    expect(rows[0].get('[data-field="shed"]').text()).toBe('S01');
    expect(rows[0].get('[data-field="location"]').text()).toBe('CAM-S01-01');
    expect(rows[0].get('[data-field="level"]').text()).toBe('中度（2）');
    expect(rows[0].get('[data-field="count"]').text()).toBe('3');
    expect(rows[0].text()).toContain('有图');
    expect(rows[1].get('[data-field="level"]').text()).toBe('轻度（1）');
    expect(rows[1].text()).toContain('无图');
    expect(rows[0].get('[data-testid="disease-open"]').attributes('href')).toBe('/diseases/d-1');
    expect(rows[1].get('[data-testid="disease-open"]').attributes('href')).toBe('/diseases/d-2');
    wrapper.unmount();
  });

  it('queries by shed, location, time and disease level', async () => {
    httpGet.mockResolvedValue({ data: { items: [] } });
    const { wrapper, router } = await mountView({ shedCode: 'S01' });
    await wrapper.get('[data-testid="disease-camera"]').setValue('CAM-DIS-01');
    await wrapper.get('[data-testid="disease-from"]').setValue('2026-10-14T09:00');
    await wrapper.get('[data-testid="disease-to"]').setValue('2026-10-14T10:00');
    await wrapper.get('[data-testid="disease-level"]').setValue('1');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(router.currentRoute.value.query.shedCode).toBe('S01');
    expect(router.currentRoute.value.query.cameraCode).toBe('CAM-DIS-01');
    expect(router.currentRoute.value.query.diseaseLevel).toBe('1');
    expect(httpGet).toHaveBeenCalledWith('/diseases', {
      params: {
        pageSize: '50',
        shedCode: 'S01',
        cameraCode: 'CAM-DIS-01',
        from: new Date('2026-10-14T09:00').toISOString(),
        to: new Date('2026-10-14T10:00').toISOString(),
        diseaseLevel: '1',
      },
    });
    expect(wrapper.get('[data-testid="disease-empty"]').text()).toBe('没有符合条件的病害记录。');
    expect(wrapper.text()).not.toContain('暂无病害记录。');
    wrapper.unmount();
  });

  it('keeps the detail link on the active filter', async () => {
    httpGet.mockResolvedValue({ data: { items: [withSnapshot] } });
    const { wrapper } = await mountView({ cameraCode: 'CAM-S01-01', diseaseLevel: '2' });

    expect(wrapper.get('[data-testid="disease-open"]').attributes('href')).toBe(
      '/diseases/d-1?cameraCode=CAM-S01-01&diseaseLevel=2',
    );
    wrapper.unmount();
  });

  it('clears the filter and loads the recent list again', async () => {
    httpGet.mockResolvedValue({ data: { items: [] } });
    const { wrapper, router } = await mountView({ cameraCode: 'CAM-DIS-01', diseaseLevel: '3' });
    await wrapper.get('[data-testid="disease-clear"]').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.query.cameraCode).toBeUndefined();
    expect(router.currentRoute.value.query.diseaseLevel).toBeUndefined();
    const calls = httpGet.mock.calls.filter((call) => call[0] === '/diseases');
    expect(calls[calls.length - 1]?.[1]).toEqual({ params: { pageSize: '50' } });
    wrapper.unmount();
  });

  it('rejects an invalid time filter without showing an empty list', async () => {
    httpGet.mockResolvedValue({ data: { items: [], byTime: [] } });
    const { wrapper } = await mountView({ from: 'not-a-time' });

    expect(httpGet.mock.calls.some((call) => call[0] === '/diseases')).toBe(false);
    expect(wrapper.get('[data-testid="disease-filter-error"]').text()).toBe('时间筛选无效');
    expect(wrapper.text()).not.toContain('暂无病害记录。');
    expect(wrapper.text()).not.toContain('没有符合条件的病害记录。');
    expect(wrapper.find('[data-testid="disease-list"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
