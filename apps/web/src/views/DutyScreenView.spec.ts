import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DutyScreenView from './DutyScreenView.vue';

const httpGet = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: { get: httpGet },
  errorText: (error: unknown) => (error instanceof Error ? error.message : '请求失败'),
}));

const day = '2026-10-13';

const sheds = [
  { id: 'shed-1', code: 'S01', name: '一号棚' },
  { id: 'shed-2', code: 'S02', name: '二号棚' },
  { id: 'shed-3', code: 'S03', name: '三号棚' },
  { id: 'shed-4', code: 'S04', name: '空棚' },
  { id: 'shed-5', code: 'S05', name: '五号棚' },
];

const devices = {
  items: [
    device('CAM-S01-A', 'S01', 'online'),
    device('CAM-S01-B', 'S01', 'online'),
    device('SENSOR-1', 'S01', 'offline', 'sensor'),
    device('CAM-S02-A', 'S02', 'online'),
    device('CAM-S02-B', 'S02', 'offline'),
    device('CAM-S03', 'S03', 'offline', 'camera', '2026-10-13T01:41:00.000Z'),
    device('CAM-S05', 'S05', 'offline', 'camera', '2026-10-13T01:10:00.000Z'),
  ],
  total: 7,
};

const warning = alert('alert-warn', 'S02', 'warning', 'open', '湿度过高告警', '2026-10-13T01:00:00.000Z', '棚区 S02 摄像头 CAM-S02-A 湿度过高 92，阈值 85');
const severeOffline = alert('alert-off', 'S05', 'severe', 'open', '设备离线告警', '2026-10-13T01:05:00.000Z', '棚区 S05 摄像头 CAM-S05 设备离线');
const info = alert('alert-info', 'S02', 'info', 'acked', '基质含水率过低告警', '2026-10-13T02:00:00.000Z', '棚区 S02 摄像头 CAM-S02-B 基质含水率过低');

const trend = {
  days: 7,
  from: '2026-10-07',
  to: day,
  sheds: [
    {
      shedCode: 'S01',
      points: [
        { day: '2026-10-12', mushroomCount: 99, sampleCount: 99 },
        { day, mushroomCount: 9, sampleCount: 4 },
      ],
      cameras: [],
    },
    {
      shedCode: 'S02',
      points: [{ day, mushroomCount: 2, sampleCount: 1 }],
      cameras: [],
    },
  ],
};

const overview = {
  shedCount: 4,
  deviceTotal: 8,
  deviceOnline: 5,
  todayMushroom: 11,
  todayMature: 3,
  openAlerts: 3,
  severeAlerts: 1,
  env: { avgTemp: 22.5, avgHumidity: null, avgCo2: null, avgSubstrateMoisture: null },
};

const observability = {
  windowMinutes: 60,
  accepted: 12,
  rejected: 2,
  latencyP50Ms: 18,
  latencyLatestMs: 40,
  channels: [
    channel('recognition', 'http', 6, 0),
    channel('recognition', 'mqtt', 2, 0),
    channel('environment', 'http', 0, 0),
    channel('environment', 'mqtt', 0, 2),
    channel('heartbeat', 'http', 4, 0),
    channel('heartbeat', 'mqtt', 0, 0),
  ],
  recentErrors: [
    {
      id: 'rej-1',
      channel: 'environment' as const,
      transport: 'mqtt' as const,
      shedCode: 'S02',
      code: 'UNKNOWN_FIELD',
      errors: ['多余字段'],
      createdAt: '2026-10-13T01:20:00.000Z',
    },
  ],
};

function device(
  code: string,
  shedCode: string,
  onlineStatus: string,
  type: 'camera' | 'sensor' = 'camera',
  lastHeartbeatAt: string | null = '2026-10-13T01:00:00.000Z',
) {
  return {
    id: code,
    code,
    name: code,
    type,
    shedCode,
    onlineStatus,
    lastSeenAt: lastHeartbeatAt,
    lastHeartbeatAt,
  };
}

