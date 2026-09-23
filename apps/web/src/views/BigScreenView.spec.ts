import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BigScreenView from './BigScreenView.vue';

const httpGet = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: {
    get: httpGet,
  },
  errorText: (error: unknown) => (error instanceof Error ? error.message : '请求失败'),
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
  });

  it('mounts the five zones and fills them from the existing list APIs', async () => {
    stubHttp(false);
    const wrapper = await mountScreen();

    expect(httpGet).toHaveBeenCalledWith('/dashboard/overview');
    expect(httpGet).toHaveBeenCalledWith('/sheds');
    expect(httpGet).toHaveBeenCalledWith('/alerts', { params: { pageSize: 50 } });
    expect(httpGet).toHaveBeenCalledWith('/devices', { params: { pageSize: 100 } });
    expect(httpGet).toHaveBeenCalledWith('/ingest/recognitions', { params: { pageSize: 30 } });

    const screen = zones(wrapper);
    expect(screen.top.text()).toContain('菇棚监测');
    expect(screen.left.text()).toContain('指标');
    expect(screen.left.text()).toContain('告警');
    expect(screen.left.text()).toContain('高温');
    expect(screen.center.text()).toContain('棚区平面');
    expect(screen.center.text()).toContain('S01');
    expect(screen.center.text()).toContain('一号棚');
    expect(screen.right.text()).toContain('环境');
    expect(screen.right.text()).toContain('22.5');
    expect(screen.right.text()).toContain('设备');
    expect(screen.right.text()).toContain('CAM-S01');
    expect(screen.bottom.text()).toContain('滚动');
    expect(screen.bottom.text()).toContain('高温');

    wrapper.unmount();
  });

  it('keeps the five zones when every list is empty', async () => {
    stubHttp(true);
    const wrapper = await mountScreen();
    const screen = zones(wrapper);

    expect(screen.top.text()).toContain('菇棚监测');
    expect(screen.left.text()).toContain('暂无告警');
    expect(screen.center.text()).toContain('当前账号没有可见棚区');
    expect(screen.right.text()).toContain('暂无设备');
    expect(screen.bottom.text()).toContain('暂无告警与识别记录');

    wrapper.unmount();
  });
});
