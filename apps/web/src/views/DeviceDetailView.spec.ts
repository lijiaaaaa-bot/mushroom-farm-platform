import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DeviceDetailView from './DeviceDetailView.vue';

const httpGet = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: { get: httpGet },
  errorText: () => '请求失败',
}));

const device = {
  id: 'dev-alert-01',
  code: 'CAM-ALERT-01',
  name: '温度告警镜头',
  type: 'camera' as const,
  shedCode: 'S01',
  onlineStatus: 'offline' as const,
  lastSeenAt: null,
  lastHeartbeatAt: null,
  note: '镜头码对照告警',
};

const alert = {
  id: 'alert-detail-01',
  title: '镜头详情告警',
  level: 'warning' as const,
  status: 'open' as const,
  cameraCode: 'CAM-ALERT-01',
  createdAt: '2026-10-14T01:02:03.004Z',
};

async function mountDetail(id = device.id) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/devices/:id', component: DeviceDetailView },
      { path: '/devices', component: { template: '<div />' } },
      { path: '/alerts/:id', component: { template: '<div />' } },
    ],
  });
  await router.push(`/devices/${id}`);
  await router.isReady();
  const wrapper = mount(DeviceDetailView, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

describe('DeviceDetailView', () => {
  beforeEach(() => {
    httpGet.mockReset();
  });

  it('shows the camera fields and related alerts', async () => {
    httpGet.mockImplementation((url: string) => {
      if (url === '/devices/dev-alert-01') return Promise.resolve({ data: device });
      if (url === '/alerts') {
        return Promise.resolve({ data: { items: [alert], total: 1 } });
      }
      return Promise.reject(new Error(url));
    });
    const wrapper = await mountDetail();

    expect(httpGet).toHaveBeenCalledWith('/devices/dev-alert-01');
    expect(httpGet).toHaveBeenCalledWith('/alerts', {
      params: { cameraCode: 'CAM-ALERT-01', pageSize: 100 },
    });
    expect(wrapper.get('[data-testid="device-back"]').attributes('href')).toBe('/devices');
    expect(wrapper.get('[data-field="lens-code"]').text()).toBe('CAM-ALERT-01');
    expect(wrapper.get('[data-field="code"]').text()).toBe('CAM-ALERT-01');
    expect(wrapper.get('[data-field="name"]').text()).toBe('温度告警镜头');
    expect(wrapper.get('[data-field="type"]').text()).toBe('摄像头');
    expect(wrapper.get('[data-field="shed"]').text()).toBe('S01');
    expect(wrapper.get('[data-field="status"]').text()).toBe('离线');
    expect(wrapper.get('[data-field="note"]').text()).toBe('镜头码对照告警');
    expect(wrapper.get('[data-field="heartbeat"]').text()).toBe('—');
    expect(wrapper.get('[data-field="alert-title"]').text()).toBe('镜头详情告警');
    expect(wrapper.get('[data-field="alert-title"]').attributes('href')).toBe('/alerts/alert-detail-01');
    expect(wrapper.get('[data-field="alert-level"]').text()).toBe('一般');
    expect(wrapper.get('[data-field="alert-status"]').text()).toBe('待确认');
    expect(wrapper.text()).toContain('相关告警');
    expect(wrapper.text()).not.toContain('暂无相关告警');
    wrapper.unmount();
  });

  it('shows an empty related-alert line when this camera has none', async () => {
    httpGet.mockImplementation((url: string) => {
      if (url === '/devices/dev-alert-01') return Promise.resolve({ data: device });
      if (url === '/alerts') return Promise.resolve({ data: { items: [], total: 0 } });
      return Promise.reject(new Error(url));
    });
    const wrapper = await mountDetail();

    expect(wrapper.get('[data-testid="device-alerts"]').text()).toContain('暂无相关告警');
    expect(wrapper.find('table').exists()).toBe(false);
    wrapper.unmount();
  });

  it('keeps the camera fields and does not show an empty alert table when alerts fail', async () => {
    httpGet.mockImplementation((url: string) => {
      if (url === '/devices/dev-alert-01') return Promise.resolve({ data: device });
      return Promise.reject(new Error('down'));
    });
    const wrapper = await mountDetail();

    expect(wrapper.get('[data-field="code"]').text()).toBe('CAM-ALERT-01');
    expect(wrapper.get('[data-testid="device-alerts-error"]').text()).toBe('请求失败');
    expect(wrapper.text()).not.toContain('暂无相关告警');
    expect(wrapper.find('[data-testid="device-alerts"] table').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows the error and not the detail when the device cannot be loaded', async () => {
    httpGet.mockRejectedValue(new Error('down'));
    const wrapper = await mountDetail();

    expect(wrapper.get('[data-testid="device-detail-error"]').text()).toBe('请求失败');
    expect(wrapper.find('[data-testid="device-detail"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="device-alerts"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
