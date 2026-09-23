import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { currentUser, type SessionUser } from '../auth';
import ShedsView from './ShedsView.vue';

const httpGet = vi.hoisted(() => vi.fn());
const httpPatch = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: {
    get: httpGet,
    patch: httpPatch,
  },
  errorText: (error: unknown) => (error instanceof Error ? error.message : '请求失败'),
}));

const shed = {
  id: 'shed-1',
  code: 'S01',
  name: '一号棚',
  location: '东区',
  mapX: null as number | null,
  mapY: null as number | null,
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

async function mountView() {
  const wrapper = mount(ShedsView);
  await flushPromises();
  return wrapper;
}

describe('ShedsView', () => {
  beforeEach(() => {
    localStorage.clear();
    httpGet.mockReset();
    httpPatch.mockReset();
    asUser('production_admin');
  });

  it('updates the list after a coordinate edit succeeds', async () => {
    const saved = { ...shed, mapX: 32, mapY: 48 };
    httpGet.mockResolvedValueOnce({ data: [shed] }).mockResolvedValue({ data: [saved] });
    httpPatch.mockResolvedValue({ data: saved });
    const wrapper = await mountView();

    expect(httpGet).toHaveBeenCalledWith('/sheds');
    expect(wrapper.text()).toContain('一号棚');
    await wrapper.get('input[aria-label="一号棚 平面 X"]').setValue('32');
    await wrapper.get('input[aria-label="一号棚 平面 Y"]').setValue('48');
    const save = wrapper.findAll('button').find((button) => button.text() === '保存坐标');
    expect(save).toBeTruthy();
    await save!.trigger('click');
    await flushPromises();

    expect(httpPatch, wrapper.text()).toHaveBeenCalledWith('/sheds/shed-1', { mapX: 32, mapY: 48 });
    expect(wrapper.get('input[aria-label="一号棚 平面 X"]').element).toHaveProperty('value', '32');
    expect(wrapper.get('input[aria-label="一号棚 平面 Y"]').element).toHaveProperty('value', '48');
    expect(wrapper.text()).toContain('一号棚');
    expect(wrapper.text()).toContain('S01');
    wrapper.unmount();
  });

  it('shows coordinates without edit controls for a shed manager', async () => {
    asUser('shed_manager');
    httpGet.mockResolvedValue({ data: [{ ...shed, mapX: 25, mapY: 40 }] });
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('当前角色只能查看棚区坐标');
    expect(wrapper.text()).toContain('25');
    expect(wrapper.text()).toContain('40');
    expect(wrapper.find('input').exists()).toBe(false);
    expect(wrapper.find('button').exists()).toBe(false);
    wrapper.unmount();
  });
});
