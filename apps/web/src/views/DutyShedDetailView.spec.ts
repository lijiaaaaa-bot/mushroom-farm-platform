import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DutyShedDetailView from './DutyShedDetailView.vue';

const httpGet = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: { get: httpGet },
  errorText: (error: unknown) => (error instanceof Error ? error.message : '请求失败'),
}));

const sheds = [
  { id: 'shed-1', code: 'S01', name: '一号棚' },
  { id: 'shed-2', code: 'S02', name: '二号棚' },
];

const devices = {
  items: [
    camera('CAM-S01-A', '一号东', 'S01', 'online', '2026-10-13T01:00:00.000Z'),
    camera('CAM-S01-B', '一号西', 'S01', 'online', '2026-10-13T01:05:00.000Z'),
    camera('CAM-S02-A', '二号东', 'S02', 'online', '2026-10-13T01:00:00.000Z'),
    camera('CAM-S02-B', '二号西', 'S02', 'offline', null),
    camera('SENSOR-1', '二号探头', 'S02', 'online', '2026-10-13T01:00:00.000Z', 'sensor'),
  ],
  total: 5,
};

const warning = alert(
  'alert-warn',
  'S02',
  'warning',
  'open',
  '湿度过高告警',
  '2026-10-13T01:00:00.000Z',
);
const closed = alert(
  'alert-closed',
  'S02',
  'warning',
  'closed',
  '已关闭的旧告警',
  '2026-10-13T03:00:00.000Z',
);
const otherShed = alert(
  'alert-s99',
  'S99',
  'severe',
  'open',
  '他棚高温',
  '2026-10-13T01:30:00.000Z',
);
const info = alert(
  'alert-info',
  'S02',
  'info',
  'acked',
  '基质含水率过低告警',
  '2026-10-13T02:00:00.000Z',
);

function camera(
  code: string,
  name: string,
  shedCode: string,
  onlineStatus: string,
  lastHeartbeatAt: string | null,
  type: 'camera' | 'sensor' = 'camera',
) {
  return { id: code, code, name, type, shedCode, onlineStatus, lastHeartbeatAt };
}

function alert(
  id: string,
  shedCode: string,
  level: 'info' | 'warning' | 'severe',
  status: 'open' | 'acked' | 'closed',
  title: string,
  createdAt: string,
) {
  return { id, shedCode, level, status, title, createdAt };
}

function alertQuery(row: { get: (selector: string) => { attributes: (name: string) => string | undefined } }) {
  const href = row.get('[data-test="alert-link"]').attributes('href') ?? '';
  const url = new URL(href, 'http://local');
  return {
    shedCode: url.searchParams.get('shedCode'),
    status: url.searchParams.get('status'),
    alertId: url.searchParams.get('alertId'),
  };
}

function payloadFor(url: string, config?: { params?: Record<string, string | number> }) {
  const params = config?.params ?? {};
  if (url === '/sheds') return sheds;
  if (url === '/devices') return devices;
  if (url === '/alerts' && params.status === 'open') {
    return { items: [warning, closed, otherShed], total: 3 };
  }
  if (url === '/alerts' && params.status === 'acked') return { items: [info], total: 1 };
  throw new Error(`unexpected ${url}`);
}

let memoryRouter: ReturnType<typeof createRouter>;

async function mountDetail(shedCode: string): Promise<VueWrapper> {
  memoryRouter = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/login', component: { template: '<div />' } },
      { path: '/big-screen', component: { template: '<div />' } },
      { path: '/duty-screen', component: { template: '<div data-test="board" />' } },
      { path: '/duty-screen/:shedCode', component: DutyShedDetailView },
      { path: '/alerts', component: { template: '<div data-test="alerts-page" />' } },
    ],
  });
  await memoryRouter.push(`/duty-screen/${shedCode}`);
  await memoryRouter.isReady();
  const wrapper = mount(DutyShedDetailView, { global: { plugins: [memoryRouter] } });
  await flushPromises();
  return wrapper;
}

