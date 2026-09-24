import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { currentUser, type SessionUser } from '../auth';
import HarvestView from './HarvestView.vue';

const httpGet = vi.hoisted(() => vi.fn());
const httpPatch = vi.hoisted(() => vi.fn());
const httpPost = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: {
    get: httpGet,
    patch: httpPatch,
    post: httpPost,
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

const thinEstimate = {
  label: '估计',
  sufficient: false,
  requiredDays: 30,
  historyDays: 2,
  method: '近 30 日各摄像头当日最新成熟数之和，按日序线性外推',
  message: '有效历史不足：近 30 个自然日仅有 2 天有成熟识别，满 30 天后才给出近 2–3 日产量估计。',
  days: [],
};

const fullEstimate = {
  label: '估计',
  sufficient: true,
  requiredDays: 30,
  historyDays: 30,
  method: '近 30 日各摄像头当日最新成熟数之和，按日序线性外推',
  message: null,
  days: [
    { date: '2026-09-24', offsetDays: 1, matureCount: 41 },
    { date: '2026-09-25', offsetDays: 2, matureCount: 42 },
    { date: '2026-09-26', offsetDays: 3, matureCount: 43 },
  ],
};

const emptyTasks = {
  date: '2026-09-23',
  schedule: { morning: 0, afternoon: 0, unassigned: 0 },
  sheds: [],
  items: [],
};

const thinForecast = {
  label: '估计',
  sufficient: false,
  method: '近 7 个上海自然日棚级成熟日桶首尾增速，外推未来 3 日',
  message: '近窗日桶不足：至少需要 2 个相隔不少于 1 天的成熟日桶，才按增速估计未来 2–3 日。当前有 1 天。',
  speedPerDay: null,
  days: [],
};

function routeGets(
  dailyResponses: Array<ReturnType<typeof daily>>,
  estimate: typeof thinEstimate | typeof fullEstimate = thinEstimate,
  extras?: {
    tasks?: {
      date: string;
      schedule: { morning: number; afternoon: number; unassigned: number };
      sheds: Array<{ shedCode: string; matureCount: number; cameraCount: number }>;
      items: Array<Record<string, unknown>>;
    };
    forecast?: {
      label: string;
      sufficient: boolean;
      method: string;
      message: string | null;
      speedPerDay: number | null;
      days: Array<{ date: string; offsetDays: number; matureCount: number }>;
    };
  },
) {
  let index = 0;
  httpGet.mockImplementation((url: string) => {
    const path = String(url);
    if (path.includes('yield-estimate')) return Promise.resolve({ data: estimate });
    if (path.includes('bucket-forecast')) return Promise.resolve({ data: extras?.forecast ?? thinForecast });
    if (path.includes('/harvest/tasks')) return Promise.resolve({ data: extras?.tasks ?? emptyTasks });
    const next = dailyResponses[Math.min(index, dailyResponses.length - 1)];
    index += 1;
    return Promise.resolve(next);
  });
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
      routeGets([
        daily(),
        daily(
          { matureCount: 6, mushroomCount: 10, harvestableCameras: 1 },
          [updated],
        ),
      ]);
      httpPatch.mockResolvedValue({ data: updated });
      const wrapper = await mountView();

      expect(matureText(wrapper)).toContain('4');
      await wrapper.get('input[aria-label="CAM-S01 成熟数"]').setValue('6');
      await wrapper.get('button.btn-ghost').trigger('click');
      await flushPromises();

      expect(httpPatch).toHaveBeenCalledWith('/harvest/daily/rec-1', {
        matureCount: 6,
      });
      expect(
        httpGet.mock.calls.filter((call) => call[0] === '/harvest/daily'),
      ).toHaveLength(2);
      expect(matureText(wrapper)).toContain('6');
      expect(wrapper.text()).not.toContain('当日无识别记录');
      expect(wrapper.find('table').exists()).toBe(true);
      wrapper.unmount();
    },
  );

  it('keeps the table when saving fails', async () => {
    asUser('production_admin');
    routeGets([daily()]);
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
    routeGets([daily()]);
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

  it('shows the next three days marked 估计 when history is sufficient', async () => {
    asUser('production_admin');
    routeGets([daily()], fullEstimate);
    const wrapper = await mountView();
    const panel = wrapper.get('[data-testid="yield-estimate"]');

    expect(httpGet).toHaveBeenCalledWith('/harvest/yield-estimate');
    expect(panel.text()).toContain('估计');
    expect(panel.get('[data-testid="yield-day"]').text()).toContain('估计 41');
    expect(panel.text()).toContain('估计 42');
    expect(panel.text()).toContain('估计 43');
    expect(panel.text()).toContain('2026-09-24');
    wrapper.unmount();
  });

  it('explains thin history and does not render estimate numbers', async () => {
    asUser('shed_manager');
    routeGets([daily()], thinEstimate);
    const wrapper = await mountView();
    const panel = wrapper.get('[data-testid="yield-estimate"]');

    expect(panel.text()).toContain('估计');
    expect(panel.text()).toContain('有效历史不足');
    expect(panel.text()).toContain('2');
    expect(panel.text()).toContain('30');
    expect(panel.find('[data-testid="yield-day"]').exists()).toBe(false);
    expect(panel.text()).not.toContain('估计 41');
    wrapper.unmount();
  });

  it('shows the bucket-speed estimate and a generated pick list', async () => {
    asUser('shed_manager');
    const task = {
      id: 'task-1',
      shedCode: 'S01',
      cameraCode: 'CAM-A',
      matureCount: 6,
      mushroomCount: 12,
      status: 'open',
      assignee: null,
      shift: null,
      note: null,
    };
    routeGets([daily()], thinEstimate, {
      forecast: {
        label: '估计',
        sufficient: true,
        method: '近 7 个上海自然日棚级成熟日桶首尾增速，外推未来 3 日',
        message: null,
        speedPerDay: 2,
        days: [
          { date: '2026-09-25', offsetDays: 1, matureCount: 18 },
          { date: '2026-09-26', offsetDays: 2, matureCount: 20 },
          { date: '2026-09-27', offsetDays: 3, matureCount: 22 },
        ],
      },
      tasks: {
        ...emptyTasks,
        schedule: { morning: 0, afternoon: 0, unassigned: 1 },
        sheds: [{ shedCode: 'S01', matureCount: 6, cameraCount: 1 }],
        items: [task],
      },
    });
    httpPost.mockResolvedValue({
      data: {
        ...emptyTasks,
        schedule: { morning: 1, afternoon: 0, unassigned: 0 },
        items: [{ ...task, assignee: '甲班', shift: 'morning', status: 'scheduled' }],
      },
    });
    const wrapper = await mountView();
    const forecast = wrapper.get('[data-testid="bucket-forecast"]');
    expect(forecast.text()).toContain('估计 18');
    expect(forecast.text()).toContain('估计 22');
    expect(wrapper.get('[data-testid="harvest-tasks"]').text()).toContain('CAM-A');
    expect(wrapper.get('[data-testid="harvest-tasks"]').text()).toContain('未排 1 条');
    await wrapper.get('button.btn-primary').trigger('click');
    await flushPromises();
    expect(httpPost).toHaveBeenCalledWith('/harvest/tasks/generate', null, {
      params: { date: expect.any(String) },
    });
    wrapper.unmount();
  });

  it('keeps the daily table when the yield request fails', async () => {
    asUser('viewer');
    httpGet.mockImplementation((url: string) => {
      if (String(url).includes('yield-estimate')) return Promise.reject(new Error('down'));
      return Promise.resolve(daily());
    });
    const wrapper = await mountView();

    expect(wrapper.get('[data-testid="yield-estimate"]').text()).toContain('请求失败');
    expect(wrapper.text()).toContain('CAM-S01');
    expect(wrapper.text()).not.toContain('当日无识别记录');
    expect(wrapper.find('table').exists()).toBe(true);
    wrapper.unmount();
  });
});
