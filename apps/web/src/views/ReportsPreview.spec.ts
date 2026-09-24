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

    const printButton = wrapper.findAll('button').find((button) => button.text() === '打印');
    await printButton?.trigger('click');
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
});