describe('DutyShedDetailView', () => {
  beforeEach(() => {
    httpGet.mockReset();
    httpGet.mockImplementation((url: string, config?: { params?: Record<string, string | number> }) =>
      Promise.resolve({ data: payloadFor(url, config) }),
    );
  });

  it('lists that shed’s cameras and open or acked alerts', async () => {
    const wrapper = await mountDetail('S02');

    expect(httpGet).toHaveBeenCalledWith('/sheds');
    expect(httpGet).toHaveBeenCalledWith('/devices', {
      params: { type: 'camera', shedCode: 'S02', page: 1, pageSize: 100 },
    });
    expect(httpGet).toHaveBeenCalledWith('/alerts', {
      params: { status: 'open', shedCode: 'S02', page: 1, pageSize: 100 },
    });
    expect(httpGet).toHaveBeenCalledWith('/alerts', {
      params: { status: 'acked', shedCode: 'S02', page: 1, pageSize: 100 },
    });

    expect(wrapper.get('h1').text()).toBe('棚 S02 · 二号棚');
    expect(wrapper.get('[data-field="status"]').text()).toBe('告警');
    expect(wrapper.get('[data-field="status"]').attributes('data-status')).toBe('alert');
    expect(wrapper.get('[data-field="summary"]').text()).toBe('在线摄像头 1/2 · 未闭合 2');

    const east = wrapper.get('[data-camera="CAM-S02-A"]');
    expect(east.get('[data-field="name"]').text()).toBe('二号东');
    expect(east.get('[data-field="code"]').text()).toBe('CAM-S02-A');
    expect(east.get('[data-field="online"]').text()).toBe('在线');
    expect(east.get('[data-field="heartbeat"]').text()).toBe('2026-10-13 09:00');

    const west = wrapper.get('[data-camera="CAM-S02-B"]');
    expect(west.get('[data-field="name"]').text()).toBe('二号西');
    expect(west.get('[data-field="online"]').text()).toBe('离线');
    expect(west.get('[data-field="heartbeat"]').text()).toBe('—');

    expect(wrapper.text()).not.toContain('一号东');
    expect(wrapper.text()).not.toContain('二号探头');
    expect(wrapper.text()).not.toContain('SENSOR-1');

    const alerts = wrapper.get('[data-test="alerts"]');
    const acked = alerts.get('[data-alert="alert-info"]');
    expect(acked.get('[data-field="title"]').text()).toBe('基质含水率过低告警');
    expect(acked.get('[data-field="level"]').text()).toBe('提示');
    expect(acked.get('[data-field="status"]').text()).toBe('已确认');
    expect(acked.get('[data-field="time"]').text()).toBe('2026-10-13 10:00');

    const open = alerts.get('[data-alert="alert-warn"]');
    expect(open.get('[data-field="title"]').text()).toBe('湿度过高告警');
    expect(open.get('[data-field="level"]').text()).toBe('一般');
    expect(open.get('[data-field="status"]').text()).toBe('待确认');
    expect(open.get('[data-field="time"]').text()).toBe('2026-10-13 09:00');
    expect(alertQuery(open)).toEqual({ shedCode: 'S02', status: 'open', alertId: 'alert-warn' });
    expect(alertQuery(acked)).toEqual({ shedCode: 'S02', status: 'acked', alertId: 'alert-info' });
    expect(alerts.text().indexOf('基质含水率过低告警')).toBeLessThan(alerts.text().indexOf('湿度过高告警'));

    expect(wrapper.text()).not.toContain('已关闭的旧告警');
    expect(wrapper.text()).not.toContain('他棚高温');
    expect(wrapper.get('[data-test="back"]').attributes('href')).toBe('/duty-screen');
    wrapper.unmount();
  });

  it('opens that alert on /alerts with shed, status, and id', async () => {
    const wrapper = await mountDetail('S02');
    await wrapper.get('[data-alert="alert-warn"] [data-field="time"]').trigger('click');
    await flushPromises();
    expect(memoryRouter.currentRoute.value.path).toBe('/alerts');
    expect(memoryRouter.currentRoute.value.query).toEqual({
      shedCode: 'S02',
      status: 'open',
      alertId: 'alert-warn',
    });
    wrapper.unmount();
  });

  it('returns to /duty-screen from the back link', async () => {
    const wrapper = await mountDetail('S02');
    await wrapper.get('[data-test="back"]').trigger('click');
    await flushPromises();
    expect(memoryRouter.currentRoute.value.path).toBe('/duty-screen');
    wrapper.unmount();
  });

  it('shows a clear shed with camera names and no open alerts', async () => {
    const wrapper = await mountDetail('S01');
    expect(wrapper.get('h1').text()).toBe('棚 S01 · 一号棚');
    expect(wrapper.get('[data-field="status"]').text()).toBe('正常');
    expect(wrapper.get('[data-field="summary"]').text()).toBe('在线摄像头 2/2 · 未闭合 0');
    expect(wrapper.get('[data-camera="CAM-S01-A"]').get('[data-field="name"]').text()).toBe('一号东');
    expect(wrapper.get('[data-camera="CAM-S01-B"]').text()).toContain('一号西');
    expect(wrapper.text()).toContain('没有未闭合告警');
    expect(wrapper.text()).not.toContain('二号东');
    wrapper.unmount();
  });

  it('does not claim an empty camera list when devices fail', async () => {
    httpGet.mockImplementation((url: string, config?: { params?: Record<string, string | number> }) => {
      if (url === '/devices') return Promise.reject(new Error('摄像头加载失败'));
      return Promise.resolve({ data: payloadFor(url, config) });
    });
    const wrapper = await mountDetail('S01');
    expect(wrapper.text()).toContain('摄像头加载失败');
    expect(wrapper.text()).not.toContain('没有摄像头');
    expect(wrapper.get('[data-field="status"]').text()).toBe('未知');
    expect(wrapper.get('[data-field="summary"]').text()).toContain('—/—');
    expect(wrapper.find('[data-camera]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('does not claim there are no alerts when alerts fail', async () => {
    httpGet.mockImplementation((url: string, config?: { params?: Record<string, string | number> }) => {
      if (url === '/alerts') return Promise.reject(new Error('告警加载失败'));
      return Promise.resolve({ data: payloadFor(url, config) });
    });
    const wrapper = await mountDetail('S01');
    expect(wrapper.text()).toContain('告警加载失败');
    expect(wrapper.text()).not.toContain('没有未闭合告警');
    expect(wrapper.get('[data-field="status"]').text()).toBe('未知');
    expect(wrapper.get('[data-field="summary"]').text()).toContain('告警未返回');
    expect(wrapper.get('[data-camera="CAM-S01-A"]').text()).toContain('一号东');
    wrapper.unmount();
  });

  it('says the shed is missing when the code is not in the shed list', async () => {
    const wrapper = await mountDetail('NOPE');
    expect(wrapper.get('h1').text()).toBe('棚 NOPE');
    expect(wrapper.get('[data-test="missing-shed"]').text()).toBe('没有这个棚');
    expect(wrapper.get('[data-field="status"]').text()).toBe('未知');
    expect(wrapper.find('[data-camera]').exists()).toBe(false);
    expect(httpGet).toHaveBeenCalledWith('/devices', {
      params: { type: 'camera', shedCode: 'NOPE', page: 1, pageSize: 100 },
    });
    wrapper.unmount();
  });
});
