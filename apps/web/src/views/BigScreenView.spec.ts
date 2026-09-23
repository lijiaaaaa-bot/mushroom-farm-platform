import { readFileSync } from 'node:fs';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BigScreenView from './BigScreenView.vue';

const httpGet = vi.hoisted(() => vi.fn());
const setOption = vi.hoisted(() => vi.fn());
const chartInit = vi.hoisted(() =>
  vi.fn(() => ({
    setOption,
    on: vi.fn(),
    off: vi.fn(),
    dispose: vi.fn(),
  })),
);

vi.mock('../api', () => ({
  http: {
    get: httpGet,
  },
  errorText: (error: unknown) => (error instanceof Error ? error.message : '请求失败'),
}));

vi.mock('echarts', () => ({
  init: chartInit,
}));

const overview = {
  shedCount: 1,
  deviceTotal: 1,
  deviceOnline: 1,
  todayMushroom: 12,
  todayMature: 7,
  openAlerts: 1,
  severeAlerts: 1,
  env: {
    avgTemp: 22.5,
    avgHumidity: 80,
    avgCo2: 600,
    avgSubstrateMoisture: 55,
  },
};

const shed = { id: 'shed-1', code: 'S01', name: '一号棚', location: '东区' };

const alert = {
  id: 'alert-1',
  shedCode: 'S01',
  cameraCode: 'CAM-S01',
  level: 'severe' as const,
  status: 'open' as const,
  title: '高温',
  message: '超过阈值',
  createdAt: '2026-09-23T01:02:00.000Z',
};

const device = {
  id: 'device-1',
  code: 'CAM-S01',
  name: '东摄像头',
  type: 'camera' as const,
  shedCode: 'S01',
  onlineStatus: 'online',
  lastSeenAt: '2026-09-23T01:02:00.000Z',
};

const recognition = {
  id: 'rec-1',
  shedCode: 'S01',
  cameraCode: 'CAM-S01',
  recognizedAt: '2026-09-23T01:02:00.000Z',
  mushroomCount: 10,
  matureCount: 4,
  diseaseCount: 0,
  temperature: 22.5,
  humidity: 80,
  co2: 600,
  substrateMoisture: 55,
};

const trend = {
  days: 7,
  from: '2026-09-17',
  to: '2026-09-23',
  sheds: [
    {
      shedCode: 'S01',
      points: [{ day: '2026-09-23', mushroomCount: 10, capDiameterMean: 4.2, sampleCount: 1 }],
      cameras: [],
    },
  ],
};

const emptyTrend = {
  days: 7,
  from: '2026-09-17',
  to: '2026-09-23',
  sheds: [],
};

const emptyOverview = {
  shedCount: 0,
  deviceTotal: 0,
  deviceOnline: 0,
  todayMushroom: 0,
  todayMature: 0,
  openAlerts: 0,
  severeAlerts: 0,
  env: {
    avgTemp: null,
    avgHumidity: null,
    avgCo2: null,
    avgSubstrateMoisture: null,
  },
};

function payloadFor(url: string, empty: boolean) {
  if (url === '/dashboard/overview') return empty ? emptyOverview : overview;
  if (url === '/sheds') return empty ? [] : [shed];
  if (url === '/alerts') return { items: empty ? [] : [alert], total: empty ? 0 : 1 };
  if (url === '/devices') return { items: empty ? [] : [device], total: empty ? 0 : 1 };
  if (url === '/ingest/recognitions') return { items: empty ? [] : [recognition], total: empty ? 0 : 1 };
  if (url === '/growth-trends') return empty ? emptyTrend : trend;
  throw new Error(`unexpected ${url}`);
}

function stubHttp(empty: boolean) {
  httpGet.mockImplementation((url: string) => Promise.resolve({ data: payloadFor(url, empty) }));
}

