import { flushPromises, mount } from '@vue/test-utils';
import type { Component } from 'vue';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AlertsView from './AlertsView.vue';
import DevicesView from './DevicesView.vue';
import HarvestView from './HarvestView.vue';
import ReportsView from './ReportsView.vue';

import { currentUser, type SessionUser } from '../auth';

const httpGet = vi.hoisted(() => vi.fn());
const httpPost = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: {
    get: httpGet,
    post: httpPost,
  },
  errorText: () => '请求失败',
}));

const device = {
  id: 'device-1',
  code: 'CAM-S01',
  name: '东摄像头',
  type: 'camera' as const,
  shedCode: 'S01',
  onlineStatus: 'online',
  lastSeenAt: '2026-09-23T01:02:00.000Z',
};

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

const harvestItem = {
  id: 'rec-1',
  shedCode: 'S01',
  cameraCode: 'CAM-S01',
  matureCount: 4,
  mushroomCount: 10,
  recognizedAt: '2026-09-23T01:02:00.000Z',
};

const harvestSummary = {
  matureCount: 4,
  mushroomCount: 10,
  harvestableCameras: 1,
};

let memoryRouter: Router;

async function mountView(component: Component, query: Record<string, string> = {}) {
  memoryRouter = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
  });
  await memoryRouter.push({ path: '/alerts', query });
  await memoryRouter.isReady();
  const wrapper = mount(component, { global: { plugins: [memoryRouter] } });
  await flushPromises();
  return wrapper;
}

