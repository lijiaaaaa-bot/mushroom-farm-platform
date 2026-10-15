import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shanghaiStamp } from '../disease-level';
import DiseaseDetailView from './DiseaseDetailView.vue';

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
  observedAt: '2026-09-23T01:10:00.000Z',
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
        diseaseLevel: 1,
        diseaseCount: 1,
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

async function mountDetail(id = 'd-1', query: Record<string, string> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/diseases/:id', component: DiseaseDetailView },
      { path: '/diseases', component: { template: '<div />' } },
    ],
  });
  await router.push({ path: `/diseases/${id}`, query });
  await router.isReady();
  const wrapper = mount(DiseaseDetailView, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

describe('DiseaseDetailView', () => {
  beforeEach(() => {
    httpGet.mockReset();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:snapshot');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows time, shed, location, level and the stored image', async () => {
    httpGet.mockImplementation((url: string) => {
      if (String(url).includes('/snapshot')) {
        return Promise.resolve({ data: new Blob(['jpeg'], { type: 'image/jpeg' }) });
      }
      if (String(url).includes('/environment')) {
        return Promise.resolve({ data: emptyEnvironment });
      }
      return Promise.resolve({ data: withSnapshot });
    });
    const wrapper = await mountDetail();
    const detail = wrapper.get('[data-testid="disease-detail"]');

    expect(httpGet).toHaveBeenCalledWith('/diseases/d-1');
    expect(detail.get('[data-field="time"]').text()).toBe(shanghaiStamp(withSnapshot.recognizedAt));
    expect(detail.get('[data-field="shed"]').text()).toBe('S01');
    expect(detail.get('[data-field="location"]').text()).toBe('CAM-S01-01');
    expect(detail.get('[data-field="level"]').text()).toBe('中度（2）');
    expect(detail.get('[data-field="count"]').text()).toBe('3');
    expect(wrapper.get('[data-testid="disease-image"]').get('img').attributes('src')).toBe('blob:snapshot');
    expect(httpGet).toHaveBeenCalledWith('/ingest/recognitions/d-1/snapshot', {
      responseType: 'blob',
    });
    expect(wrapper.get('[data-testid="disease-back"]').attributes('href')).toBe('/diseases');
    wrapper.unmount();
  });

  it('shows the empty image copy when the record has no snapshot', async () => {
    httpGet.mockImplementation((url: string) => {
      if (String(url).includes('/environment')) {
        return Promise.resolve({ data: emptyEnvironment });
      }
      return Promise.resolve({ data: withoutSnapshot });
    });
    const wrapper = await mountDetail('d-2');

    expect(wrapper.get('[data-field="location"]').text()).toBe('CAM-S02-01');
    expect(wrapper.get('[data-field="level"]').text()).toBe('轻度（1）');
    expect(wrapper.get('[data-testid="disease-image-empty"]').text()).toBe('无病害图片');
    expect(wrapper.find('img').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows the error and hides the fields when the record cannot be loaded', async () => {
    httpGet.mockRejectedValue(new Error('down'));
    const wrapper = await mountDetail();

    expect(wrapper.get('[data-testid="disease-detail-error"]').text()).toBe('请求失败');
    expect(wrapper.find('[data-testid="disease-detail"]').exists()).toBe(false);
    expect(wrapper.find('img').exists()).toBe(false);
    wrapper.unmount();
  });

  it('returns to the filtered list', async () => {
    httpGet.mockImplementation((url: string) => {
      if (String(url).includes('/environment')) {
        return Promise.resolve({ data: emptyEnvironment });
      }
      return Promise.resolve({ data: withSnapshot });
    });
    const wrapper = await mountDetail('d-1', { cameraCode: 'CAM-S01-01', diseaseLevel: '2' });

    expect(wrapper.get('[data-testid="disease-back"]').attributes('href')).toBe(
      '/diseases?cameraCode=CAM-S01-01&diseaseLevel=2',
    );
    wrapper.unmount();
  });

  it('shows same-screen env readings and an empty state without numbers', async () => {
    httpGet.mockImplementation((url: string, config?: { params?: { sensorCode?: string } }) => {
      if (String(url).endsWith('/d-1')) return Promise.resolve({ data: withSnapshot });
      if (String(url).endsWith('/d-2')) return Promise.resolve({ data: withoutSnapshot });
      if (String(url).includes('/environment')) {
        return Promise.resolve({
          data: environmentFor(String(url), config?.params?.sensorCode),
        });
      }
      return Promise.resolve({ data: withSnapshot });
    });
    const wrapper = await mountDetail();
    const panel = wrapper.get('[data-testid="env-panel"]');

    expect(httpGet).toHaveBeenCalledWith('/diseases/d-1/environment', { params: {} });
    expect(wrapper.get('[data-testid="disease-detail"]').text()).toContain('CAM-S01-01');
    expect(panel.text()).toContain('棚 S01');
    expect(panel.text()).toContain(shanghaiStamp(s01Reading.observedAt));
    expect(panel.text()).toContain(shanghaiStamp(s01OtherSensor.observedAt));
    const readings = panel.get('[data-testid="env-readings"]');
    expect(readings.text()).toContain('SEN-1');
    expect(readings.text()).toContain('22.5℃');
    expect(readings.text()).toContain('88%');
    expect(readings.text()).toContain('—');
    expect(readings.text()).toContain('70%');
    expect(readings.text()).toContain('900');
    expect(readings.text()).toContain('65%');
    expect(readings.text()).not.toContain('S02');
    wrapper.unmount();
  });

  it('shows the empty-window copy on the same screen and does not invent readings', async () => {
    httpGet.mockImplementation((url: string, config?: { params?: { sensorCode?: string } }) => {
      if (String(url).endsWith('/d-2')) return Promise.resolve({ data: withoutSnapshot });
      if (String(url).includes('/environment')) {
        return Promise.resolve({
          data: environmentFor(String(url), config?.params?.sensorCode),
        });
      }
      return Promise.resolve({ data: withoutSnapshot });
    });
    const wrapper = await mountDetail('d-2');

    expect(wrapper.get('[data-testid="disease-detail"]').text()).toContain('CAM-S02-01');
    expect(wrapper.get('[data-field="level"]').text()).toBe('轻度（1）');
    expect(wrapper.get('[data-testid="env-empty"]').text()).toBe('该时间窗内无环境读数');
    expect(wrapper.find('[data-testid="env-readings"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="env-panel"]').text()).not.toContain('22.5');
    expect(wrapper.get('[data-testid="env-panel"]').text()).not.toContain('SEN-1');
    wrapper.unmount();
  });

  it('refetches the window when a sensor is chosen', async () => {
    httpGet.mockImplementation((url: string, config?: { params?: { sensorCode?: string } }) => {
      if (String(url).includes('/environment')) {
        return Promise.resolve({
          data: environmentFor(String(url), config?.params?.sensorCode),
        });
      }
      return Promise.resolve({ data: withSnapshot });
    });
    const wrapper = await mountDetail();

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

  it('shows an error instead of an image when the snapshot request fails', async () => {
    httpGet.mockImplementation((url: string) => {
      if (String(url).includes('/snapshot')) return Promise.reject(new Error('down'));
      if (String(url).includes('/environment')) {
        return Promise.resolve({ data: emptyEnvironment });
      }
      return Promise.resolve({ data: withSnapshot });
    });
    const wrapper = await mountDetail();

    expect(wrapper.find('[data-testid="disease-detail"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="disease-image"]').text()).toContain('请求失败');
    expect(wrapper.find('img').exists()).toBe(false);
    wrapper.unmount();
  });
});