async function mountScreen(): Promise<VueWrapper> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/login', component: { template: '<div />' } },
      { path: '/big-screen', component: BigScreenView },
      { path: '/growth-trends', component: { template: '<div />' } },
      { path: '/recognitions', component: { template: '<div />' } },
    ],
  });
  const wrapper = mount(BigScreenView, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

function zones(wrapper: VueWrapper) {
  return {
    top: wrapper.get('header.zone.top'),
    left: wrapper.get('aside.zone.left'),
    center: wrapper.get('main.zone.center'),
    right: wrapper.get('aside.zone.right'),
    bottom: wrapper.get('footer.zone.bottom'),
  };
}

describe('BigScreenView', () => {
  beforeEach(() => {
    httpGet.mockReset();
    chartInit.mockClear();
    setOption.mockClear();
    sessionStorage.clear();
  });

  it('mounts the five zones and fills them from the existing list APIs', async () => {
    stubHttp(false);
    const wrapper = await mountScreen();

    expect(httpGet).toHaveBeenCalledWith('/dashboard/overview');
    expect(httpGet).toHaveBeenCalledWith('/sheds');
    expect(httpGet).toHaveBeenCalledWith('/alerts', { params: { pageSize: 50 } });
    expect(httpGet).toHaveBeenCalledWith('/devices', { params: { pageSize: 100 } });
    expect(httpGet).toHaveBeenCalledWith('/ingest/recognitions', { params: { pageSize: 100 } });
    expect(httpGet).toHaveBeenCalledWith('/growth-trends', { params: { days: 7 } });

    const screen = zones(wrapper);
    expect(wrapper.get('.screen').attributes('data-skin')).toBe('tb-night');
    expect(screen.top.text()).toContain('基地大屏');
    expect(wrapper.get('.metrics').text()).toContain('棚区');
    expect(wrapper.get('.metrics').text()).toContain('今日成熟');
    expect(screen.left.text()).toContain('棚区平面');
    expect(screen.left.text()).toContain('S01');
    expect(screen.left.text()).toContain('一号棚');
    expect(screen.center.text()).toContain('抓拍墙');
    expect(screen.center.text()).toContain('CAM-S01');
    expect(screen.center.text()).toContain('无图');
    expect(screen.right.text()).toContain('告警');
    expect(screen.right.text()).toContain('高温');
    const point = wrapper.get('button.point');
    expect(point.attributes('style')).toContain('left: 50%');
    expect(point.attributes('style')).toContain('top: 46%');
    await point.trigger('click');
    const detail = wrapper.get('section.detail');
    expect(detail.text()).toContain('设备在线');
    expect(detail.text()).toContain('1/1');
    expect(detail.text()).toContain('未关闭告警');
    expect(detail.text()).toContain('最近识别');
    expect(detail.text()).toContain('成熟 4/10');
    expect(screen.right.text()).toContain('环境');
    expect(screen.right.text()).toContain('22.5');
    expect(screen.right.text()).toContain('设备');
    expect(screen.right.text()).toContain('CAM-S01');
    expect(screen.bottom.text()).toContain('滚动');
    expect(screen.bottom.text()).toContain('高温');
    expect(screen.bottom.text()).toContain('时间轴');
    const trendsHref = decodeURIComponent(wrapper.get('a.timeline-trends').attributes('href') ?? '');
    const filterHref = decodeURIComponent(wrapper.get('a.timeline-filter').attributes('href') ?? '');
    expect(trendsHref).toContain('/growth-trends');
    expect(trendsHref).toContain('days=7');
    expect(trendsHref).toContain('shedCode=S01');
    expect(filterHref).toContain('/recognitions');
    expect(filterHref).toContain('from=2026-09-22T16:00:00.000Z');
    expect(filterHref).toContain('to=2026-09-23T15:59:59.999Z');
    expect(filterHref).toContain('shedCode=S01');
    expect(wrapper.get('.wall').text()).toContain('抓拍墙');
    expect(chartInit).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it('keeps the five zones when every list is empty', async () => {
    stubHttp(true);
    const wrapper = await mountScreen();
    const screen = zones(wrapper);

    expect(screen.top.text()).toContain('基地大屏');
    expect(screen.left.text()).toContain('当前账号没有可见棚区');
    expect(screen.center.text()).toContain('暂无识别记录，抓拍墙没有画面。');
    expect(screen.right.text()).toContain('暂无告警');
    expect(screen.right.text()).toContain('暂无设备');
    expect(screen.bottom.text()).toContain('暂无告警与识别记录');
    expect(screen.bottom.text()).toContain('暂无识别时间，不能按抓拍时段筛选。');
    expect(wrapper.find('a.timeline-filter').exists()).toBe(false);

    wrapper.unmount();
  });

  it('places a shed at its configured coordinates and falls back when either coordinate is missing', async () => {
    const placed = {
      id: 'shed-1',
      code: 'S01',
      name: '一号棚',
      location: '东区',
      mapX: 22.5,
      mapY: 70,
    };
    const missing = {
      id: 'shed-2',
      code: 'S02',
      name: '二号棚',
      location: null,
      mapX: 12,
      mapY: null,
    };
    httpGet.mockImplementation((url: string) => {
      if (url === '/sheds') return Promise.resolve({ data: [placed, missing] });
      return Promise.resolve({ data: payloadFor(url, false) });
    });
    const wrapper = await mountScreen();
    const points = wrapper.findAll('button.point');

    expect(points).toHaveLength(2);
    expect(points[0].attributes('style')).toContain('left: 22.5%');
    expect(points[0].attributes('style')).toContain('top: 70%');
    expect(points[1].attributes('style')).toContain('left: 68%');
    expect(points[1].attributes('style')).toContain('top: 50%');
    expect(points[1].attributes('style')).not.toContain('left: 12%');

    await points[0].trigger('click');
    const detail = wrapper.get('section.detail');
    expect(detail.text()).toContain('S01');
    expect(detail.text()).toContain('一号棚');
    expect(detail.text()).toContain('设备在线');
    expect(detail.text()).toContain('1/1');
    expect(detail.text()).toContain('未关闭告警');
    expect(detail.text()).toContain('最近识别');
    expect(detail.text()).toContain('成熟 4/10');
    expect(detail.text()).toContain('病害 0');

    wrapper.unmount();
  });

  it('shows the latest frame per camera on the snapshot wall and keeps a missing frame honest', async () => {
    const older = {
      ...recognition,
      id: 'rec-old',
      recognizedAt: '2026-09-22T01:02:00.000Z',
      mushroomCount: 3,
      matureCount: 1,
    };
    const latest = {
      ...recognition,
      snapshotObjectKey: null,
      snapshotUrl: 'https://example.test/shot.jpg',
    };
    const other = {
      ...recognition,
      id: 'rec-2',
      cameraCode: 'CAM-S02',
      recognizedAt: '2026-09-23T03:02:00.000Z',
      mushroomCount: 6,
      matureCount: 2,
      snapshotObjectKey: null,
      snapshotUrl: null,
    };
    httpGet.mockImplementation((url: string) => {
      if (url === '/ingest/recognitions') {
        return Promise.resolve({ data: { items: [other, latest, older], total: 3 } });
      }
      if (String(url).includes('/snapshot')) {
        return Promise.resolve({ data: new Blob(['jpeg'], { type: 'image/jpeg' }) });
      }
      return Promise.resolve({ data: payloadFor(url, false) });
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:wall');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const wrapper = await mountScreen();
    await wrapper.get('[data-layout-choice="wall"]').trigger('click');
    await flushPromises();

    const wall = wrapper.get('.wall');
    expect(wall.text()).toContain('抓拍墙');
    expect(wall.text()).toContain('CAM-S01');
    expect(wall.text()).toContain('成熟 4/10');
    expect(wall.text()).not.toContain('成熟 1/3');
    expect(wall.text()).toContain('CAM-S02');
    expect(wall.text()).toContain('无图');
    expect(wall.text()).not.toContain('暂无识别记录');
    const cells = wall.findAll('.wall-cell');
    expect(cells).toHaveLength(2);
    expect(cells[0].text()).toContain('CAM-S02');
    expect(cells[0].find('img').exists()).toBe(false);
    expect(cells[1].text()).toContain('成熟 4/10');

    await cells[0].get('button').trigger('click');
    const filterHref = decodeURIComponent(wrapper.get('a.timeline-filter').attributes('href') ?? '');
    expect(filterHref).toContain('cameraCode=CAM-S02');
    expect(filterHref).toContain('shedCode=S01');
    const trendsHref = decodeURIComponent(wrapper.get('a.timeline-trends').attributes('href') ?? '');
    expect(trendsHref).toContain('cameraCode=CAM-S02');

    wrapper.unmount();
  });

  it('keeps the floor, wall, and timeline together in the multi-panel layout', async () => {
    stubHttp(false);
    const wrapper = await mountScreen();
    chartInit.mockClear();
    await wrapper.get('[data-layout-choice="panels"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('.screen').attributes('data-layout')).toBe('panels');
    expect(wrapper.get('aside.zone.left').text()).toContain('棚区平面');
    expect(wrapper.get('.wall').text()).toContain('抓拍墙');
    expect(wrapper.get('.timeline-chart').attributes('class')).toContain('timeline-chart');
    expect(chartInit).toHaveBeenCalled();
    const option = setOption.mock.calls[setOption.mock.calls.length - 1]?.[0] as {
      series: Array<{ name: string; data: Array<number | null> }>;
    };
    expect(option.series[0].name).toBe('S01');
    expect(option.series[0].data).toEqual([10]);
    expect(wrapper.text()).not.toContain('近 7 日没有日聚合');

    wrapper.unmount();
  });

  it('does not paint an empty timeline when the trend request fails', async () => {
    httpGet.mockImplementation((url: string) => {
      if (url === '/growth-trends') return Promise.reject(new Error('趋势接口失败'));
      return Promise.resolve({ data: payloadFor(url, false) });
    });
    const wrapper = await mountScreen();
    await wrapper.get('[data-layout-choice="panels"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('.timeline-chart-wrap').text()).toContain('趋势接口失败');
    expect(wrapper.get('.timeline-chart-wrap').text()).not.toContain('近 7 日没有日聚合');
    expect(wrapper.find('.timeline-chart').exists()).toBe(false);
    expect(chartInit).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('shows the recognition error on the wall instead of an empty grid', async () => {
    httpGet.mockImplementation((url: string) => {
      if (url === '/ingest/recognitions') return Promise.reject(new Error('识别列表失败'));
      return Promise.resolve({ data: payloadFor(url, false) });
    });
    const wrapper = await mountScreen();
    await wrapper.get('[data-layout-choice="wall"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('.wall').text()).toContain('识别列表失败');
    expect(wrapper.get('.wall').text()).not.toContain('暂无识别记录');
    expect(wrapper.find('.wall-grid').exists()).toBe(false);
    wrapper.unmount();
  });

  it('keeps the night skin on this route and does not restyle the document', async () => {
    stubHttp(true);
    const source = readFileSync('src/views/BigScreenView.vue', 'utf8');
    expect(source).not.toMatch(/雪亮|#00e5ff|#0b1220|#00fff/i);
    expect(source).toContain('data-skin');
    expect(source).toContain('tb-night');
    expect(source).toContain('empty-label="无图"');
    expect(source).not.toMatch(/result-card-media[\s\S]{0,180}background:\s*#(1f6b4a|1b7a4e|2f9e44)/i);
    expect(source).toContain('skin-dark');

    const wrapper = await mountScreen();
    const screen = wrapper.get('.screen');
    expect(screen.attributes('data-skin')).toBe('tb-night');
    expect(screen.classes()).not.toContain('skin-dark');
    expect(document.documentElement.getAttribute('data-skin')).toBeNull();
    expect(document.body.className).not.toContain('skin-dark');

    await wrapper.get('.skin-toggle').trigger('click');
    expect(wrapper.get('.screen').attributes('data-skin')).toBe('tb-night');
    expect(wrapper.get('.screen').classes()).toContain('skin-dark');
    expect(sessionStorage.getItem('big-screen-skin')).toBe('dark');
    expect(document.documentElement.getAttribute('data-skin')).toBeNull();
    wrapper.unmount();

    const again = await mountScreen();
    expect(again.get('.screen').attributes('data-skin')).toBe('tb-night');
    expect(again.get('.screen').classes()).toContain('skin-dark');
    again.unmount();
  });
});
