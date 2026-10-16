import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CapturePreviewView from './CapturePreviewView.vue';

const httpGet = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: { get: httpGet },
  errorText: () => '请求失败',
}));

const sheds = [
  { code: 'S01', name: '一号棚' },
  { code: 'S02', name: '二号棚' },
];

function row(
  id: string,
  recognizedAt: string,
  mushroomCount: number,
  matureCount: number,
  withShot = true,
) {
  return {
    id,
    shedCode: 'S01',
    cameraCode: 'CAM-CP-01',
    recognizedAt,
    mushroomCount,
    matureCount,
    diseaseCount: 1,
    snapshotObjectKey: withShot ? `snapshots/S01/${id}.jpg` : null,
    snapshotUrl: withShot ? `http://127.0.0.1:9000/${id}.jpg` : null,
  };
}

const three = [
  row('cp-new', '2026-10-16T04:00:00.000Z', 12, 5),
  row('cp-mid', '2026-10-16T03:50:00.000Z', 10, 4),
  row('cp-old', '2026-10-16T03:40:00.000Z', 8, 2),
];

function mockList(items: unknown[]) {
  httpGet.mockImplementation((url: string) => {
    if (url === '/sheds') return Promise.resolve({ data: sheds });
    if (url === '/ingest/recognitions') return Promise.resolve({ data: { items } });
    if (String(url).includes('/snapshot')) {
      return Promise.resolve({ data: new Blob(['jpeg'], { type: 'image/jpeg' }) });
    }
    return Promise.resolve({ data: {} });
  });
}

async function mountView(query: Record<string, string> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/capture-preview', component: CapturePreviewView }],
  });
  await router.push({ path: '/capture-preview', query });
  const wrapper = mount(CapturePreviewView, { global: { plugins: [router] } });
  await flushPromises();
  await flushPromises();
  return { wrapper, router };
}

describe('CapturePreviewView', () => {
  beforeEach(() => {
    httpGet.mockReset();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:capture');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the original shot and the annotated overlay with three timeline points', async () => {
    mockList(three);
    const { wrapper } = await mountView({
      shedCode: 'S01',
      cameraCode: 'CAM-CP-01',
      from: '2026-10-16T03:30:00.000Z',
      to: '2026-10-16T04:01:00.000Z',
    });

    expect(httpGet).toHaveBeenCalledWith('/ingest/recognitions', {
      params: {
        pageSize: '50',
        shedCode: 'S01',
        cameraCode: 'CAM-CP-01',
        from: '2026-10-16T03:30:00.000Z',
        to: '2026-10-16T04:01:00.000Z',
      },
    });
    expect(httpGet).toHaveBeenCalledWith('/ingest/recognitions/cp-new/snapshot', {
      responseType: 'blob',
    });
    expect(httpGet).not.toHaveBeenCalledWith('/growth-trends/live', expect.anything());
    expect(httpGet).not.toHaveBeenCalledWith('/diseases/peaks', expect.anything());
    expect(httpGet).not.toHaveBeenCalledWith('/ingest/observability', expect.anything());
    expect(wrapper.get('[data-testid="capture-note"]').text()).toBe('原始 · 标注 · 时间轴 3 点');
    expect(wrapper.get('[data-testid="capture-original"]').text()).toContain('原始');
    expect(wrapper.get('[data-testid="capture-annotated"]').text()).toContain('标注');
    expect(wrapper.get('[data-testid="capture-labels"]').text()).toContain('AI标注');
    expect(wrapper.get('[data-testid="capture-labels"]').text()).toContain('蘑菇数 12');
    expect(wrapper.get('[data-testid="capture-labels"]').text()).toContain('成熟 5');
    expect(wrapper.get('[data-testid="capture-labels"]').text()).toContain('病害 1');
    expect(wrapper.get('[data-testid="capture-original"]').find('img').attributes('alt')).toBe('原始抓拍');
    expect(wrapper.get('[data-testid="capture-annotated"]').find('img').attributes('alt')).toBe('AI标注');
    const points = wrapper.findAll('[data-testid="capture-timeline-item"]');
    expect(points).toHaveLength(3);
    expect(points[0].text()).toContain('蘑菇数 12');
    expect(points[1].text()).toContain('蘑菇数 10');
    expect(points[2].text()).toContain('蘑菇数 8');
    expect(points[0].attributes('data-selected')).toBe('true');
    expect(wrapper.find('[data-testid="capture-empty"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('switches the pair when a timeline point is clicked', async () => {
    mockList(three);
    const { wrapper } = await mountView({ cameraCode: 'CAM-CP-01' });
    const points = wrapper.findAll('[data-testid="capture-timeline-item"]');
    await points[2].trigger('click');
    await flushPromises();
    await flushPromises();

    expect(httpGet).toHaveBeenCalledWith('/ingest/recognitions/cp-old/snapshot', {
      responseType: 'blob',
    });
    expect(wrapper.get('[data-testid="capture-labels"]').text()).toContain('蘑菇数 8');
    expect(wrapper.get('[data-testid="capture-labels"]').text()).toContain('成熟 2');
    const next = wrapper.findAll('[data-testid="capture-timeline-item"]');
    expect(next[2].attributes('data-selected')).toBe('true');
    wrapper.unmount();
  });

  it('writes the empty image copy when the selected point has no snapshot', async () => {
    mockList([row('cp-bare', '2026-10-16T04:00:00.000Z', 6, 1, false)]);
    const { wrapper } = await mountView({ cameraCode: 'CAM-CP-01' });

    expect(wrapper.get('[data-testid="capture-original-empty"]').text()).toBe('无原始抓拍');
    expect(wrapper.get('[data-testid="capture-annotated-empty"]').text()).toBe('无标注图');
    expect(wrapper.get('[data-testid="capture-note"]').text()).toBe('原始 · 标注 · 时间轴 1 点');
    expect(wrapper.find('img').exists()).toBe(false);
    expect(httpGet).not.toHaveBeenCalledWith(
      '/ingest/recognitions/cp-bare/snapshot',
      expect.anything(),
    );
    wrapper.unmount();
  });

  it('writes the empty timeline copy when nothing can be replayed', async () => {
    mockList([]);
    const { wrapper } = await mountView({ cameraCode: 'CAM-CP-NONE' });

    expect(wrapper.get('[data-testid="capture-empty"]').text()).toBe('没有可回看的抓拍。');
    expect(wrapper.find('[data-testid="capture-pair"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="capture-original-empty"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('无原始抓拍');
    wrapper.unmount();
  });
});
