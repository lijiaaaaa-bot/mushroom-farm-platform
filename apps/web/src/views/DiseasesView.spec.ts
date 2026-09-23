import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DiseasesView from './DiseasesView.vue';

const httpGet = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: { get: httpGet },
  errorText: () => '请求失败',
}));

const withSnapshot = {
  id: 'd-1',
  shedCode: 'S01',
  cameraCode: 'CAM-S01-01',
  recognizedAt: '2026-09-23T01:02:00.000Z',
  diseaseLevel: 2,
  diseaseCount: 3,
  snapshotObjectKey: 'snapshots/S01/2026-09-23/CAM-S01-01/1.jpg',
  snapshotUrl: null,
};

const withoutSnapshot = {
  id: 'd-2',
  shedCode: 'S02',
  cameraCode: 'CAM-S02-01',
  recognizedAt: '2026-09-23T02:02:00.000Z',
  diseaseLevel: 1,
  diseaseCount: 1,
  snapshotObjectKey: null,
  snapshotUrl: null,
};

const emptyEnvironment = {
  recognition: {
    id: 'd-1',
    shedCode: 'S01',
    cameraCode: 'CAM-S01-01',
    recognizedAt: '2026-09-23T01:02:00.000Z',
    diseaseLevel: 2,
    diseaseCount: 3,
  },
  window: {
    start: '2026-09-23T00:32:00.000Z',
    end: '2026-09-23T01:32:00.000Z',
    beforeMinutes: 30,
    afterMinutes: 30,
  },
  alignment: { shedCode: 'S01', sensorCode: null },
  readings: [],
  empty: true,
  emptyReason: '该时间窗内无环境读数',
};

const s01Reading = {
  id: 'env-1',
  shedCode: 'S01',
  sensorCode: 'SEN-1',
  observedAt: '2026-09-23T01:00:00.000Z',
  temperature: 22.5,
  humidity: 88,
  co2: null,
  substrateMoisture: 70,
};

const s01OtherSensor = {
  ...s01Reading,
  id: 'env-2',
  sensorCode: 'SEN-2',
  temperature: 21,
  humidity: 80,
  co2: 900,
  substrateMoisture: 65,
};

function environmentFor(url: string, sensorCode?: string) {
  const id = String(url).includes('/d-2/') ? 'd-2' : 'd-1';
  const filtered = Boolean(sensorCode);
  const sensor = sensorCode === 'SEN-2' ? 'SEN-2' : 'SEN-1';
  if (id === 'd-2') {
    return {
      ...emptyEnvironment,
      recognition: {
        ...emptyEnvironment.recognition,
        id: 'd-2',
        shedCode: 'S02',
        cameraCode: 'CAM-S02-01',
      },
      alignment: { shedCode: 'S02', sensorCode: null },
    };
  }
  const readings = filtered
    ? [sensor === 'SEN-2' ? s01OtherSensor : s01Reading]
    : [s01Reading, s01OtherSensor];
  return {
    ...emptyEnvironment,
    alignment: { shedCode: 'S01', sensorCode: filtered ? sensor : null },
    readings,
    empty: false,
    emptyReason: null,
  };
}

async function mountView() {
  const wrapper = mount(DiseasesView);
  await flushPromises();
  return wrapper;
}

