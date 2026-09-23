import { flushPromises, mount } from '@vue/test-utils';
import type { Component } from 'vue';
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

async function mountView(component: Component) {
  const wrapper = mount(component);
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

    expect(httpGet).toHaveBeenCalledWith('/alerts?pageSize=50');
    expect(wrapper.get('a[href="/phase2/wecom"]').text()).toBe('企微/钉钉推送');
    expect(wrapper.text()).toContain('高温');
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
