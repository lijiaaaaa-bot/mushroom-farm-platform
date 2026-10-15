import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GrowthTrendsView from './GrowthTrendsView.vue';

const httpGet = vi.hoisted(() => vi.fn());
const setOption = vi.hoisted(() => vi.fn());
const init = vi.hoisted(() =>
  vi.fn(() => ({ setOption, dispose: vi.fn() })),
);

vi.mock('../api', () => ({
  http: { get: httpGet },
  errorText: () => '请求失败',
}));

vi.mock('echarts', () => ({
  init,
}));

const sheds = [{ code: 'S01', name: '一号棚' }];

const series = {
  days: 7,
  from: '2026-09-17',
  to: '2026-09-23',
  sheds: [
    {
      shedCode: 'S01',
      points: [
        {
          day: '2026-09-23',
          mushroomCount: 12,
          matureCount: 3,
          capDiameterMean: 5,
          sampleCount: 2,
        },
      ],
      cameras: [
        {
          cameraCode: 'CAM-1',
          points: [
            {
              day: '2026-09-23',
              mushroomCount: 12,
              matureCount: 3,
              capDiameterMean: 5,
              sampleCount: 2,
            },
          ],
        },
      ],
    },
  ],
};

const empty = {
  days: 7,
  from: '2026-09-17',
  to: '2026-09-23',
  sheds: [],
};

function mockTrends(payload: unknown = series) {
  httpGet.mockImplementation((url: string) => {
    if (url === '/sheds') return Promise.resolve({ data: sheds });
    return Promise.resolve({ data: payload });
  });
}