function alert(
  id: string,
  shedCode: string,
  level: 'info' | 'warning' | 'severe',
  status: 'open' | 'acked' | 'closed',
  title: string,
  createdAt: string,
  message: string,
) {
  return { id, shedCode, level, status, title, message, createdAt };
}

function channel(
  name: 'recognition' | 'environment' | 'heartbeat',
  transport: 'http' | 'mqtt',
  accepted: number,
  rejected: number,
) {
  return {
    channel: name,
    transport,
    accepted,
    rejected,
    latencyP50Ms: 18,
    latencyLatestMs: 40,
  };
}

function payloadFor(url: string, config?: { params?: Record<string, string | number> }) {
  const params = config?.params ?? {};
  if (url === '/sheds') return sheds;
  if (url === '/devices') return devices;
  if (url === '/alerts' && params.status === 'open') return { items: [warning, severeOffline], total: 2 };
  if (url === '/alerts' && params.status === 'acked') return { items: [info], total: 1 };
  if (url === '/growth-trends') return trend;
  if (url === '/dashboard/overview') return overview;
  if (url === '/ingest/observability') return observability;
  throw new Error(`unexpected ${url}`);
}

let memoryRouter: ReturnType<typeof createRouter>;

async function mountDuty(): Promise<VueWrapper> {
  memoryRouter = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/login', component: { template: '<div />' } },
      { path: '/big-screen', component: { template: '<div />' } },
      { path: '/alerts', component: { template: '<div />' } },
      { path: '/duty-screen', component: DutyScreenView },
      {
        path: '/duty-screen/:shedCode',
        name: 'duty-shed',
        component: { template: '<div data-test="shed-detail" />' },
      },
    ],
  });
  await memoryRouter.push('/duty-screen');
  await memoryRouter.isReady();
  const wrapper = mount(DutyScreenView, { global: { plugins: [memoryRouter] } });
  await flushPromises();
  return wrapper;
}

