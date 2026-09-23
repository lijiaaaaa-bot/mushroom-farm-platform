import { flushPromises, mount } from '@vue/test-utils';
import type { Component } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AlertsView from './AlertsView.vue';
import DevicesView from './DevicesView.vue';
import HarvestView from './HarvestView.vue';
import ReportsView from './ReportsView.vue';

const httpGet = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: {
    get: httpGet,
    post: vi.fn(),
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

describe('AlertsView', () => {
  beforeEach(() => {
    localStorage.clear();
    httpGet.mockReset();
  });

  it('renders rows from GET /alerts', async () => {
    httpGet.mockResolvedValue({ data: { items: [alert], total: 1 } });
    const wrapper = await mountView(AlertsView);

    expect(httpGet).toHaveBeenCalledWith('/alerts?pageSize=50');
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
