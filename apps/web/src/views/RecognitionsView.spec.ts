import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RecognitionsView from './RecognitionsView.vue';

const httpGet = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: { get: httpGet },
  errorText: () => '请求失败',
}));

const withSnapshot = {
  id: 'r-1',
  shedCode: 'S01',
  cameraCode: 'CAM-S01-01',
  recognizedAt: '2026-09-23T01:02:00.000Z',
  mushroomCount: 10,
  matureCount: 4,
  diseaseCount: 0,
  source: 'http',
  snapshotObjectKey: null,
  snapshotUrl: 'https://example.test/shot.jpg',
};

const withoutSnapshot = {
  id: 'r-2',
  shedCode: 'S01',
  cameraCode: 'CAM-S01-02',
  recognizedAt: '2026-09-23T02:02:00.000Z',
  mushroomCount: 8,
  matureCount: 1,
  diseaseCount: 0,
  source: 'mqtt',
  snapshotObjectKey: null,
  snapshotUrl: null,
};

describe('RecognitionsView snapshots', () => {
  beforeEach(() => {
    httpGet.mockReset();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:recognition');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders an image caption card and opens the stored snapshot', async () => {
    httpGet.mockImplementation((url: string) => {
      if (String(url).includes('/snapshot')) {
        return Promise.resolve({ data: new Blob(['jpeg'], { type: 'image/jpeg' }) });
      }
      return Promise.resolve({ data: { items: [withSnapshot, withoutSnapshot] } });
    });
    const wrapper = mount(RecognitionsView);
    await flushPromises();
    const cards = wrapper.findAll('.result-card');

    expect(httpGet).toHaveBeenCalledWith('/ingest/recognitions?pageSize=50');
    expect(wrapper.find('.result-grid').exists()).toBe(true);
    expect(wrapper.find('table').exists()).toBe(false);
    expect(cards).toHaveLength(2);
    expect(cards[0].text()).toContain('成熟 4');
    expect(cards[0].text()).toContain('详情');
    expect(cards[0].get('img').attributes('src')).toBe('blob:recognition');
    expect(cards[1].text()).toContain('无抓拍');
    expect(cards[1].find('img').exists()).toBe(false);
    expect(cards[1].find('button').exists()).toBe(false);
    expect(httpGet).toHaveBeenCalledWith('/ingest/recognitions/r-1/snapshot', {
      responseType: 'blob',
    });

    await cards[0].get('button').trigger('click');
    expect(wrapper.findAll('img').length).toBeGreaterThan(1);
    wrapper.unmount();
  });
});
