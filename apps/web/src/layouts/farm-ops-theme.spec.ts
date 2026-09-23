import { readFileSync } from 'node:fs';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { farmOpsTokens as tokens } from '../farm-ops-tokens';
import AdminLayout from './AdminLayout.vue';
import router from '../router';
import AlertsView from '../views/AlertsView.vue';
import DevicesView from '../views/DevicesView.vue';
import EnvironmentView from '../views/EnvironmentView.vue';
import HarvestView from '../views/HarvestView.vue';
import IngestObservabilityView from '../views/IngestObservabilityView.vue';

const httpGet = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  http: {
    get: httpGet,
    post: vi.fn(),
  },
  errorText: () => '请求失败',
}));

describe('farm-ops light admin theme', () => {
  beforeEach(async () => {
    localStorage.clear();
    httpGet.mockReset();
    httpGet.mockImplementation((url: string) => {
      if (String(url).includes('/harvest')) {
        return Promise.resolve({
          data: {
            date: '2026-09-23',
            summary: { matureCount: 0, mushroomCount: 0, harvestableCameras: 0 },
            items: [],
          },
        });
      }
      if (String(url).includes('/observability')) {
        return Promise.resolve({
          data: {
            windowMinutes: 15,
            accepted: 1,
            rejected: 0,
            latencyP50Ms: 4,
            latencyLatestMs: 4,
            channels: [],
            recentErrors: [],
          },
        });
      }
      return Promise.resolve({ data: { items: [], total: 0, unreadCount: 0 } });
    });
    await router.push('/login');
    await router.isReady();
  });

  it('locks the Family B hex tokens into the stylesheet and tailwind config', () => {
    const css = readFileSync('src/style.css', 'utf8');
    const tailwindConfig = readFileSync('tailwind.config.cjs', 'utf8');
    const layout = readFileSync('src/layouts/AdminLayout.vue', 'utf8');

    expect(tailwindConfig).toContain('src/farm-ops-tokens.ts');
    for (const value of Object.values(tokens) as string[]) {
      expect(css).toContain(value);
    }
    expect(css).toContain('border-radius: var(--radius-card)');
    expect(css).toContain('border: 1px solid var(--line)');
    expect(layout).toContain('bg-sidebar');
    expect(layout).toContain('data-theme="farm-ops-light"');
    expect(layout).toContain("label: '基地大屏'");
    expect(layout).not.toContain('二期槽位');
    expect(css).toContain('.tb-board');
    expect(css).toContain('.tb-floor');
    expect(css).toContain('.overview-alarms');
    expect(layout).not.toMatch(/雪亮|bg-slate-900|from-cyan|#00e5ff|#0b1220/i);
    expect(css).not.toMatch(/雪亮|#00e5ff|#0b1220/i);
  });

  it('paints the admin shell with the light page and green sidebar', async () => {
    localStorage.setItem('token', 'test-token');
    await router.push('/');
    await flushPromises();
    const wrapper = mount(AdminLayout, { global: { plugins: [router] } });

    expect(wrapper.get('.admin-shell').attributes('data-theme')).toBe('farm-ops-light');
    expect(wrapper.get('.admin-shell').classes()).toEqual(expect.arrayContaining(['bg-canvas', 'text-ink']));
    expect(wrapper.get('.admin-sidebar').classes()).toContain('bg-sidebar');
    expect(wrapper.get('.admin-topbar').classes()).toContain('bg-white');
    expect(wrapper.find('.admin-main').exists()).toBe(true);
    expect(wrapper.html()).not.toMatch(/雪亮|bg-slate-900|from-cyan/);
    wrapper.unmount();
  });

  it('keeps devices, alerts, harvest, environment, and ingest on the same page class', async () => {
    const pages = [
      ['devices', DevicesView],
      ['alerts', AlertsView],
      ['harvest', HarvestView],
      ['environment', EnvironmentView],
      ['ingest', IngestObservabilityView],
    ] as const;
    for (const [label, component] of pages) {
      const wrapper = mount(component);
      await flushPromises();
      expect(wrapper.find('.ops-page').exists(), label).toBe(true);
      wrapper.unmount();
    }
  });
});
