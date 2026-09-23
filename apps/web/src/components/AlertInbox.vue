<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { ALERT_LEVEL_LABEL, type AlertLevel } from '@mushroom/contracts';
import { errorText, http } from '../api';
import {
  formatAlertTime,
  notifyFreshAlerts,
  requestAlertNotificationPermission,
  UNREAD_POLL_MS,
  type UnreadAlertItem,
} from './alert-notify';

const open = ref(false);
const loading = ref(true);
const error = ref('');
const unreadCount = ref(0);
const items = ref<UnreadAlertItem[]>([]);
const seen = ref(new Set<string>());
const primed = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;

function levelClass(level: AlertLevel) {
  if (level === 'severe') return 'text-danger';
  if (level === 'warning') return 'text-amber';
  return 'text-mist';
}

async function load() {
  error.value = '';
  try {
    const response = await http.get<{ unreadCount: number; items: UnreadAlertItem[] }>(
      '/alerts/unread',
    );
    const next = response.data.items ?? [];
    notifyFreshAlerts(next.filter((item) => primed.value && !seen.value.has(item.id)));
    items.value = next;
    unreadCount.value = response.data.unreadCount ?? next.length;
    seen.value = new Set(next.map((item) => item.id));
    primed.value = true;
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
}

async function markOne(id: string) {
  error.value = '';
  try {
    await http.post(`/alerts/${id}/read`);
    await load();
  } catch (cause) {
    error.value = errorText(cause);
  }
}

async function markAll() {
  error.value = '';
  try {
    await http.post('/alerts/read-all');
    await load();
  } catch (cause) {
    error.value = errorText(cause);
  }
}

async function enableBrowserNotify() {
  await requestAlertNotificationPermission();
}

onMounted(() => {
  void load();
  timer = setInterval(() => {
    void load();
  }, UNREAD_POLL_MS);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div class="relative">
    <button
      class="btn-ghost"
      type="button"
      aria-label="未读告警"
      :aria-expanded="open"
      data-testid="unread-entry"
      @click="open = !open"
    >
      <svg viewBox="0 0 24 24" class="mr-1 h-4 w-4 text-accent" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 3a5 5 0 0 0-5 5v2.1c0 .7-.3 1.4-.8 1.9L4.6 13.6c-.8.8-.3 2.2.8 2.2h13.2c1.1 0 1.6-1.4.8-2.2l-1.6-1.6c-.5-.5-.8-1.2-.8-1.9V8a5 5 0 0 0-5-5zm0 18a2.5 2.5 0 0 0 2.4-2h-4.8A2.5 2.5 0 0 0 12 21z"
        />
      </svg>
      未读
      <span
        class="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs text-white"
        data-testid="unread-count"
      >{{ unreadCount }}</span>
    </button>
    <div
      v-if="open"
      class="absolute right-0 z-20 mt-2 w-80 rounded-lg border border-line bg-white p-3 shadow-sm"
      data-testid="unread-panel"
    >
      <div class="mb-2 flex items-center justify-between gap-2">
        <p class="text-sm font-medium text-ink">未读告警</p>
        <button class="btn-ghost" type="button" data-testid="mark-all" @click="markAll">全部已读</button>
      </div>
      <p v-if="error" class="text-sm text-danger" data-testid="unread-error">{{ error }}</p>
      <p v-else-if="loading" class="text-sm text-mist">加载中…</p>
      <p v-else-if="items.length === 0" class="text-sm text-mist">暂无未读告警。</p>
      <ul v-else class="max-h-80 space-y-2 overflow-auto">
        <li
          v-for="item in items"
          :key="item.id"
          class="rounded-lg border border-line bg-canvas p-2"
          :data-testid="`unread-${item.id}`"
        >
          <p class="flex flex-wrap items-center gap-2 text-xs">
            <span :class="levelClass(item.level)">{{ ALERT_LEVEL_LABEL[item.level] }}</span>
            <span class="text-ink">棚 {{ item.shedCode }}</span>
            <span class="font-mono text-mist">{{ formatAlertTime(item.createdAt) }}</span>
          </p>
          <p class="mt-1 text-sm text-ink">{{ item.title }}</p>
          <button
            class="btn-ghost mt-2"
            type="button"
            :data-testid="`mark-${item.id}`"
            @click="markOne(item.id)"
          >标为已读</button>
        </li>
      </ul>
      <button class="btn-ghost mt-3" type="button" data-testid="enable-notify" @click="enableBrowserNotify">
        开启浏览器通知
      </button>
    </div>
  </div>
</template>
