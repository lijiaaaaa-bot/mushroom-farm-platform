import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { currentUser, type SessionUser } from '../auth';
import DevicesView from './DevicesView.vue';

const httpGet = vi.hoisted(() => vi.fn());
const httpPost = vi.hoisted(() => vi.fn());
const httpPatch = vi.hoisted(() => vi.fn());
const httpDelete = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: {
    get: httpGet,
    post: httpPost,
    patch: httpPatch,
    delete: httpDelete,
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
  note: null as string | null,
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

async function mountView(path = '/devices') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/devices', component: DevicesView }],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(DevicesView, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

describe('DevicesView batch import', () => {
  beforeEach(() => {
    localStorage.clear();
    httpGet.mockReset();
    httpPost.mockReset();
    httpPatch.mockReset();
    httpDelete.mockReset();
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
    await wrapper.get('[data-testid="device-import-form"]').trigger('submit');
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
    await wrapper.get('[data-testid="device-import-form"]').trigger('submit');
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
    await wrapper.get('[data-testid="device-import-form"]').trigger('submit');
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

  it('shows online, offline, and the latest heartbeat', async () => {
    httpGet.mockResolvedValue({
      data: {
        items: [
          { ...device, lastHeartbeatAt: device.lastSeenAt },
          {
            id: 'device-2',
            code: 'BOX-S02',
            name: '二号盒',
            type: 'ai_box' as const,
            shedCode: 'S02',
            onlineStatus: 'offline',
            lastSeenAt: null,
            lastHeartbeatAt: null,
          },
        ],
        total: 2,
      },
    });
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('镜头码');
    expect(wrapper.text()).toContain('在线');
    expect(wrapper.text()).toContain('离线');
    expect(wrapper.text()).toContain('09:02');
    expect(wrapper.text()).toContain('—');
    expect(wrapper.text()).toContain('最近心跳');
    const listed = wrapper.findAll('tbody tr');
    expect(listed[0].get('[data-field="lens-code"]').text()).toBe('CAM-S01');
    expect(listed[0].get('[data-field="detail-link"]').attributes('href')).toBe('/devices/device-1');
    expect(listed[0].get('[data-field="detail-entry"]').attributes('href')).toBe('/devices/device-1');
    expect(listed[0].get('[data-field="code"]').text()).toBe('CAM-S01');
    expect(listed[0].get('[data-field="name"]').text()).toBe('东摄像头');
    expect(listed[0].get('[data-field="type"]').text()).toBe('摄像头');
    expect(listed[0].get('[data-field="shed"]').text()).toBe('S01');
    expect(listed[0].get('[data-field="status"]').text()).toBe('在线');
    expect(listed[0].get('[data-field="alert-link"]').attributes('href')).toBe(
      '/alerts?cameraCode=CAM-S01',
    );
    expect(listed[0].get('[data-field="recognition-link"]').attributes('href')).toBe(
      '/recognitions?cameraCode=CAM-S01',
    );
    expect(listed[1].get('[data-field="lens-code"]').text()).toBe('—');
    expect(listed[1].get('[data-field="code"]').text()).toBe('BOX-S02');
    expect(listed[1].find('[data-field="detail-link"]').exists()).toBe(false);
    expect(listed[1].find('[data-field="detail-entry"]').exists()).toBe(false);
    expect(listed[1].find('[data-field="alert-link"]').exists()).toBe(false);
    expect(wrapper.html()).toContain('text-accent');
    expect(wrapper.html()).toContain('bg-canvas');
    wrapper.unmount();
  });

  it('does not render an empty table when the device list fails', async () => {
    httpGet.mockRejectedValue(new Error('down'));
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('请求失败');
    expect(wrapper.text()).not.toContain('暂无设备');
    expect(wrapper.find('table').exists()).toBe(false);
    wrapper.unmount();
  });

  it('hides the import form for viewers', async () => {
    asUser('viewer');
    httpGet.mockResolvedValue({ data: { items: [device], total: 1 } });
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('当前角色不能批量导入设备。');
    expect(wrapper.text()).toContain('当前角色不能登记摄像头。');
    expect(wrapper.find('form').exists()).toBe(false);
    expect(wrapper.find('[data-testid="camera-register-form"]').exists()).toBe(false);
    expect(wrapper.find('input[type="file"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('CAM-S01');
    expect(wrapper.text()).not.toContain('保存');
    expect(wrapper.find('[data-testid="device-enabled-CAM-S01"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="device-delete-CAM-S01"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('registers a camera and shows it in the list', async () => {
    httpGet
      .mockResolvedValueOnce({ data: { items: [], total: 0 } })
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              ...device,
              id: 'device-reg',
              code: 'CAM-REG-01',
              name: '东侧过道',
              onlineStatus: 'offline',
              note: '靠门',
            },
          ],
          total: 1,
        },
      });
    httpPost.mockResolvedValue({ data: { id: 'device-reg' } });
    const wrapper = await mountView();

    await wrapper.get('input[aria-label="摄像头编号"]').setValue('CAM-REG-01');
    await wrapper.get('input[aria-label="棚区"]').setValue('S01');
    await wrapper.get('input[aria-label="名称"]').setValue('东侧过道');
    await wrapper.get('input[aria-label="登记备注"]').setValue('靠门');
    await wrapper.get('[data-testid="camera-register-form"]').trigger('submit');
    await flushPromises();

    expect(httpPost).toHaveBeenCalledWith('/devices', {
      code: 'CAM-REG-01',
      name: '东侧过道',
      type: 'camera',
      shedCode: 'S01',
      note: '靠门',
    });
    expect(wrapper.text()).toContain('CAM-REG-01');
    expect(wrapper.text()).toContain('东侧过道');
    expect(wrapper.get('input[aria-label="备注 CAM-REG-01"]').element).toHaveProperty(
      'value',
      '靠门',
    );
    const created = wrapper.get('[data-testid="camera-created"]');
    expect(created.text()).toContain('已登记');
    expect(created.get('[data-testid="camera-created-detail"]').attributes('href')).toBe(
      '/devices/device-reg',
    );
    const row = wrapper.get('tr[data-code="CAM-REG-01"]');
    expect(row.get('[data-field="detail-link"]').attributes('href')).toBe('/devices/device-reg');
    expect(row.get('[data-field="detail-entry"]').attributes('href')).toBe('/devices/device-reg');
    expect(row.get('[data-field="lens-code"]').text()).toBe('CAM-REG-01');
    wrapper.unmount();
  });

  it('saves a note and shows the reloaded value', async () => {
    httpGet
      .mockResolvedValueOnce({
        data: { items: [{ ...device, note: '靠门' }], total: 1 },
      })
      .mockResolvedValueOnce({
        data: { items: [{ ...device, note: '靠门，已核对' }], total: 1 },
      });
    httpPatch.mockResolvedValue({ data: { id: device.id, note: '靠门，已核对' } });
    const wrapper = await mountView();
    const note = wrapper.get('input[aria-label="备注 CAM-S01"]');
    expect((note.element as HTMLInputElement).value).toBe('靠门');

    await note.setValue('靠门，已核对');
    await wrapper.get('[data-testid="device-edit-CAM-S01"]').trigger('submit');
    await flushPromises();

    expect(httpPatch).toHaveBeenCalledWith('/devices/device-1', {
      note: '靠门，已核对',
      onlineStatus: 'online',
    });
    const gets = httpGet.mock.invocationCallOrder;
    expect(gets[gets.length - 1]).toBeGreaterThan(httpPatch.mock.invocationCallOrder[0]);
    expect(wrapper.get('input[aria-label="备注 CAM-S01"]').element).toHaveProperty(
      'value',
      '靠门，已核对',
    );
    expect(wrapper.get('select[aria-label="状态 CAM-S01"]').element).toHaveProperty(
      'value',
      'online',
    );
    expect(wrapper.get('tr[data-code="CAM-S01"] [data-field="status"]').text()).toBe('在线');
    wrapper.unmount();
  });

  it('saves a status change and shows it in the list', async () => {
    httpGet
      .mockResolvedValueOnce({
        data: { items: [{ ...device, note: '编辑前', onlineStatus: 'offline' }], total: 1 },
      })
      .mockResolvedValueOnce({
        data: {
          items: [{ ...device, note: '备注已改', onlineStatus: 'online' }],
          total: 1,
        },
      });
    httpPatch.mockResolvedValue({
      data: { id: device.id, note: '备注已改', onlineStatus: 'online' },
    });
    const wrapper = await mountView();
    expect(wrapper.get('[data-field="status"]').text()).toBe('离线');
    expect(wrapper.get('select[aria-label="状态 CAM-S01"]').element).toHaveProperty(
      'value',
      'offline',
    );

    await wrapper.get('select[aria-label="状态 CAM-S01"]').setValue('online');
    await wrapper.get('input[aria-label="备注 CAM-S01"]').setValue('备注已改');
    await wrapper.get('[data-testid="device-edit-CAM-S01"]').trigger('submit');
    await flushPromises();

    expect(httpPatch).toHaveBeenCalledWith('/devices/device-1', {
      note: '备注已改',
      onlineStatus: 'online',
    });
    expect(wrapper.get('[data-field="status"]').text()).toBe('在线');
    expect(wrapper.get('input[aria-label="备注 CAM-S01"]').element).toHaveProperty(
      'value',
      '备注已改',
    );
    expect(wrapper.get('select[aria-label="状态 CAM-S01"]').element).toHaveProperty(
      'value',
      'online',
    );
    wrapper.unmount();
  });

  it('deactivates a camera and shows 停用 on the reloaded row', async () => {
    httpGet
      .mockResolvedValueOnce({
        data: {
          items: [{ ...device, note: '停用前', onlineStatus: 'offline', enabled: true }],
          total: 1,
        },
      })
      .mockResolvedValueOnce({
        data: {
          items: [{ ...device, note: '停用前', onlineStatus: 'offline', enabled: false }],
          total: 1,
        },
      });
    httpPatch.mockResolvedValue({ data: { id: device.id, enabled: false } });
    const wrapper = await mountView();
    expect(wrapper.get('[data-field="enabled"]').text()).toBe('启用');
    expect(wrapper.get('[data-field="status"]').text()).toBe('离线');
    expect(wrapper.get('[data-testid="device-enabled-CAM-S01"]').text()).toBe('停用');

    await wrapper.get('[data-testid="device-enabled-CAM-S01"]').trigger('click');
    await flushPromises();

    expect(httpPatch).toHaveBeenCalledWith('/devices/device-1', { enabled: false });
    expect(wrapper.get('[data-field="enabled"]').text()).toBe('停用');
    expect(wrapper.get('[data-field="status"]').text()).toBe('离线');
    expect(wrapper.get('input[aria-label="备注 CAM-S01"]').element).toHaveProperty(
      'value',
      '停用前',
    );
    expect(wrapper.get('[data-testid="device-enabled-CAM-S01"]').text()).toBe('启用');
    expect(wrapper.get('[data-field="detail-entry"]').attributes('href')).toBe('/devices/device-1');
    wrapper.unmount();
  });

  it('lets a shed manager import but not register', async () => {
    asUser('shed_manager');
    httpGet.mockResolvedValue({ data: { items: [device], total: 1 } });
    const wrapper = await mountView();

    expect(wrapper.find('[data-testid="device-import-form"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="camera-register-form"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('当前角色不能登记摄像头。');
    expect(wrapper.text()).not.toContain('保存');
    expect(wrapper.find('[data-testid="device-enabled-CAM-S01"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="device-delete-CAM-S01"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('deletes a camera and drops it from the reloaded list', async () => {
    httpGet
      .mockResolvedValueOnce({
        data: {
          items: [
            { ...device, note: '删除前已改' },
            {
              id: 'device-2',
              code: 'SENSOR-KEEP-01',
              name: '保留传感器',
              type: 'sensor' as const,
              shedCode: 'S01',
              onlineStatus: 'offline',
              lastSeenAt: null,
              note: null,
            },
          ],
          total: 2,
        },
      })
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              id: 'device-2',
              code: 'SENSOR-KEEP-01',
              name: '保留传感器',
              type: 'sensor' as const,
              shedCode: 'S01',
              onlineStatus: 'offline',
              lastSeenAt: null,
              note: null,
            },
          ],
          total: 1,
        },
      });
    httpDelete.mockResolvedValue({ data: { id: device.id, code: device.code } });
    const wrapper = await mountView();

    expect(wrapper.get('[data-testid="device-delete-CAM-S01"]').text()).toBe('删除');
    expect(wrapper.get('[data-testid="device-delete-SENSOR-KEEP-01"]').text()).toBe('删除');
    await wrapper.get('[data-testid="device-delete-CAM-S01"]').trigger('click');
    await flushPromises();

    expect(httpDelete).toHaveBeenCalledWith('/devices/device-1');
    expect(wrapper.text()).not.toContain('CAM-S01');
    expect(wrapper.get('[data-field="code"]').text()).toBe('SENSOR-KEEP-01');
    expect(wrapper.find('[data-testid="device-delete-CAM-S01"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('lists the online or offline set from the duty board link', async () => {
    httpGet.mockResolvedValue({
      data: {
        items: [{ ...device, id: 'duty-off', code: 'CAM-DUTY-OFF', onlineStatus: 'offline' }],
        total: 4,
      },
    });
    const offline = await mountView('/devices?online=offline');
    expect(httpGet).toHaveBeenCalledWith('/devices?pageSize=100&online=offline');
    expect(offline.get('[data-testid="device-online-scope"]').text()).toBe('离线 4 台');
    expect(offline.get('[data-code="CAM-DUTY-OFF"]').text()).toContain('离线');
    offline.unmount();

    httpGet.mockResolvedValue({
      data: {
        items: [{ ...device, id: 'duty-on', code: 'CAM-DUTY-ON', onlineStatus: 'online' }],
        total: 2,
      },
    });
    const online = await mountView('/devices?online=online');
    expect(httpGet).toHaveBeenCalledWith('/devices?pageSize=100&online=online');
    expect(online.get('[data-testid="device-online-scope"]').text()).toBe('在线 2 台');
    expect(online.get('[data-code="CAM-DUTY-ON"]').text()).toContain('在线');
    online.unmount();
  });
});
