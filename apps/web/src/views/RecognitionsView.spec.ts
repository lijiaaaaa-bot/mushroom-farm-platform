import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
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

async function mountView(query: Record<string, string> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/recognitions', component: RecognitionsView }],
  });
  await router.push({ path: '/recognitions', query });
  const wrapper = mount(RecognitionsView, { global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router };
}

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
    const { wrapper } = await mountView();
    const cards = wrapper.findAll('.result-card');

    expect(httpGet).toHaveBeenCalledWith('/ingest/recognitions', { params: { pageSize: '50' } });
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

  it('passes a valid time window to the recognition list', async () => {
    httpGet.mockResolvedValue({ data: { items: [] } });
    const { wrapper } = await mountView({
      from: '2026-09-22T16:00:00.000Z',
      to: '2026-09-23T15:59:59.999Z',
      shedCode: 'S01',
      cameraCode: 'CAM-S01-01',
    });

    expect(httpGet).toHaveBeenCalledWith('/ingest/recognitions', {
      params: {
        pageSize: '50',
        from: '2026-09-22T16:00:00.000Z',
        to: '2026-09-23T15:59:59.999Z',
        shedCode: 'S01',
        cameraCode: 'CAM-S01-01',
      },
    });
    expect(wrapper.text()).toContain('筛选');
    expect(wrapper.text()).toContain('S01');
    expect(wrapper.get('[data-testid="recog-history-camera"]').element).toHaveProperty('value', 'CAM-S01-01');
    expect(wrapper.text()).toContain('没有符合条件的识别记录。');
    expect(wrapper.text()).not.toContain('暂无记录。');
    expect(wrapper.find('[data-testid="recog-history"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('queries history by the camera and the typed time range', async () => {
    httpGet.mockResolvedValue({ data: { items: [] } });
    const { wrapper, router } = await mountView({ shedCode: 'S01' });
    await wrapper.get('[data-testid="recog-history-camera"]').setValue('CAM-HIST-01');
    await wrapper.get('[data-testid="recog-history-from"]').setValue('2026-10-14T09:00');
    await wrapper.get('[data-testid="recog-history-to"]').setValue('2026-10-14T10:00');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(router.currentRoute.value.query.shedCode).toBe('S01');
    expect(router.currentRoute.value.query.cameraCode).toBe('CAM-HIST-01');
    expect(router.currentRoute.value.query.from).toBe(new Date('2026-10-14T09:00').toISOString());
    expect(router.currentRoute.value.query.to).toBe(new Date('2026-10-14T10:00').toISOString());
    expect(httpGet).toHaveBeenCalledWith('/ingest/recognitions', {
      params: {
        pageSize: '50',
        shedCode: 'S01',
        cameraCode: 'CAM-HIST-01',
        from: new Date('2026-10-14T09:00').toISOString(),
        to: new Date('2026-10-14T10:00').toISOString(),
      },
    });
    wrapper.unmount();
  });

  it('clears the history filter and loads the recent list again', async () => {
    httpGet.mockResolvedValue({ data: { items: [] } });
    const { wrapper, router } = await mountView({ cameraCode: 'CAM-HIST-01', shedCode: 'S01' });
    await wrapper.get('[data-testid="recog-history-clear"]').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.query.cameraCode).toBeUndefined();
    expect(router.currentRoute.value.query.shedCode).toBeUndefined();
    const calls = httpGet.mock.calls.filter((call) => call[0] === '/ingest/recognitions');
    expect(calls[calls.length - 1]?.[1]).toEqual({ params: { pageSize: '50' } });
    wrapper.unmount();
  });

  it('rejects an invalid time filter without showing an empty list', async () => {
    const { wrapper } = await mountView({ from: 'not-a-time' });

    expect(httpGet).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('时间筛选无效');
    expect(wrapper.text()).not.toContain('暂无记录。');
    expect(wrapper.text()).not.toContain('没有符合条件的识别记录。');
    expect(wrapper.find('[data-testid="recog-history"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows a load error instead of an empty list', async () => {
    httpGet.mockRejectedValue(new Error('down'));
    const { wrapper } = await mountView();

    expect(wrapper.text()).toContain('请求失败');
    expect(wrapper.text()).not.toContain('暂无记录。');
    wrapper.unmount();
  });
});