describe('DiseasesView', () => {
  beforeEach(() => {
    httpGet.mockReset();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:snapshot');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows error text without the empty copy when the disease list fails', async () => {
    httpGet.mockRejectedValue(new Error('down'));
    const wrapper = await mountView();

    expect(httpGet).toHaveBeenCalledWith('/diseases?pageSize=50');
    expect(wrapper.text()).toContain('请求失败');
    expect(wrapper.text()).not.toContain('暂无病害记录');
    expect(wrapper.find('table').exists()).toBe(false);
    expect(wrapper.find('.result-card').exists()).toBe(false);
    expect(wrapper.find('img').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows empty copy when the disease list has no rows', async () => {
    httpGet.mockResolvedValue({ data: { items: [], total: 0 } });
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('暂无病害记录。');
    expect(wrapper.find('table').exists()).toBe(false);
    expect(wrapper.find('.result-card').exists()).toBe(false);
    wrapper.unmount();
  });

  it('renders an image caption card for a stored snapshot and plain text when there is none', async () => {
    httpGet.mockImplementation((url: string) => {
      if (String(url).includes('/snapshot')) {
        return Promise.resolve({ data: new Blob(['jpeg'], { type: 'image/jpeg' }) });
      }
      if (String(url).includes('/environment')) {
        return Promise.resolve({ data: emptyEnvironment });
      }
      return Promise.resolve({ data: { items: [withSnapshot, withoutSnapshot] } });
    });
    const wrapper = await mountView();
    const cards = wrapper.findAll('.result-card');

    expect(wrapper.find('.result-grid').exists()).toBe(true);
    expect(wrapper.find('table').exists()).toBe(false);
    expect(wrapper.text()).toContain('S01');
    expect(wrapper.text()).toContain('CAM-S01-01');
    expect(wrapper.text()).toContain('病害 3');
    expect(wrapper.text()).toContain('等级 2');
    expect(cards[0].text()).toContain('详情');
    expect(cards[0].get('img').attributes('src')).toBe('blob:snapshot');
    expect(cards[1].text()).toContain('无抓拍');
    expect(cards[1].find('img').exists()).toBe(false);
    expect(cards[1].find('button').exists()).toBe(false);
    expect(httpGet).toHaveBeenCalledWith('/ingest/recognitions/d-1/snapshot', {
      responseType: 'blob',
    });

    await cards[0].get('button').trigger('click');
    expect(wrapper.findAll('img').length).toBeGreaterThan(1);
    wrapper.unmount();
  });

  it('shows an error instead of an image when the snapshot request fails', async () => {
    httpGet.mockImplementation((url: string) => {
      if (String(url).includes('/snapshot')) return Promise.reject(new Error('down'));
      if (String(url).includes('/environment')) {
        return Promise.resolve({ data: emptyEnvironment });
      }
      return Promise.resolve({ data: { items: [withSnapshot] } });
    });
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('请求失败');
    expect(wrapper.find('img').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows same-screen env readings for the selected disease and an empty state without numbers', async () => {
    httpGet.mockImplementation((url: string, config?: { params?: { sensorCode?: string } }) => {
      if (String(url).includes('/environment')) {
        return Promise.resolve({
          data: environmentFor(String(url), config?.params?.sensorCode),
        });
      }
      return Promise.resolve({ data: { items: [withSnapshot, withoutSnapshot] } });
    });
    const wrapper = await mountView();
    const panel = wrapper.get('[data-testid="env-panel"]');

    expect(httpGet).toHaveBeenCalledWith('/diseases/d-1/environment', { params: {} });
    expect(panel.text()).toContain('棚 S01');
    expect(panel.text()).toContain('SEN-1');
    expect(panel.text()).toContain('22.5');
    expect(panel.text()).toContain('88');
    expect(panel.text()).toContain('—');
    expect(panel.text()).toContain('70');
    expect(panel.get('[data-testid="env-readings"]').text()).not.toContain('S02');

    await wrapper.findAll('.result-card')[1].trigger('click');
    await flushPromises();

    expect(httpGet).toHaveBeenCalledWith('/diseases/d-2/environment', { params: {} });
    expect(wrapper.get('[data-testid="env-empty"]').text()).toBe('该时间窗内无环境读数');
    expect(wrapper.find('[data-testid="env-readings"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="env-panel"]').text()).toContain('棚 S02');
    wrapper.unmount();
  });

  it('refetches the window when a sensor is chosen', async () => {
    httpGet.mockImplementation((url: string, config?: { params?: { sensorCode?: string } }) => {
      if (String(url).includes('/environment')) {
        return Promise.resolve({
          data: environmentFor(String(url), config?.params?.sensorCode),
        });
      }
      return Promise.resolve({ data: { items: [withSnapshot] } });
    });
    const wrapper = await mountView();

    await wrapper.get('select[aria-label="传感器"]').setValue('SEN-1');
    await flushPromises();

    expect(httpGet).toHaveBeenCalledWith('/diseases/d-1/environment', {
      params: { sensorCode: 'SEN-1' },
    });
    const readings = wrapper.get('[data-testid="env-readings"]').text();
    expect(readings).toContain('SEN-1');
    expect(readings).not.toContain('SEN-2');
    wrapper.unmount();
  });
});
