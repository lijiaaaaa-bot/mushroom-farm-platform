import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { currentUser, type SessionUser } from '../auth';
import HarvestView from './HarvestView.vue';

const httpGet = vi.hoisted(() => vi.fn());
const httpPatch = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: {
    get: httpGet,
    patch: httpPatch,
  },
  errorText: () => '请求失败',
}));

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

function asUser(role: SessionUser['role']) {
  currentUser.value = {
    id: 'user-1',
    username: role,
    displayName: role,
    role,
    shedCodes: ['S01'],
  };
}

function daily(summary = harvestSummary, items = [harvestItem]) {
  return {
    data: { date: '2026-09-23', summary, items },
  };
}

async function mountView() {
  const wrapper = mount(HarvestView);
  await flushPromises();
  return wrapper;
}

function matureText(wrapper: ReturnType<typeof mount>) {
  const article = wrapper
    .findAll('article')
    .find((node) => node.text().includes('成熟数量'));
  return article?.text() ?? '';
}

describe('HarvestView correction', () => {
  beforeEach(() => {
    localStorage.clear();
    currentUser.value = null;
    httpGet.mockReset();
    httpPatch.mockReset();
  });

  it.each(['super_admin', 'production_admin', 'shed_manager'] as const)(
    '%s can edit the mature count and the summary refreshes after save',
    async (role) => {
      asUser(role);
      const updated = {
        ...harvestItem,
        matureCount: 6,
      };
      httpGet
        .mockResolvedValueOnce(daily())
        .mockResolvedValueOnce(
          daily(
            { matureCount: 6, mushroomCount: 10, harvestableCameras: 1 },
            [updated],
          ),
        );
      httpPatch.mockResolvedValue({ data: updated });
      const wrapper = await mountView();

      expect(matureText(wrapper)).toContain('4');
      await wrapper.get('input[aria-label="CAM-S01 成熟数"]').setValue('6');
      await wrapper.get('button.btn-ghost').trigger('click');
      await flushPromises();

      expect(httpPatch).toHaveBeenCalledWith('/harvest/daily/rec-1', {
        matureCount: 6,
      });
      expect(httpGet).toHaveBeenCalledTimes(2);
      expect(matureText(wrapper)).toContain('6');
      expect(wrapper.text()).not.toContain('当日无识别记录');
      expect(wrapper.find('table').exists()).toBe(true);
      wrapper.unmount();
    },
  );

  it('keeps the table when saving fails', async () => {
    asUser('production_admin');
    httpGet.mockResolvedValue(daily());
    httpPatch.mockRejectedValue(new Error('down'));
    const wrapper = await mountView();

    await wrapper.get('input[aria-label="CAM-S01 成熟数"]').setValue('6');
    await wrapper.get('button.btn-ghost').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('请求失败');
    expect(wrapper.text()).toContain('CAM-S01');
    expect(wrapper.text()).toContain('S01');
    expect(wrapper.text()).not.toContain('当日无识别记录');
    expect(wrapper.find('table').exists()).toBe(true);
    wrapper.unmount();
  });

  it('hides the save control for a viewer', async () => {
    asUser('viewer');
    httpGet.mockResolvedValue(daily());
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('当前角色不能修正采摘清单。');
    expect(wrapper.text()).toContain('CAM-S01');
    expect(wrapper.find('input[type="number"]').exists()).toBe(false);
    const save = wrapper
      .findAll('button')
      .some((button) => button.text() === '保存');
    expect(save).toBe(false);
    expect(wrapper.find('table').exists()).toBe(true);
    wrapper.unmount();
  });
});
