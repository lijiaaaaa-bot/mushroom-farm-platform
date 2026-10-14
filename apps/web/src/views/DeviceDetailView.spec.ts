import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { currentUser, type SessionUser } from '../auth';
import DeviceDetailView from './DeviceDetailView.vue';

const httpGet = vi.hoisted(() => vi.fn());
const httpPatch = vi.hoisted(() => vi.fn());
const httpDelete = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: { get: httpGet, patch: httpPatch, delete: httpDelete },
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

let activeRouter: ReturnType<typeof createRouter>;

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
  activeRouter = router;
  const wrapper = mount(DeviceDetailView, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

function asUser(role: SessionUser['role']) {
  currentUser.value = {
    id: 'user-1',
    username: role,
    displayName: role,
    role,
    shedCodes: ['S01'],
  };
}

describe('DeviceDetailView', () => {
  beforeEach(() => {
    httpGet.mockReset();
    httpPatch.mockReset();
    httpDelete.mockReset();
    currentUser.value = null;
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

  it('shows 在线 and a real last heartbeat on the detail', async () => {
    const beat = '2026-10-14T08:00:00.000Z';
    const online = {
      ...device,
      id: 'dev-dtl-on',
      code: 'CAM-DTL-ON',
      name: '详情在线镜头',
      onlineStatus: 'online' as const,
      lastHeartbeatAt: beat,
      note: '设备详情在线',
    };
    httpGet.mockImplementation((url: string) => {
      if (url === '/devices/dev-dtl-on') return Promise.resolve({ data: online });
      if (url === '/alerts') return Promise.resolve({ data: { items: [], total: 0 } });
      return Promise.reject(new Error(url));
    });
    const wrapper = await mountDetail(online.id);
    const shown = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(beat));

    expect(wrapper.get('[data-field="status"]').text()).toBe('在线');
    expect(wrapper.get('[data-field="heartbeat"]').text()).toBe(shown);
    expect(wrapper.get('[data-field="heartbeat"]').text()).not.toBe('—');
    expect(wrapper.get('[data-field="code"]').text()).toBe('CAM-DTL-ON');
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
    expect(wrapper.find('[data-testid="device-edit"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('saves a note and status, then shows them on the detail', async () => {
    asUser('production_admin');
    httpGet
      .mockResolvedValueOnce({ data: device })
      .mockResolvedValueOnce({ data: { items: [alert], total: 1 } })
      .mockResolvedValueOnce({
        data: { ...device, note: '备注已改', onlineStatus: 'online' },
      });
    httpPatch.mockResolvedValue({
      data: { ...device, note: '备注已改', onlineStatus: 'online' },
    });
    const wrapper = await mountDetail();

    expect(wrapper.get('[data-field="status"]').text()).toBe('离线');
    expect(wrapper.get('[data-field="note"]').text()).toBe('镜头码对照告警');
    expect(wrapper.get('select[aria-label="编辑状态"]').element).toHaveProperty('value', 'offline');
    await wrapper.get('select[aria-label="编辑状态"]').setValue('online');
    await wrapper.get('input[aria-label="编辑备注"]').setValue('备注已改');
    await wrapper.get('[data-testid="device-edit"]').trigger('submit');
    await flushPromises();

    expect(httpPatch).toHaveBeenCalledWith('/devices/dev-alert-01', {
      note: '备注已改',
      onlineStatus: 'online',
    });
    expect(httpGet).toHaveBeenLastCalledWith('/devices/dev-alert-01');
    expect(wrapper.get('[data-field="status"]').text()).toBe('在线');
    expect(wrapper.get('[data-field="note"]').text()).toBe('备注已改');
    expect(wrapper.get('[data-field="heartbeat"]').text()).toBe('—');
    expect(wrapper.get('select[aria-label="编辑状态"]').element).toHaveProperty('value', 'online');
    expect(wrapper.get('input[aria-label="编辑备注"]').element).toHaveProperty('value', '备注已改');
    wrapper.unmount();
  });

  it('hides the edit form for viewers', async () => {
    asUser('viewer');
    httpGet.mockImplementation((url: string) => {
      if (url === '/devices/dev-alert-01') return Promise.resolve({ data: device });
      if (url === '/alerts') return Promise.resolve({ data: { items: [], total: 0 } });
      return Promise.reject(new Error(url));
    });
    const wrapper = await mountDetail();

    expect(wrapper.get('[data-field="note"]').text()).toBe('镜头码对照告警');
    expect(wrapper.find('[data-testid="device-edit"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="device-enabled"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="device-delete"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('保存');
    expect(wrapper.get('[data-field="enabled"]').text()).toBe('启用');
    wrapper.unmount();
  });

  it('deactivates the camera and keeps the detail reachable', async () => {
    asUser('production_admin');
    httpGet
      .mockResolvedValueOnce({ data: { ...device, enabled: true } })
      .mockResolvedValueOnce({ data: { items: [], total: 0 } })
      .mockResolvedValueOnce({
        data: { ...device, enabled: false, note: '停用前', onlineStatus: 'offline' },
      });
    httpPatch.mockResolvedValue({ data: { ...device, enabled: false } });
    const wrapper = await mountDetail();

    expect(wrapper.get('[data-field="enabled"]').text()).toBe('启用');
    expect(wrapper.get('[data-testid="device-enabled"]').text()).toBe('停用');
    await wrapper.get('[data-testid="device-enabled"]').trigger('click');
    await flushPromises();

    expect(httpPatch).toHaveBeenCalledWith('/devices/dev-alert-01', { enabled: false });
    expect(httpGet).toHaveBeenLastCalledWith('/devices/dev-alert-01');
    expect(wrapper.get('[data-field="enabled"]').text()).toBe('停用');
    expect(wrapper.get('[data-field="status"]').text()).toBe('离线');
    expect(wrapper.get('[data-field="note"]').text()).toBe('停用前');
    expect(wrapper.get('[data-field="code"]').text()).toBe('CAM-ALERT-01');
    expect(wrapper.get('[data-testid="device-enabled"]').text()).toBe('启用');
    wrapper.unmount();
  });

  it('deletes the camera and leaves the detail', async () => {
    asUser('production_admin');
    httpGet.mockImplementation((url: string) => {
      if (url === '/devices/dev-alert-01') return Promise.resolve({ data: device });
      if (url === '/alerts') return Promise.resolve({ data: { items: [], total: 0 } });
      return Promise.reject(new Error(url));
    });
    httpDelete.mockResolvedValue({ data: { id: device.id, code: device.code } });
    const wrapper = await mountDetail();

    expect(wrapper.get('[data-testid="device-delete"]').text()).toBe('删除');
    await wrapper.get('[data-testid="device-delete"]').trigger('click');
    await flushPromises();

    expect(httpDelete).toHaveBeenCalledWith('/devices/dev-alert-01');
    expect(activeRouter.currentRoute.value.path).toBe('/devices');
    expect(wrapper.find('[data-testid="device-detail-error"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
