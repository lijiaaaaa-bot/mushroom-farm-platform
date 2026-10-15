import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReportsView from './ReportsView.vue';

const httpGet = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: { get: httpGet },
  errorText: () => '请求失败',
}));

describe('ReportsView preview', () => {
  beforeEach(() => {
    httpGet.mockReset();
    window.history.replaceState({}, '', '/');
  });

  it('previews a filtered growth sheet and prints that preview', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    httpGet.mockImplementation((url: string) => {
      if (String(url).includes('/reports/preview')) {
        return Promise.resolve({
          data: {
            title: '园区生长',
            columns: [
              { key: 'shedCode', header: '棚区' },
              { key: 'period', header: '周期' },
              { key: 'mushroomCount', header: '蘑菇数量' },
            ],
            rows: [{ shedCode: 'S01', period: '2026-09-21', mushroomCount: 14 }],
          },
        });
      }
      return Promise.resolve({ data: new Blob(['xlsx']) });
    });
    const wrapper = mount(ReportsView);
    await wrapper.get('[data-testid="report-filters"] select').setValue('growth');
    await wrapper.get('form[data-testid="report-filters"]').trigger('submit');
    await flushPromises();

    expect(httpGet).toHaveBeenCalledWith('/reports/preview', {
      params: expect.objectContaining({ kind: 'growth', grain: 'day' }),
    });
    expect(wrapper.get('[data-testid="report-preview"]').text()).toContain('园区生长');
    expect(wrapper.get('[data-testid="report-preview"]').text()).toContain('S01');
    expect(wrapper.get('[data-testid="report-preview"]').text()).toContain('14');
    expect(wrapper.get('[data-testid="report-summary"]').text()).toBe('棚区 全部 · 共 1 条');

    const printButton = wrapper.get('[data-testid="report-print"]');
    expect(printButton.element.disabled).toBe(false);
    await printButton.trigger('click');
    expect(print).toHaveBeenCalled();
    print.mockRestore();
    wrapper.unmount();
  });

  it('shows an error instead of an empty preview when the filter request fails', async () => {
    httpGet.mockRejectedValue(new Error('down'));
    const wrapper = mount(ReportsView);
    await wrapper.get('form[data-testid="report-filters"]').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('请求失败');
    expect(wrapper.find('[data-testid="report-preview"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('previews devices with online=online and exports the same params', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:report');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    httpGet.mockImplementation((url: string) => {
      if (String(url).includes('/reports/preview')) {
        return Promise.resolve({
          data: { title: '设备在线', columns: [], rows: [] },
        });
      }
      return Promise.resolve({ data: new Blob(['xlsx']) });
    });
    const wrapper = mount(ReportsView);
    expect(wrapper.find('[data-testid="report-online"]').exists()).toBe(false);

    await wrapper.get('[data-testid="report-filters"] select').setValue('devices');
    expect(wrapper.find('[data-testid="report-status"]').exists()).toBe(false);
    const online = wrapper.get('[data-testid="report-online"]');
    expect(online.text()).toContain('全部');
    expect(online.text()).toContain('在线');
    expect(online.text()).toContain('离线');

    await wrapper.get('form[data-testid="report-filters"]').trigger('submit');
    await flushPromises();
    const allCall = httpGet.mock.calls.find((call) => call[0] === '/reports/preview');
    expect(allCall?.[1].params.online).toBeUndefined();
    expect(allCall?.[1].params.status).toBeUndefined();

    await online.setValue('online');
    await wrapper.get('form[data-testid="report-filters"]').trigger('submit');
    await flushPromises();
    expect(httpGet).toHaveBeenCalledWith('/reports/preview', {
      params: expect.objectContaining({ kind: 'devices', online: 'online' }),
    });

    const exportButton = wrapper.findAll('button').find((button) => button.text() === '导出');
    await exportButton?.trigger('click');
    await flushPromises();
    const exportCall = httpGet.mock.calls.find((call) => call[0] === '/reports/export.xlsx');
    expect(exportCall?.[1]).toEqual(
      expect.objectContaining({
        params: expect.objectContaining({ kind: 'devices', online: 'online' }),
        responseType: 'blob',
      }),
    );
    expect(exportCall?.[1].params.status).toBeUndefined();
    expect(wrapper.get('[data-testid="report-download"]').text()).toBe('已开始下载 devices.xlsx');
    wrapper.unmount();
  });

  it('previews alerts with the selected status', async () => {
    httpGet.mockResolvedValue({
      data: { title: '告警闭环', columns: [], rows: [] },
    });
    const wrapper = mount(ReportsView);
    await wrapper.get('[data-testid="report-filters"] select').setValue('alerts');
    expect(wrapper.find('[data-testid="report-online"]').exists()).toBe(false);
    const status = wrapper.get('[data-testid="report-status"]');
    expect(status.text()).toContain('待确认');
    expect(status.text()).toContain('已确认');
    expect(status.text()).toContain('已关闭');

    await status.setValue('acked');
    await wrapper.get('form[data-testid="report-filters"]').trigger('submit');
    await flushPromises();
    expect(httpGet).toHaveBeenCalledWith('/reports/preview', {
      params: expect.objectContaining({ kind: 'alerts', status: 'acked' }),
    });
    const call = httpGet.mock.calls.find((call) => call[0] === '/reports/preview');
    expect(call?.[1].params.online).toBeUndefined();
    wrapper.unmount();
  });

  it('shows alert level, status, and close reason in Chinese', async () => {
    window.history.pushState(
      {},
      '',
      '/reports?kind=alerts&status=closed&shedCode=S01&from=2026-10-14&to=2026-10-14',
    );
    httpGet.mockResolvedValue({
      data: {
        title: '告警闭环',
        columns: [
          { key: 'level', header: '等级' },
          { key: 'status', header: '状态' },
          { key: 'closeReason', header: '关闭原因' },
          { key: 'title', header: '标题' },
          { key: 'cameraCode', header: '摄像头' },
        ],
        rows: [
          {
            level: 'warning',
            status: 'closed',
            closeReason: 'resolved',
            title: '台账已关闭告警',
            cameraCode: 'CAM-ALED-CLOSED',
          },
        ],
      },
    });
    const wrapper = mount(ReportsView);
    await flushPromises();
    const text = wrapper.get('[data-testid="report-preview"]').text();
    expect(text).toContain('告警闭环');
    expect(text).toContain('一般');
    expect(text).toContain('已关闭');
    expect(text).toContain('正常关闭');
    expect(text).toContain('台账已关闭告警');
    expect(text).toContain('CAM-ALED-CLOSED');
    expect(text).not.toContain('resolved');
    expect(text).not.toContain('warning');
    wrapper.unmount();
  });

  it('does not preview until asked when the address has no kind', async () => {
    const wrapper = mount(ReportsView);
    await flushPromises();
    expect(httpGet).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="report-preview"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('loads growth rows from the address query', async () => {
    window.history.pushState(
      {},
      '',
      '/reports?kind=growth&grain=day&shedCode=S02&from=2026-10-14&to=2026-10-14',
    );
    httpGet.mockResolvedValue({
      data: {
        title: '园区生长',
        columns: [
          { key: 'shedCode', header: '棚区' },
          { key: 'period', header: '周期' },
          { key: 'mushroomCount', header: '蘑菇数量' },
        ],
        rows: [{ shedCode: 'S02', period: '2026-10-14', mushroomCount: 17 }],
      },
    });
    const wrapper = mount(ReportsView);
    await flushPromises();

    expect(httpGet).toHaveBeenCalledWith('/reports/preview', {
      params: expect.objectContaining({
        kind: 'growth',
        grain: 'day',
        shedCode: 'S02',
        from: '2026-10-14',
        to: '2026-10-14',
      }),
    });
    expect(wrapper.get('[data-testid="report-preview"]').text()).toContain('S02');
    expect(wrapper.get('[data-testid="report-preview"]').text()).toContain('17');
    expect(wrapper.get('[data-testid="report-summary"]').text()).toBe('棚区 S02 · 共 1 条');
    expect(wrapper.get('[data-testid="report-print"]').element.disabled).toBe(false);
    expect(window.location.pathname).toBe('/reports');
    expect(window.location.search).toContain('shedCode=S02');
    wrapper.unmount();
  });

  it('keeps print disabled until the preview has rows', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const wrapper = mount(ReportsView);
    expect(wrapper.get('[data-testid="report-print"]').element.disabled).toBe(true);
    await wrapper.get('[data-testid="report-print"]').trigger('click');
    expect(print).not.toHaveBeenCalled();

    httpGet.mockResolvedValue({
      data: { title: '园区生长', columns: [], rows: [] },
    });
    await wrapper.get('form[data-testid="report-filters"]').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[data-testid="report-summary"]').text()).toBe('棚区 全部 · 共 0 条');
    expect(wrapper.text()).toContain('该筛选下没有数据。');
    expect(wrapper.get('[data-testid="report-print"]').element.disabled).toBe(true);
    await wrapper.get('[data-testid="report-print"]').trigger('click');
    expect(print).not.toHaveBeenCalled();
    print.mockRestore();
    wrapper.unmount();
  });
});
