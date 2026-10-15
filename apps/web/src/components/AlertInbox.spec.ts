import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AlertInbox from './AlertInbox.vue';
import { UNREAD_POLL_MS } from './alert-notify';

const httpGet = vi.hoisted(() => vi.fn());
const httpPost = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: {
    get: httpGet,
    post: httpPost,
  },
  errorText: () => '请求失败',
}));

const first = {
  id: 'a1',
  level: 'severe' as const,
  shedCode: 'S01',
  createdAt: '2026-09-23T01:02:00.000Z',
  title: '高温告警',
  message: '温度超过阈值',
};

const second = {
  id: 'a2',
  level: 'warning' as const,
  shedCode: 'S02',
  createdAt: '2026-09-23T02:03:00.000Z',
  title: '湿度告警',
  message: '湿度偏高',
};

const defaultParams = {
  imageRetentionDays: 30,
  timeseriesRetentionDays: 90,
  alertUnreadPollSeconds: 15,
  updatedAt: null,
  updatedBy: null,
};

function routeGets(
  unread: Array<{ data: { unreadCount: number; items: unknown[] } }>,
  params: { alertUnreadPollSeconds: number } = defaultParams,
) {
  const queue = [...unread];
  httpGet.mockImplementation((url: string) => {
    if (url === '/system-params') return Promise.resolve({ data: params });
    const next = queue.shift();
    if (!next) return Promise.reject(new Error('down'));
    return Promise.resolve(next);
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('AlertInbox', () => {
  it('renders level, shed, time, and summary for unread alerts', async () => {
    routeGets([{ data: { unreadCount: 1, items: [first] } }]);
    const wrapper = mount(AlertInbox);
    await flushPromises();

    expect(httpGet).toHaveBeenCalledWith('/alerts/unread');
    expect(wrapper.get('[data-testid="unread-count"]').text()).toBe('1');
    await wrapper.get('[data-testid="unread-entry"]').trigger('click');

    expect(wrapper.text()).toContain('严重');
    expect(wrapper.text()).toContain('棚 S01');
    expect(wrapper.text()).toContain('09-23 09:02');
    expect(wrapper.text()).toContain('高温告警');
    expect(wrapper.text()).not.toContain('暂无未读告警');
    wrapper.unmount();
  });

  it('drops the unread count after mark one and mark all', async () => {
    routeGets([
      { data: { unreadCount: 2, items: [first, second] } },
      { data: { unreadCount: 1, items: [second] } },
      { data: { unreadCount: 0, items: [] } },
    ]);
    httpPost.mockResolvedValue({ data: {} });
    const wrapper = mount(AlertInbox);
    await flushPromises();
    await wrapper.get('[data-testid="unread-entry"]').trigger('click');

    expect(wrapper.get('[data-testid="unread-count"]').text()).toBe('2');
    await wrapper.get('[data-testid="mark-a1"]').trigger('click');
    await flushPromises();

    expect(httpPost).toHaveBeenCalledWith('/alerts/a1/read');
    expect(wrapper.get('[data-testid="unread-count"]').text()).toBe('1');
    expect(wrapper.text()).not.toContain('高温告警');
    expect(wrapper.text()).toContain('湿度告警');

    await wrapper.get('[data-testid="mark-all"]').trigger('click');
    await flushPromises();

    expect(httpPost).toHaveBeenCalledWith('/alerts/read-all');
    expect(wrapper.get('[data-testid="unread-count"]').text()).toBe('0');
    expect(wrapper.text()).toContain('暂无未读告警');
    wrapper.unmount();
  });

  it('shows the load error instead of an empty unread list', async () => {
    httpGet.mockRejectedValue(new Error('down'));
    const wrapper = mount(AlertInbox);
    await flushPromises();
    await wrapper.get('[data-testid="unread-entry"]').trigger('click');

    expect(wrapper.get('[data-testid="unread-error"]').text()).toContain('请求失败');
    expect(wrapper.text()).not.toContain('暂无未读告警');
    expect(wrapper.find('table').exists()).toBe(false);
    expect(wrapper.find('ul').exists()).toBe(false);
    wrapper.unmount();
  });

  it('updates the unread count on the next poll', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    routeGets([
      { data: { unreadCount: 1, items: [first] } },
      { data: { unreadCount: 2, items: [first, second] } },
    ]);
    const wrapper = mount(AlertInbox);
    await flushPromises();

    expect(wrapper.get('[data-testid="unread-count"]').text()).toBe('1');
    await vi.advanceTimersByTimeAsync(UNREAD_POLL_MS);
    await flushPromises();

    expect(httpGet.mock.calls.map((call) => call[0])).toEqual([
      '/alerts/unread',
      '/system-params',
      '/alerts/unread',
    ]);
    expect(wrapper.get('[data-testid="unread-count"]').text()).toBe('2');
    wrapper.unmount();
  });

  it('keeps the in-app list when browser notification permission is denied', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const constructed: string[] = [];
    class FakeNotification {
      static permission: NotificationPermission = 'denied';
      static requestPermission = vi.fn(async () => {
        throw new Error('NotAllowedError');
      });
      constructor(title: string) {
        constructed.push(title);
      }
    }
    vi.stubGlobal('Notification', FakeNotification);
    routeGets([
      { data: { unreadCount: 0, items: [] } },
      { data: { unreadCount: 1, items: [first] } },
    ]);
    const wrapper = mount(AlertInbox);
    await flushPromises();
    await wrapper.get('[data-testid="unread-entry"]').trigger('click');
    await wrapper.get('[data-testid="enable-notify"]').trigger('click');
    await flushPromises();
    await vi.advanceTimersByTimeAsync(UNREAD_POLL_MS);
    await flushPromises();

    expect(FakeNotification.requestPermission).toHaveBeenCalled();
    expect(constructed).toEqual([]);
    expect(wrapper.get('[data-testid="unread-count"]').text()).toBe('1');
    expect(wrapper.text()).toContain('高温告警');
    expect(wrapper.text()).not.toContain('NotAllowedError');
    wrapper.unmount();
  });

  it('shows a browser notification for alerts that arrive after the first load', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const constructed: string[] = [];
    class FakeNotification {
      static permission: NotificationPermission = 'granted';
      static requestPermission = vi.fn(async () => 'granted' as NotificationPermission);
      constructor(title: string) {
        constructed.push(title);
      }
    }
    vi.stubGlobal('Notification', FakeNotification);
    routeGets([
      { data: { unreadCount: 1, items: [first] } },
      { data: { unreadCount: 2, items: [first, second] } },
    ]);
    const wrapper = mount(AlertInbox);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(UNREAD_POLL_MS);
    await flushPromises();

    expect(constructed).toEqual(['一般 · S02']);
    wrapper.unmount();
  });

  it('uses the saved unread poll instead of 15 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let unreadCalls = 0;
    httpGet.mockImplementation((url: string) => {
      if (url === '/system-params') {
        return Promise.resolve({ data: { ...defaultParams, alertUnreadPollSeconds: 45 } });
      }
      unreadCalls += 1;
      return Promise.resolve({ data: { unreadCount: unreadCalls, items: [] } });
    });
    const wrapper = mount(AlertInbox);
    await flushPromises();

    expect(wrapper.get('[data-testid="unread-count"]').text()).toBe('1');
    await vi.advanceTimersByTimeAsync(UNREAD_POLL_MS);
    await flushPromises();
    expect(unreadCalls).toBe(1);

    await vi.advanceTimersByTimeAsync(45_000 - UNREAD_POLL_MS);
    await flushPromises();
    expect(unreadCalls).toBe(2);
    expect(wrapper.get('[data-testid="unread-count"]').text()).toBe('2');
    wrapper.unmount();
  });
});