describe('DutyScreenView', () => {
  beforeEach(() => {
    httpGet.mockReset();
    httpGet.mockImplementation((url: string, config?: { params?: Record<string, string | number> }) =>
      Promise.resolve({ data: payloadFor(url, config) }),
    );
  });

  it('renders shed cards from sheds, cameras, day buckets, and open alerts', async () => {
    const wrapper = await mountDuty();

    expect(httpGet).toHaveBeenCalledWith('/devices', {
      params: { type: 'camera', page: 1, pageSize: 100 },
    });
    expect(httpGet).toHaveBeenCalledWith('/alerts', {
      params: { status: 'open', page: 1, pageSize: 100 },
    });
    expect(httpGet).toHaveBeenCalledWith('/alerts', {
      params: { status: 'acked', page: 1, pageSize: 100 },
    });
    expect(httpGet).toHaveBeenCalledWith('/growth-trends', { params: { days: 7 } });

    const s01 = wrapper.get('[data-shed="S01"]');
    expect(s01.attributes('data-status')).toBe('ok');
    expect(s01.text()).toContain('正常');
    expect(s01.get('[data-field="online"]').text()).toBe('2/2');
    expect(s01.get('[data-field="recognitions"]').text()).toBe('4');
    expect(s01.get('[data-field="alert"]').text()).toBe('无未闭合告警');

    const s02 = wrapper.get('[data-shed="S02"]');
    expect(s02.attributes('data-status')).toBe('alert');
    expect(s02.get('[data-field="online"]').text()).toBe('1/2');
    expect(s02.get('[data-field="recognitions"]').text()).toBe('1');
    expect(s02.get('[data-field="alert"]').text()).toContain('一般');
    expect(s02.get('[data-field="alert"]').text()).toContain('湿度过高 92');
    expect(s02.text()).not.toContain('基质');

    const s03 = wrapper.get('[data-shed="S03"]');
    expect(s03.attributes('data-status')).toBe('offline');
    expect(s03.get('[data-field="online"]').text()).toBe('0/1');
    expect(s03.get('[data-field="recognitions"]').text()).toBe('0');
    expect(s03.get('[data-field="alert"]').text()).toBe('整棚离线 · 上次心跳 09:41');

    const s04 = wrapper.get('[data-shed="S04"]');
    expect(s04.attributes('data-status')).toBe('offline');
    expect(s04.get('[data-field="online"]').text()).toBe('0/0');
    expect(s04.get('[data-field="alert"]').text()).toBe('无摄像头');

    const s05 = wrapper.get('[data-shed="S05"]');
    expect(s05.attributes('data-status')).toBe('offline');
    expect(s05.get('[data-field="online"]').text()).toBe('0/1');
    expect(s05.get('[data-field="alert"]').text()).toContain('严重');
    expect(s05.get('[data-field="alert"]').text()).toContain('设备离线');
    expect(s05.get('[data-field="alert"]').text()).not.toContain('上次心跳');

    expect(wrapper.text()).not.toMatch(/CAM-|SENSOR-/);
    expect(wrapper.text()).not.toContain('99');
    expect(wrapper.text()).not.toMatch(/Pareto|reward-leak|kernel-builder|Stanford|MEM|THREADS|ITER|SYNCHRONIZED|识别准确率|EFFICIENCY/i);
    expect(wrapper.get('[data-test="pipeline"]').text()).toContain('识别 HTTP 6');
    expect(wrapper.get('[data-test="pipeline"]').text()).toContain('环境 MQTT 0·拒2');
    expect(wrapper.get('[data-test="alert-feed"]').text()).toContain('湿度过高告警');
    expect(wrapper.get('[data-test="alert-feed"]').text()).toContain('UNKNOWN_FIELD');
    expect(wrapper.get('[data-field="today-mushroom"]').text()).toBe('11');
    expect(wrapper.get('[data-test="shed-counts"]').text()).toContain('S01');
    expect(wrapper.get('[data-test="shed-counts"]').text()).toContain('蘑菇 9');
    expect(wrapper.text()).toContain('22.5');
    expect(wrapper.get('[data-shed="S02"]').attributes('href')).toBe('/duty-screen/S02');
    wrapper.unmount();
  });

  it('opens /duty-screen/:shedCode from a shed card', async () => {
    const wrapper = await mountDuty();
    await wrapper.get('[data-shed="S01"]').trigger('click');
    await flushPromises();
    expect(memoryRouter.currentRoute.value.path).toBe('/duty-screen/S01');
    expect(memoryRouter.currentRoute.value.params.shedCode).toBe('S01');
    wrapper.unmount();
  });

  it('does not claim a clear shed when alerts fail to load', async () => {
    httpGet.mockImplementation((url: string, config?: { params?: Record<string, string | number> }) => {
      if (url === '/alerts') return Promise.reject(new Error('告警加载失败'));
      return Promise.resolve({ data: payloadFor(url, config) });
    });
    const wrapper = await mountDuty();
    const s01 = wrapper.get('[data-shed="S01"]');
    expect(s01.attributes('data-status')).toBe('unknown');
    expect(s01.get('[data-field="alert"]').text()).toContain('告警加载失败');
    expect(s01.text()).not.toContain('无未闭合告警');
    expect(s01.text()).not.toContain('正常');
    wrapper.unmount();
  });

  it('does not show zero recognitions when the day bucket request fails', async () => {
    httpGet.mockImplementation((url: string, config?: { params?: Record<string, string | number> }) => {
      if (url === '/growth-trends') return Promise.reject(new Error('日桶加载失败'));
      return Promise.resolve({ data: payloadFor(url, config) });
    });
    const wrapper = await mountDuty();
    expect(wrapper.get('[data-shed="S01"]').get('[data-field="recognitions"]').text()).toBe('—');
    expect(wrapper.text()).toContain('日桶加载失败');
    expect(wrapper.get('[data-shed="S01"]').text()).not.toContain('99');
    wrapper.unmount();
  });

  it('shows an empty shed floor when the shed list is empty', async () => {
    httpGet.mockImplementation((url: string, config?: { params?: Record<string, string | number> }) => {
      if (url === '/sheds') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: payloadFor(url, config) });
    });
    const wrapper = await mountDuty();
    expect(wrapper.text()).toContain('没有可见棚区');
    expect(wrapper.find('[data-shed]').exists()).toBe(false);
    wrapper.unmount();
  });
});
