import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { farmOpsTokens as tokens } from './farm-ops-tokens';
import { currentUser } from './auth';
import AlertsView from './views/AlertsView.vue';
import LoginView from './views/LoginView.vue';

const httpGet = vi.hoisted(() => vi.fn());

vi.mock('./api', () => ({
  http: {
    get: httpGet,
    post: vi.fn(),
  },
  errorText: () => '请求失败',
}));

function channel(hex: string) {
  const value = Number.parseInt(hex, 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string) {
  const raw = hex.replace('#', '');
  return (
    0.2126 * channel(raw.slice(0, 2)) +
    0.7152 * channel(raw.slice(2, 4)) +
    0.0722 * channel(raw.slice(4, 6))
  );
}

function contrast(foreground: string, background: string) {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe('demo path contrast', () => {
  it('keeps green and warning text at 4.5:1 on the light page', () => {
    const css = readFileSync('src/style.css', 'utf8');
    expect(css).toContain(`--accent: ${tokens.accent}`);
    expect(css).toContain(`--press: ${tokens.press}`);
    expect(css).toContain(`--warn: ${tokens.warn}`);
    expect(css).toContain('bg-accent text-white');

    expect(contrast(tokens.accent, tokens.card)).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#FFFFFF', tokens.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens.accent, tokens.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens.warn, tokens.card)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens.warn, tokens.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens.mist, tokens.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens.critical, tokens.card)).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#FFFFFF', tokens.press)).toBeGreaterThan(contrast('#FFFFFF', tokens.accent));

    const screen = readFileSync('src/views/BigScreenView.vue', 'utf8');
    expect(screen).toContain('color: #ff6b6b');
    expect(contrast('#ff6b6b', '#12304a')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#6fce8a', '#12304a')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#9fb3c8', '#12304a')).toBeGreaterThanOrEqual(4.5);
  });

  it('gives the login page a main landmark and a primary button', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', component: LoginView },
        { path: '/', component: { template: '<div />' } },
      ],
    });
    await router.push('/login');
    await router.isReady();
    const wrapper = mount(LoginView, { global: { plugins: [router] } });
    expect(wrapper.find('main').exists()).toBe(true);
    expect(wrapper.get('h1').text()).toBe('食用菌种植管理平台');
    expect(wrapper.get('button[type="submit"]').classes()).toContain('btn-primary');
    expect(wrapper.get('input[autocomplete="username"]').element.tagName).toBe('INPUT');
    wrapper.unmount();
  });

  it('names the alert create fields and the actions column', async () => {
    currentUser.value = {
      id: 'user-1',
      username: 'admin',
      displayName: 'admin',
      role: 'super_admin',
      shedCodes: ['S01'],
    };
    httpGet.mockResolvedValue({
      data: {
        items: [
          {
            id: 'alert-1',
            shedCode: 'S01',
            cameraCode: 'CAM-S01',
            level: 'severe',
            status: 'open',
            title: '高温',
            message: '超过阈值',
            createdAt: '2026-10-14T00:00:00.000Z',
            claimedBy: null,
            claimNote: null,
            closeReason: null,
            closeNote: null,
          },
        ],
        total: 1,
      },
    });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
    });
    await router.push('/alerts');
    await router.isReady();
    const wrapper = mount(AlertsView, { global: { plugins: [router] } });
    await flushPromises();

    for (const name of ['棚区', '摄像头', '级别', '标题', '说明']) {
      expect(wrapper.find(`[aria-label="${name}"]`).exists(), name).toBe(true);
    }
    expect(wrapper.findAll('th').some((cell) => cell.text() === '操作')).toBe(true);
    expect(wrapper.get('[data-testid="alert-detail-link"]').classes()).toContain('text-accent');
    wrapper.unmount();
    currentUser.value = null;
  });
});
