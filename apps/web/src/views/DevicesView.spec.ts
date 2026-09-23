import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { currentUser, type SessionUser } from '../auth';
import DevicesView from './DevicesView.vue';

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

const csv = '设备编码,棚编码,名称\nCAM-S01,S01,东摄像头\nCAM-X,S99,无棚\n';

function asUser(role: SessionUser['role']) {
  currentUser.value = {
    id: 'user-1',
    username: role,
    displayName: role,
    role,
    shedCodes: ['S01'],
  };
}

async function mountView() {
  const wrapper = mount(DevicesView);
  await flushPromises();
  return wrapper;
}

describe('DevicesView batch import', () => {
  beforeEach(() => {
    localStorage.clear();
    httpGet.mockReset();
    httpPost.mockReset();
    currentUser.value = null;
    asUser('production_admin');
  });

  it('shows a file picker and a paste area', async () => {
    httpGet.mockResolvedValue({ data: { items: [], total: 0 } });
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('批量导入');
    expect(wrapper.find('input[aria-label="CSV 文件"]').exists()).toBe(true);
    expect(wrapper.find('textarea[aria-label="粘贴 CSV"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('imports pasted CSV and refreshes the device list', async () => {
    httpGet
      .mockResolvedValueOnce({ data: { items: [], total: 0 } })
      .mockResolvedValueOnce({ data: { items: [device], total: 1 } });
    httpPost.mockResolvedValue({
      data: {
        successCount: 1,
        failCount: 0,
        skippedCount: 0,
        errors: [],
        skipped: [],
      },
    });
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('暂无设备');
    await wrapper.get('textarea[aria-label="粘贴 CSV"]').setValue(csv);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(httpPost).toHaveBeenCalledWith('/devices/import', { csv });
    expect(httpGet).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('成功 1');
    expect(wrapper.text()).toContain('失败 0');
    expect(wrapper.text()).toContain('CAM-S01');
    expect(wrapper.text()).toContain('东摄像头');
    expect(wrapper.text()).not.toContain('暂无设备');
    wrapper.unmount();
  });

  it('shows the failing row and still refreshes successful devices', async () => {
    httpGet
      .mockResolvedValueOnce({ data: { items: [], total: 0 } })
      .mockResolvedValueOnce({ data: { items: [device], total: 1 } });
    httpPost.mockResolvedValue({
      data: {
        successCount: 1,
        failCount: 1,
        skippedCount: 0,
        errors: [{ row: 2, reason: '棚不存在' }],
        skipped: [],
      },
    });
    const wrapper = await mountView();

    await wrapper.get('textarea[aria-label="粘贴 CSV"]').setValue(csv);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('成功 1，失败 1，跳过 0');
    expect(wrapper.text()).toContain('第 2 行：棚不存在');
    expect(wrapper.text()).toContain('CAM-S01');
    expect(httpGet).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it('posts the selected file and lists a skipped conflict', async () => {
    httpGet
      .mockResolvedValueOnce({ data: { items: [device], total: 1 } })
      .mockResolvedValueOnce({ data: { items: [device], total: 1 } });
    httpPost.mockResolvedValue({
      data: {
        successCount: 0,
        failCount: 0,
        skippedCount: 1,
        errors: [],
        skipped: [{ row: 1, reason: '设备编码已存在，已跳过' }],
      },
    });
    const wrapper = await mountView();
    const input = wrapper.get('input[aria-label="CSV 文件"]');
    const selected = new File([csv], 'cameras.csv', { type: 'text/csv' });
    Object.defineProperty(input.element, 'files', { value: [selected] });
    await input.trigger('change');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(httpPost).toHaveBeenCalledTimes(1);
    const [url, body] = httpPost.mock.calls[0];
    expect(url).toBe('/devices/import');
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('file')).toBeInstanceOf(File);
    expect(wrapper.text()).toContain('跳过 1');
    expect(wrapper.text()).toContain('第 1 行：设备编码已存在，已跳过');
    expect(wrapper.text()).toContain('CAM-S01');
    wrapper.unmount();
  });

  it('hides the import form for viewers', async () => {
    asUser('viewer');
    httpGet.mockResolvedValue({ data: { items: [device], total: 1 } });
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('当前角色不能批量导入设备。');
    expect(wrapper.find('form').exists()).toBe(false);
    expect(wrapper.find('input[type="file"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('CAM-S01');
    wrapper.unmount();
  });
});