async function mountView(query: Record<string, string> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/growth-trends', component: GrowthTrendsView }],
  });
  await router.push({ path: '/growth-trends', query });
  const wrapper = mount(GrowthTrendsView, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

describe('GrowthTrendsView', () => {
  beforeEach(() => {
    httpGet.mockReset();
    init.mockClear();
    setOption.mockClear();
  });

  it('draws only the returned days', async () => {
    mockTrends();
    const wrapper = await mountView();

    expect(httpGet).toHaveBeenCalledWith('/growth-trends', {
      params: { days: 7, shedCode: 'S01' },
    });
    expect(wrapper.text()).toContain('12');
    expect(wrapper.text()).toContain('2026-09-23');
    expect(wrapper.text()).toContain('棚区 S01 · 7 天');
    expect(wrapper.text()).toContain('成熟数量');
    expect(wrapper.text()).toContain('3');
    expect(wrapper.text()).not.toContain('没有日聚合');
    expect(init).toHaveBeenCalled();
    const countOption = setOption.mock.calls[0][0] as {
      series: Array<{ data: Array<number | null> }>;
    };
    expect(countOption.series[0].data).toEqual([12]);
    wrapper.unmount();
  });

  it('draws two days when mushroom and mature counts both change', async () => {
    mockTrends({
      days: 7,
      from: '2026-09-17',
      to: '2026-09-23',
      sheds: [
        {
          shedCode: 'S01',
          points: [
            {
              day: '2026-09-18',
              mushroomCount: 8,
              matureCount: 2,
              capDiameterMean: 3.2,
              sampleCount: 1,
            },
            {
              day: '2026-09-23',
              mushroomCount: 21,
              matureCount: 8,
              capDiameterMean: 5.4,
              sampleCount: 1,
            },
          ],
          cameras: [],
        },
      ],
    });
    const wrapper = await mountView();
    expect(wrapper.text()).toContain('2026-09-18');
    expect(wrapper.text()).toContain('2026-09-23');
    expect(wrapper.text()).toContain('21');
    const seriesData = setOption.mock.calls.map(
      (call) => (call[0] as { series: Array<{ data: number[] }> }).series[0].data,
    );
    expect(seriesData).toContainEqual([8, 21]);
    expect(seriesData).toContainEqual([2, 8]);
    expect(seriesData).toContainEqual([3.2, 5.4]);
    wrapper.unmount();
  });

  it('shows maturity rate percent and the rise between points', async () => {
    mockTrends({
      days: 7,
      from: '2026-10-09',
      to: '2026-10-15',
      sheds: [
        {
          shedCode: 'S01',
          points: [],
          cameras: [
            {
              cameraCode: 'CAM-MR-01',
              points: [
                {
                  day: '2026-10-08',
                  mushroomCount: 0,
                  matureCount: 0,
                  maturityRate: null,
                  capDiameterMean: null,
                  sampleCount: 1,
                },
                {
                  day: '2026-10-10',
                  mushroomCount: 20,
                  matureCount: 2,
                  maturityRate: 10,
                  capDiameterMean: 4,
                  sampleCount: 1,
                },
                {
                  day: '2026-10-13',
                  mushroomCount: 20,
                  matureCount: 6,
                  maturityRate: 30,
                  capDiameterMean: 4.2,
                  sampleCount: 1,
                },
                {
                  day: '2026-10-15',
                  mushroomCount: 20,
                  matureCount: 10,
                  maturityRate: 50,
                  capDiameterMean: 4.4,
                  sampleCount: 1,
                },
              ],
            },
          ],
        },
      ],
    });
    const wrapper = await mountView({ shedCode: 'S01', cameraCode: 'CAM-MR-01' });
    expect(wrapper.get('[data-maturity-summary]').text()).toBe(
      '成熟率 10% → 30% → 50%（升）',
    );
    expect(wrapper.findAll('[data-maturity-rate]').map((cell) => cell.text())).toEqual([
      '—',
      '10%',
      '30%',
      '50%',
    ]);
    expect(wrapper.findAll('[data-maturity-delta]').map((cell) => cell.text())).toEqual([
      '—',
      '—',
      '升 20',
      '升 20',
    ]);
    expect(wrapper.text()).toContain('成熟率');
    const seriesData = setOption.mock.calls.map(
      (call) => (call[0] as { series: Array<{ data: Array<number | null> }> }).series[0].data,
    );
    expect(seriesData).toContainEqual([10, 30, 50]);
    const rateOption = setOption.mock.calls
      .map((call) => call[0] as { yAxis?: { axisLabel?: { formatter?: string } } })
      .find((option) => option.yAxis?.axisLabel?.formatter === '{value}%');
    expect(rateOption).toBeTruthy();
    wrapper.unmount();
  });

  it('shows a drop when the maturity rate falls', async () => {
    mockTrends({
      days: 7,
      from: '2026-10-09',
      to: '2026-10-15',
      sheds: [
        {
          shedCode: 'S01',
          points: [
            {
              day: '2026-10-10',
              mushroomCount: 20,
              matureCount: 10,
              maturityRate: 50,
              capDiameterMean: 4,
              sampleCount: 1,
            },
            {
              day: '2026-10-15',
              mushroomCount: 20,
              matureCount: 2,
              maturityRate: 10,
              capDiameterMean: 4,
              sampleCount: 1,
            },
          ],
          cameras: [],
        },
      ],
    });
    const wrapper = await mountView();
    expect(wrapper.get('[data-maturity-summary]').text()).toBe('成熟率 50% → 10%（降）');
    expect(wrapper.findAll('[data-maturity-delta]').map((cell) => cell.text())).toEqual([
      '—',
      '降 40',
    ]);
    wrapper.unmount();
  });

  it('shows an empty window without chart points', async () => {
    mockTrends(empty);
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('2026-09-17 至 2026-09-23 没有日聚合，未绘制曲线。');
    expect(wrapper.find('table').exists()).toBe(false);
    expect(init).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('shows the load error without an empty chart', async () => {
    httpGet.mockRejectedValue(new Error('down'));
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('请求失败');
    expect(wrapper.text()).not.toContain('没有日聚合');
    expect(wrapper.find('table').exists()).toBe(false);
    expect(init).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('requests hour buckets from the 24h control', async () => {
    httpGet.mockImplementation((url: string) => {
      if (url === '/sheds') return Promise.resolve({ data: sheds });
      if (url === '/growth-trends/hours') {
        return Promise.resolve({
          data: {
            hours: 24,
            from: '2026-09-23T16:00:00.000Z',
            to: '2026-09-24T03:00:00.000Z',
            sheds: [
              {
                shedCode: 'S01',
                points: [
                  {
                    hour: '2026-09-24T03:00:00.000Z',
                    mushroomCount: 6,
                    matureCount: 9,
                    capDiameterMean: 4,
                    sampleCount: 1,
                  },
                ],
                cameras: [],
              },
            ],
          },
        });
      }
      return Promise.resolve({ data: series });
    });
    const wrapper = await mountView();
    await wrapper.get('[data-grain="hour"]').trigger('click');
    await flushPromises();
    expect(httpGet).toHaveBeenCalledWith('/growth-trends/hours', {
      params: { hours: 24, shedCode: 'S01' },
    });
    expect(wrapper.text()).toContain('6');
    expect(wrapper.text()).toContain('棚区 S01 · 24 小时');
    expect(wrapper.text()).toContain('9');
    wrapper.unmount();
  });

  it('requests 30 days from the window control', async () => {
    mockTrends();
    const wrapper = await mountView();
    await wrapper.get('[data-days="30"]').trigger('click');
    await flushPromises();

    expect(httpGet).toHaveBeenCalledWith('/growth-trends', {
      params: { days: 30, shedCode: 'S01' },
    });
    expect(wrapper.text()).toContain('棚区 S01 · 30 天');
    wrapper.unmount();
  });

  it('switches the table to per-camera points', async () => {
    mockTrends();
    const wrapper = await mountView();
    expect(wrapper.text()).toContain('S01');
    await wrapper.get('[data-mode="camera"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('CAM-1');
    wrapper.unmount();
  });

  it('opens on the shed, window, and camera named in the route', async () => {
    mockTrends();
    const wrapper = await mountView({ days: '30', shedCode: 'S01', cameraCode: 'CAM-1' });

    expect(httpGet).toHaveBeenCalledWith('/growth-trends', {
      params: { days: 30, shedCode: 'S01' },
    });
    expect(wrapper.text()).toContain('摄像头 CAM-1');
    expect(wrapper.text()).toContain('棚区 S01 · 30 天');
    expect(wrapper.text()).toContain('CAM-1');
    expect(wrapper.text()).not.toContain('没有日聚合');
    wrapper.unmount();
  });

  it('opens week grain with fewer period labels than the day series', async () => {
    httpGet.mockImplementation((url: string, config?: { params?: { grain?: string } }) => {
      if (url === '/sheds') return Promise.resolve({ data: sheds });
      if (config?.params?.grain === 'month') {
        return Promise.resolve({
          data: {
            days: 30,
            grain: 'month',
            from: '2026-09-16',
            to: '2026-10-15',
            sheds: [
              {
                shedCode: 'S01',
                points: [],
                cameras: [
                  {
                    cameraCode: 'CAM-GG-01',
                    points: [
                      {
                        day: '2026-10',
                        mushroomCount: 21,
                        matureCount: 8,
                        capDiameterMean: 5,
                        sampleCount: 4,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        });
      }
      if (config?.params?.grain === 'week') {
        return Promise.resolve({
          data: {
            days: 30,
            grain: 'week',
            from: '2026-09-16',
            to: '2026-10-15',
            sheds: [
              {
                shedCode: 'S01',
                points: [],
                cameras: [
                  {
                    cameraCode: 'CAM-GG-01',
                    points: [
                      {
                        day: '2026-09-28',
                        mushroomCount: 14,
                        matureCount: 5,
                        capDiameterMean: 4,
                        sampleCount: 2,
                      },
                      {
                        day: '2026-10-05',
                        mushroomCount: 21,
                        matureCount: 8,
                        capDiameterMean: 4.2,
                        sampleCount: 2,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        });
      }
      return Promise.resolve({
        data: {
          days: 30,
          grain: 'day',
          from: '2026-09-16',
          to: '2026-10-15',
          sheds: [
            {
              shedCode: 'S01',
              points: [],
              cameras: [
                {
                  cameraCode: 'CAM-GG-01',
                  points: [
                    {
                      day: '2026-09-28',
                      mushroomCount: 8,
                      matureCount: 2,
                      capDiameterMean: 3.2,
                      sampleCount: 1,
                    },
                    {
                      day: '2026-09-30',
                      mushroomCount: 14,
                      matureCount: 5,
                      capDiameterMean: 4,
                      sampleCount: 1,
                    },
                    {
                      day: '2026-10-05',
                      mushroomCount: 8,
                      matureCount: 2,
                      capDiameterMean: 3.4,
                      sampleCount: 1,
                    },
                    {
                      day: '2026-10-07',
                      mushroomCount: 21,
                      matureCount: 8,
                      capDiameterMean: 5,
                      sampleCount: 1,
                    },
                  ],
                },
              ],
            },
          ],
        },
      });
    });
    const wrapper = await mountView({
      days: '30',
      shedCode: 'S01',
      cameraCode: 'CAM-GG-01',
    });
    expect(wrapper.text()).toContain('粒度 日 · 共 4 个点');
    expect(wrapper.text()).toContain('2026-10-07');
    expect(wrapper.get('[data-grain="day"]').classes()).toContain('btn-primary');

    await wrapper.get('[data-grain="week"]').trigger('click');
    await flushPromises();
    expect(httpGet).toHaveBeenCalledWith('/growth-trends', {
      params: { days: 30, grain: 'week', shedCode: 'S01' },
    });
    expect(wrapper.text()).toContain('棚区 S01 · 周');
    expect(wrapper.text()).toContain('粒度 周 · 共 2 个点');
    expect(wrapper.text()).toContain('2026-09-28（周）');
    expect(wrapper.text()).toContain('2026-10-05（周）');
    expect(wrapper.text()).not.toContain('2026-10-07');
    expect(wrapper.text()).not.toContain('2026-09-30');
    const weekAxis = setOption.mock.calls[setOption.mock.calls.length - 1][0] as {
      xAxis: { data: string[] };
    };
    expect(weekAxis.xAxis.data).toEqual(['2026-09-28（周）', '2026-10-05（周）']);

    await wrapper.get('[data-grain="month"]').trigger('click');
    await flushPromises();
    expect(httpGet).toHaveBeenCalledWith('/growth-trends', {
      params: { days: 30, grain: 'month', shedCode: 'S01' },
    });
    expect(wrapper.text()).toContain('棚区 S01 · 月');
    expect(wrapper.text()).toContain('粒度 月 · 共 1 个点');
    expect(wrapper.text()).toContain('2026-10（月）');
    expect(wrapper.text()).not.toContain('（周）');
    expect(wrapper.get('[data-grain="month"]').classes()).toContain('btn-primary');
    expect(wrapper.get('[data-grain="week"]').classes()).not.toContain('btn-primary');

    await wrapper.get('[data-grain="day"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('粒度 日 · 共 4 个点');
    expect(wrapper.text()).toContain('2026-10-07');
    wrapper.unmount();
  });

  it('states that there is no authorized shed', async () => {
    httpGet.mockImplementation((url: string) => {
      if (url === '/sheds') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: empty });
    });
    const wrapper = await mountView();
    expect(wrapper.text()).toContain('没有可查看的棚区。');
    expect(init).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