describe('DevicesView', () => {
  beforeEach(() => {
    httpGet.mockReset();
  });

  it('renders rows from GET /devices', async () => {
    httpGet.mockResolvedValue({ data: { items: [device], total: 1 } });
    const wrapper = await mountView(DevicesView);

    expect(httpGet).toHaveBeenCalledWith('/devices?pageSize=100');
    expect(wrapper.text()).toContain('CAM-S01');
    expect(wrapper.text()).toContain('东摄像头');
    expect(wrapper.text()).toContain('摄像头');
    expect(wrapper.text()).toContain('在线');
    expect(wrapper.text()).not.toContain('暂无设备');
    wrapper.unmount();
  });

  it('shows empty copy when the device list is empty', async () => {
    httpGet.mockResolvedValue({ data: { items: [], total: 0 } });
    const wrapper = await mountView(DevicesView);

    expect(wrapper.text()).toContain('暂无设备。识别上报会自动建档。');
    expect(wrapper.find('table').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows error text when the device list fails', async () => {
    httpGet.mockRejectedValue(new Error('down'));
    const wrapper = await mountView(DevicesView);

    expect(wrapper.text()).toContain('请求失败');
    expect(wrapper.text()).not.toContain('暂无设备');
    expect(wrapper.find('table').exists()).toBe(false);
    wrapper.unmount();
  });
});

function asUser(role: SessionUser['role']) {
  currentUser.value = {
    id: 'user-1',
    username: role === 'shed_manager' ? 'shed-a' : role,
    displayName: role,
    role,
    shedCodes: ['S01'],
  };
}

function buttonText(wrapper: { findAll: (selector: string) => { text: () => string }[] }, label: string) {
  return wrapper.findAll('button').some((button) => button.text() === label);
}

describe('AlertsView', () => {
  beforeEach(() => {
    localStorage.clear();
    httpGet.mockReset();
    httpPost.mockReset();
    currentUser.value = null;
  });

  it('renders rows from GET /alerts', async () => {
    httpGet.mockResolvedValue({ data: { items: [alert], total: 1 } });
    const wrapper = await mountView(AlertsView);

    expect(httpGet).toHaveBeenCalledWith('/alerts', {
      params: { pageSize: 50, status: undefined, level: undefined },
    });
    expect(wrapper.get('a[href="/phase2/wecom"]').text()).toBe('企微/钉钉推送');
    expect(wrapper.text()).toContain('高温');
    expect(wrapper.get('[data-testid="alert-camera"]').text()).toBe('CAM-S01');
    expect(wrapper.get('[data-testid="alert-detail-link"]').attributes('href')).toBe('/alerts/alert-1');
    expect(wrapper.text()).toContain('严重');
    expect(wrapper.text()).toContain('待确认');
    expect(wrapper.text()).not.toContain('暂无告警');
    wrapper.unmount();
  });

  it('shows empty copy when the alert list is empty', async () => {
    httpGet.mockResolvedValue({ data: { items: [], total: 0 } });
    const wrapper = await mountView(AlertsView);

    expect(wrapper.text()).toContain('暂无告警。');
    expect(wrapper.find('table').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows error text without the empty copy when the alert list fails', async () => {
    httpGet.mockRejectedValue(new Error('down'));
    const wrapper = await mountView(AlertsView);

    expect(wrapper.text()).toContain('请求失败');
    expect(wrapper.text()).not.toContain('暂无告警');
    expect(wrapper.find('table').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows the claimant and posts claim and false-positive close for an operator', async () => {
    asUser('shed_manager');
    httpGet.mockResolvedValue({
      data: {
        items: [
          {
            ...alert,
            claimedBy: 'shed-a',
            claimNote: '我来处理',
            closeReason: null,
            closeNote: null,
          },
        ],
        total: 1,
      },
    });
    httpPost.mockResolvedValue({ data: {} });
    const wrapper = await mountView(AlertsView);

    expect(wrapper.text()).toContain('shed-a');
    expect(wrapper.text()).toContain('已认领');
    expect(wrapper.text()).toContain('认领备注 我来处理');
    expect(wrapper.find('button.btn-ghost').exists()).toBe(true);
    expect(buttonText(wrapper, '认领')).toBe(true);
    expect(buttonText(wrapper, '误报关闭')).toBe(true);

    await wrapper.get('input[placeholder="处置备注（误报必填）"]').setValue('我来跟进');
    const claim = wrapper.findAll('button').find((button) => button.text() === '认领');
    await claim?.trigger('click');
    await flushPromises();
    expect(httpPost).toHaveBeenCalledWith('/alerts/alert-1/claim', { note: '我来跟进' });

    await wrapper.get('input[placeholder="处置备注（误报必填）"]').setValue('传感器抖动');
    const falsePositive = wrapper.findAll('button').find((button) => button.text() === '误报关闭');
    await falsePositive?.trigger('click');
    await flushPromises();
    expect(httpPost).toHaveBeenCalledWith('/alerts/alert-1/false-positive', {
      note: '传感器抖动',
    });
    wrapper.unmount();
  });

  it('labels a false-positive close apart from a normal close', async () => {
    asUser('production_admin');
    httpGet.mockResolvedValue({
      data: {
        items: [
          {
            ...alert,
            id: 'alert-fp',
            status: 'closed',
            claimedBy: 'shed-a',
            claimNote: null,
            closeReason: 'false_positive',
            closeNote: '现场核对无异常',
          },
          {
            ...alert,
            id: 'alert-ok',
            title: '已处置',
            status: 'closed',
            claimedBy: null,
            claimNote: null,
            closeReason: 'resolved',
            closeNote: '已恢复',
          },
        ],
        total: 2,
      },
    });
    const wrapper = await mountView(AlertsView);

    expect(wrapper.text()).toContain('误报');
    expect(wrapper.text()).toContain('正常关闭');
    expect(wrapper.text()).toContain('关闭备注 现场核对无异常');
    expect(buttonText(wrapper, '认领')).toBe(false);
    expect(buttonText(wrapper, '误报关闭')).toBe(false);
    wrapper.unmount();
  });

  it('does not post a false-positive close when the note is blank', async () => {
    asUser('production_admin');
    httpGet.mockResolvedValue({ data: { items: [alert], total: 1 } });
    const wrapper = await mountView(AlertsView);

    await wrapper.get('input[placeholder="处置备注（误报必填）"]').setValue('   ');
    const falsePositive = wrapper.findAll('button').find((button) => button.text() === '误报关闭');
    expect(falsePositive?.attributes('disabled')).toBeDefined();
    await falsePositive?.trigger('click');
    await flushPromises();
    expect(httpPost).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('hides claim and false-positive controls for a viewer', async () => {
    asUser('viewer');
    httpGet.mockResolvedValue({
      data: {
        items: [
          {
            ...alert,
            claimedBy: 'shed-a',
            claimNote: '已认领',
            closeReason: null,
            closeNote: null,
          },
        ],
        total: 1,
      },
    });
    const wrapper = await mountView(AlertsView);

    expect(wrapper.text()).toContain('高温');
    expect(wrapper.text()).toContain('shed-a');
    expect(buttonText(wrapper, '认领')).toBe(false);
    expect(buttonText(wrapper, '误报关闭')).toBe(false);
    expect(buttonText(wrapper, '确认')).toBe(false);
    expect(buttonText(wrapper, '关闭')).toBe(false);
    expect(buttonText(wrapper, '新建告警')).toBe(false);
    expect(wrapper.find('table').exists()).toBe(true);
    wrapper.unmount();
  });

  it('confirms a pending alert and still shows 已确认 after refresh', async () => {
    asUser('shed_manager');
    const open = {
      ...alert,
      title: '温度过高告警',
      cameraCode: 'CAM-ALERT-01',
      status: 'open' as const,
    };
    const acked = { ...open, status: 'acked' as const };
    httpGet.mockResolvedValueOnce({ data: { items: [open], total: 1 } });
    httpPost.mockResolvedValue({ data: acked });
    const wrapper = await mountView(AlertsView);

    expect(wrapper.get('[data-testid="alert-status"]').text()).toBe('待确认');
    expect(wrapper.get('[data-testid="alert-ack"]').text()).toBe('确认');
    httpGet.mockResolvedValue({ data: { items: [acked], total: 1 } });
    await wrapper.get('[data-testid="alert-ack"]').trigger('click');
    await flushPromises();

    expect(httpPost).toHaveBeenCalledWith('/alerts/alert-1/ack', { note: '已确认' });
    expect(wrapper.get('[data-testid="alert-status"]').text()).toBe('已确认');
    expect(wrapper.find('[data-testid="alert-ack"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="alert-close"]').text()).toBe('关闭');
    wrapper.unmount();

    httpGet.mockResolvedValue({ data: { items: [acked], total: 1 } });
    const refreshed = await mountView(AlertsView);
    expect(httpGet).toHaveBeenCalledWith('/alerts', {
      params: { pageSize: 50, status: undefined, level: undefined },
    });
    expect(refreshed.get('[data-testid="alert-status"]').text()).toBe('已确认');
    expect(refreshed.find('[data-testid="alert-ack"]').exists()).toBe(false);
    expect(refreshed.get('[data-testid="alert-close"]').text()).toBe('关闭');
    refreshed.unmount();
  });

  it('closes a pending alert and still shows 已关闭 after refresh', async () => {
    asUser('production_admin');
    const open = {
      ...alert,
      title: '温度过高告警',
      status: 'open' as const,
    };
    const closed = {
      ...open,
      status: 'closed' as const,
      closeReason: 'resolved' as const,
      closeNote: '已确认',
    };
    httpGet.mockResolvedValueOnce({ data: { items: [open], total: 1 } });
    httpPost.mockResolvedValue({ data: closed });
    const wrapper = await mountView(AlertsView);

    expect(wrapper.get('[data-testid="alert-status"]').text()).toBe('待确认');
    httpGet.mockResolvedValue({ data: { items: [closed], total: 1 } });
    await wrapper.get('[data-testid="alert-close"]').trigger('click');
    await flushPromises();

    expect(httpPost).toHaveBeenCalledWith('/alerts/alert-1/close', { note: '已确认' });
    expect(wrapper.get('[data-testid="alert-status"]').text()).toBe('已关闭');
    expect(wrapper.text()).toContain('正常关闭');
    expect(wrapper.text()).toContain('关闭备注 已确认');
    expect(wrapper.find('[data-testid="alert-ack"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="alert-close"]').exists()).toBe(false);
    wrapper.unmount();

    httpGet.mockResolvedValue({ data: { items: [closed], total: 1 } });
    const refreshed = await mountView(AlertsView);
    expect(refreshed.get('[data-testid="alert-status"]').text()).toBe('已关闭');
    expect(refreshed.text()).toContain('正常关闭');
    expect(refreshed.find('[data-testid="alert-ack"]').exists()).toBe(false);
    expect(refreshed.find('[data-testid="alert-close"]').exists()).toBe(false);
    refreshed.unmount();
  });

  it('sends status and level when selected and omits both when set back to 全部', async () => {
    httpGet.mockResolvedValue({ data: { items: [alert], total: 1 } });
    const wrapper = await mountView(AlertsView);

    const status = wrapper.get('[data-testid="alert-status-filter"]');
    expect(status.text()).toContain('全部');
    expect(status.text()).toContain('待确认');
    expect(status.text()).toContain('已确认');
    expect(status.text()).toContain('已关闭');
    const level = wrapper.get('[data-testid="alert-level-filter"]');
    expect(level.text()).toContain('全部');
    expect(level.text()).toContain('严重');

    await status.setValue('open');
    await flushPromises();
    expect(httpGet).toHaveBeenCalledWith('/alerts', {
      params: { pageSize: 50, status: 'open', level: undefined },
    });

    await level.setValue('severe');
    await flushPromises();
    expect(httpGet).toHaveBeenCalledWith('/alerts', {
      params: { pageSize: 50, status: 'open', level: 'severe' },
    });

    await status.setValue('');
    await level.setValue('');
    await flushPromises();
    const calls = httpGet.mock.calls;
    const last = calls[calls.length - 1];
    expect(last?.[0]).toBe('/alerts');
    expect(last?.[1].params.pageSize).toBe(50);
    expect(last?.[1].params.status).toBeUndefined();
    expect(last?.[1].params.level).toBeUndefined();
    wrapper.unmount();
  });

  it('keeps the current status and level when reloading after claim', async () => {
    asUser('shed_manager');
    httpGet.mockResolvedValue({ data: { items: [alert], total: 1 } });
    httpPost.mockResolvedValue({ data: {} });
    const wrapper = await mountView(AlertsView);

    await wrapper.get('[data-testid="alert-status-filter"]').setValue('acked');
    await wrapper.get('[data-testid="alert-level-filter"]').setValue('severe');
    await flushPromises();
    httpGet.mockClear();

    await wrapper.get('input[placeholder="处置备注（误报必填）"]').setValue('继续跟进');
    const claim = wrapper.findAll('button').find((button) => button.text() === '认领');
    await claim?.trigger('click');
    await flushPromises();

    expect(httpPost).toHaveBeenCalledWith('/alerts/alert-1/claim', { note: '继续跟进' });
    expect(httpGet).toHaveBeenCalledWith('/alerts', {
      params: { pageSize: 50, status: 'acked', level: 'severe' },
    });
    wrapper.unmount();
  });

  it('applies shed and status from the duty deep link and highlights that alert', async () => {
    const scrollIntoView = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView as typeof HTMLElement.prototype.scrollIntoView;
    httpGet.mockResolvedValue({
      data: {
        items: [alert, { ...alert, id: 'alert-2', title: '另一条' }],
        total: 2,
      },
    });
    try {
      const wrapper = await mountView(AlertsView, {
        shedCode: 'S01',
        status: 'open',
        alertId: 'alert-1',
      });

      expect(httpGet).toHaveBeenCalledWith('/alerts', {
        params: { pageSize: 50, status: 'open', level: undefined, shedCode: 'S01' },
      });
      expect((wrapper.get('[data-testid="alert-status-filter"]').element as HTMLSelectElement).value).toBe('open');
      expect(wrapper.get('[data-testid="alert-shed-scope"]').text()).toBe('棚 S01');
      expect(wrapper.get('[data-alert-id="alert-1"]').attributes('data-highlight')).toBe('true');
      expect(wrapper.get('[data-alert-id="alert-2"]').attributes('data-highlight')).toBeUndefined();
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });

      await wrapper.get('[data-testid="alert-status-filter"]').setValue('acked');
      await flushPromises();
      expect(httpGet).toHaveBeenCalledWith('/alerts', {
        params: { pageSize: 50, status: 'acked', level: undefined, shedCode: 'S01' },
      });

      await memoryRouter.push('/alerts');
      await flushPromises();
      expect(httpGet).toHaveBeenCalledWith('/alerts', {
        params: { pageSize: 50, status: undefined, level: undefined },
      });
      expect(wrapper.find('[data-testid="alert-shed-scope"]').exists()).toBe(false);
      expect(wrapper.get('[data-alert-id="alert-1"]').attributes('data-highlight')).toBeUndefined();
      wrapper.unmount();
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });

  it('ignores a status query that is not an alert status', async () => {
    httpGet.mockResolvedValue({ data: { items: [alert], total: 1 } });
    const wrapper = await mountView(AlertsView, { status: 'nope', shedCode: 'S02' });
    expect(httpGet).toHaveBeenCalledWith('/alerts', {
      params: { pageSize: 50, status: undefined, level: undefined, shedCode: 'S02' },
    });
    expect((wrapper.get('[data-testid="alert-status-filter"]').element as HTMLSelectElement).value).toBe('');
    wrapper.unmount();
  });

  it('filters by camera code, keeps the detail link, and restores both cameras on clear', async () => {
    const east = {
      ...alert,
      id: 'alert-east',
      cameraCode: 'CAM-FILTER-01',
      title: '东侧过道告警',
    };
    const west = {
      ...alert,
      id: 'alert-west',
      cameraCode: 'CAM-FILTER-02',
      title: '西侧过道告警',
    };
    httpGet.mockImplementation((_url: string, config?: { params?: { cameraCode?: string; status?: string } }) => {
      const code = config?.params?.cameraCode;
      const items = [east, west].filter((row) => !code || row.cameraCode === code);
      return Promise.resolve({ data: { items, total: items.length } });
    });
    const wrapper = await mountView(AlertsView);

    expect(wrapper.findAll('[data-testid="alert-camera"]').map((node) => node.text())).toEqual([
      'CAM-FILTER-01',
      'CAM-FILTER-02',
    ]);
    expect(wrapper.findAll('[data-testid="alert-detail-link"]')).toHaveLength(2);

    await wrapper.get('[data-testid="alert-camera-filter"]').setValue(' CAM-FILTER-02 ');
    await wrapper.get('[data-testid="alert-camera-apply"]').trigger('click');
    await flushPromises();

    expect(httpGet).toHaveBeenCalledWith('/alerts', {
      params: { pageSize: 50, status: undefined, level: undefined, cameraCode: 'CAM-FILTER-02' },
    });
    expect(wrapper.get('[data-testid="alert-camera-scope"]').text()).toBe('摄像头 CAM-FILTER-02');
    expect(wrapper.findAll('[data-testid="alert-camera"]').map((node) => node.text())).toEqual([
      'CAM-FILTER-02',
    ]);
    expect(wrapper.text()).not.toContain('东侧过道告警');
    expect(wrapper.get('[data-testid="alert-detail-link"]').attributes('href')).toBe(
      '/alerts/alert-west?cameraCode=CAM-FILTER-02',
    );

    await wrapper.get('[data-testid="alert-status-filter"]').setValue('open');
    await flushPromises();
    expect(httpGet).toHaveBeenCalledWith('/alerts', {
      params: { pageSize: 50, status: 'open', level: undefined, cameraCode: 'CAM-FILTER-02' },
    });

    await wrapper.get('[data-testid="alert-camera-clear"]').trigger('click');
    await flushPromises();
    const calls = httpGet.mock.calls;
    const last = calls[calls.length - 1];
    expect(last?.[0]).toBe('/alerts');
    expect(last?.[1].params.cameraCode).toBeUndefined();
    expect(last?.[1].params.status).toBe('open');
    expect(wrapper.find('[data-testid="alert-camera-scope"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-testid="alert-camera"]').map((node) => node.text())).toEqual([
      'CAM-FILTER-01',
      'CAM-FILTER-02',
    ]);
    expect(wrapper.findAll('[data-testid="alert-detail-link"]')).toHaveLength(2);
    wrapper.unmount();
  });

  it('applies cameraCode from the address and omits a blank value', async () => {
    httpGet.mockResolvedValue({ data: { items: [alert], total: 1 } });
    const wrapper = await mountView(AlertsView, { cameraCode: 'CAM-FILTER-02' });
    expect((wrapper.get('[data-testid="alert-camera-filter"]').element as HTMLInputElement).value).toBe(
      'CAM-FILTER-02',
    );
    expect(httpGet).toHaveBeenCalledWith('/alerts', {
      params: { pageSize: 50, status: undefined, level: undefined, cameraCode: 'CAM-FILTER-02' },
    });
    wrapper.unmount();

    httpGet.mockClear();
    const blank = await mountView(AlertsView, { cameraCode: '   ' });
    expect(httpGet).toHaveBeenCalledWith('/alerts', {
      params: { pageSize: 50, status: undefined, level: undefined },
    });
    expect(blank.find('[data-testid="alert-camera-scope"]').exists()).toBe(false);
    blank.unmount();
  });
});

describe('HarvestView', () => {
  beforeEach(() => {
    httpGet.mockReset();
  });

  it('renders the daily harvest list from GET /harvest/daily', async () => {
    httpGet.mockResolvedValue({
      data: { date: '2026-09-23', summary: harvestSummary, items: [harvestItem] },
    });
    const wrapper = await mountView(HarvestView);
    const date = (wrapper.get('input[type="date"]').element as HTMLInputElement).value;

    expect(httpGet).toHaveBeenCalledWith('/harvest/daily', { params: { date } });
    expect(wrapper.text()).toContain('S01');
    expect(wrapper.text()).toContain('CAM-S01');
    expect(wrapper.text()).toContain('可采摄像头');
    expect(wrapper.text()).not.toContain('当日无识别记录');
    wrapper.unmount();
  });

  it('shows empty copy when the daily harvest items are empty', async () => {
    httpGet.mockResolvedValue({
      data: {
        date: '2026-09-23',
        summary: { matureCount: 0, mushroomCount: 0, harvestableCameras: 0 },
        items: [],
      },
    });
    const wrapper = await mountView(HarvestView);

    expect(wrapper.text()).toContain('当日无识别记录。');
    expect(wrapper.find('table').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows error text when the harvest query fails', async () => {
    httpGet.mockRejectedValue(new Error('down'));
    const wrapper = await mountView(HarvestView);

    expect(wrapper.text()).toContain('请求失败');
    expect(wrapper.text()).not.toContain('当日无识别记录');
    expect(wrapper.find('table').exists()).toBe(false);
    wrapper.unmount();
  });
});

describe('ReportsView', () => {
  beforeEach(() => {
    httpGet.mockReset();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:report');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('downloads a report workbook from GET /reports/:file', async () => {
    httpGet.mockResolvedValue({ data: new Blob(['xlsx']) });
    const wrapper = mount(ReportsView);

    await wrapper.get('button').trigger('click');
    await flushPromises();

    expect(httpGet).toHaveBeenCalledWith('/reports/growth.xlsx', { responseType: 'blob' });
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(wrapper.text()).not.toContain('该报表没有可导出的数据');
    expect(wrapper.text()).not.toContain('请求失败');
    wrapper.unmount();
  });

  it('shows empty copy when the report blob is empty', async () => {
    httpGet.mockResolvedValue({ data: new Blob([]) });
    const wrapper = mount(ReportsView);

    await wrapper.get('button').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('该报表没有可导出的数据。');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('shows error text when the report download fails', async () => {
    httpGet.mockRejectedValue(new Error('down'));
    const wrapper = mount(ReportsView);

    await wrapper.get('button').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('请求失败');
    expect(wrapper.text()).not.toContain('该报表没有可导出的数据');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
