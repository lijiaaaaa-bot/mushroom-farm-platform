import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

async function mountView() {
  const wrapper = mount(DiseasesView);
  await flushPromises();
  return wrapper;
}

describe('DiseasesView', () => {
  beforeEach(() => {
    httpGet.mockReset();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:snapshot');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows error text without the empty copy when the disease list fails', async () => {
    httpGet.mockRejectedValue(new Error('down'));
    const wrapper = await mountView();

    expect(httpGet).toHaveBeenCalledWith('/diseases?pageSize=50');
    expect(wrapper.text()).toContain('请求失败');
    expect(wrapper.text()).not.toContain('暂无病害记录');
    expect(wrapper.find('table').exists()).toBe(false);
    expect(wrapper.find('.result-card').exists()).toBe(false);
    expect(wrapper.find('img').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows empty copy when the disease list has no rows', async () => {
    httpGet.mockResolvedValue({ data: { items: [], total: 0 } });
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('暂无病害记录。');
    expect(wrapper.find('table').exists()).toBe(false);
    expect(wrapper.find('.result-card').exists()).toBe(false);
    wrapper.unmount();
  });

  it('renders an image caption card for a stored snapshot and plain text when there is none', async () => {
    httpGet.mockImplementation((url: string) => {
      if (String(url).includes('/snapshot')) {
        return Promise.resolve({ data: new Blob(['jpeg'], { type: 'image/jpeg' }) });
      }
      return Promise.resolve({ data: { items: [withSnapshot, withoutSnapshot] } });
    });
    const wrapper = await mountView();
    const cards = wrapper.findAll('.result-card');

    expect(wrapper.find('.result-grid').exists()).toBe(true);
    expect(wrapper.find('table').exists()).toBe(false);
    expect(wrapper.text()).toContain('S01');
    expect(wrapper.text()).toContain('CAM-S01-01');
    expect(wrapper.text()).toContain('病害 3');
    expect(wrapper.text()).toContain('等级 2');
    expect(cards[0].text()).toContain('详情');
    expect(cards[0].get('img').attributes('src')).toBe('blob:snapshot');
    expect(cards[1].text()).toContain('无抓拍');
    expect(cards[1].find('img').exists()).toBe(false);
    expect(cards[1].find('button').exists()).toBe(false);
    expect(httpGet).toHaveBeenCalledWith('/ingest/recognitions/d-1/snapshot', {
      responseType: 'blob',
    });

    await cards[0].get('button').trigger('click');
    expect(wrapper.findAll('img').length).toBeGreaterThan(1);
    wrapper.unmount();
  });

  it('shows an error instead of an image when the snapshot request fails', async () => {
    httpGet.mockImplementation((url: string) => {
      if (String(url).includes('/snapshot')) return Promise.reject(new Error('down'));
      return Promise.resolve({ data: { items: [withSnapshot] } });
    });
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('请求失败');
    expect(wrapper.find('img').exists()).toBe(false);
    wrapper.unmount();
  });
});
