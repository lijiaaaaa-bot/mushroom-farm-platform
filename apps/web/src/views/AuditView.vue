<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { errorText, http } from '../api';

interface CountChange {
  old?: number;
  new?: number;
}

interface LogRow {
  id: string;
  username: string | null;
  action: string;
  resource: string;
  createdAt: string;
  detail?: {
    shedCode?: string;
    cameraCode?: string;
    changes?: Record<string, CountChange>;
  } | null;
}

interface LoginRow {
  id: string;
  username: string | null;
  result: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

const FIELD_LABEL: Record<string, string> = {
  matureCount: '成熟数',
  mushroomCount: '蘑菇数',
};

function detailText(detail: LogRow['detail']): string {
  if (!detail) return '—';
  const parts: string[] = [];
  if (detail.shedCode) parts.push(detail.shedCode);
  if (detail.cameraCode) parts.push(detail.cameraCode);
  for (const [key, value] of Object.entries(detail.changes ?? {})) {
    if (value && typeof value.old === 'number' && typeof value.new === 'number') {
      parts.push(`${FIELD_LABEL[key] ?? key} ${value.old}→${value.new}`);
    }
  }
  return parts.length ? parts.join(' ') : '—';
}

function resultLabel(result: string): string {
  if (result === 'success') return '成功';
  if (result === 'failure') return '失败';
  return result;
}

const rows = ref<LogRow[]>([]);
const error = ref('');
const loading = ref(true);
const loginRows = ref<LoginRow[]>([]);
const loginError = ref('');
const loginLoading = ref(true);

onMounted(async () => {
  await Promise.all([loadLoginLogs(), loadAudit()]);
});

async function loadLoginLogs() {
  try {
    const response = await http.get<{ items: LoginRow[] }>('/login-logs');
    loginRows.value = response.data.items;
  } catch (cause) {
    loginError.value = errorText(cause);
  } finally {
    loginLoading.value = false;
  }
}

async function loadAudit() {
  try {
    const response = await http.get<{ items: LogRow[] }>('/audit-logs');
    rows.value = response.data.items;
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <section class="panel mb-4 overflow-x-auto">
    <h2 class="mb-3 text-lg">登录日志</h2>
    <p class="mb-3 text-sm text-mist">成功与失败。仅超管与生产管理员可查看。</p>
    <p v-if="loginLoading" class="text-mist">加载中…</p>
    <p v-else-if="loginError" class="text-danger">{{ loginError }}</p>
    <table v-else class="data-table">
      <thead><tr><th>时间</th><th>用户</th><th>结果</th><th>IP</th><th>User-Agent</th></tr></thead>
      <tbody>
        <tr v-for="row in loginRows" :key="row.id">
          <td class="font-mono text-xs">{{ new Date(row.createdAt).toLocaleString('zh-CN') }}</td>
          <td>{{ row.username || '—' }}</td>
          <td>{{ resultLabel(row.result) }}</td>
          <td class="font-mono text-xs">{{ row.ip || '—' }}</td>
          <td class="max-w-xs truncate font-mono text-xs">{{ row.userAgent || '—' }}</td>
        </tr>
      </tbody>
    </table>
  </section>
  <section class="panel overflow-x-auto">
    <h2 class="mb-3 text-lg">操作审计</h2>
    <p class="mb-3 text-sm text-mist">仅超管与生产管理员可查看。</p>
    <p v-if="loading" class="text-mist">加载中…</p>
    <p v-else-if="error" class="text-danger">{{ error }}</p>
    <table v-else class="data-table">
      <thead><tr><th>时间</th><th>用户</th><th>动作</th><th>资源</th><th>明细</th></tr></thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td class="font-mono text-xs">{{ new Date(row.createdAt).toLocaleString('zh-CN') }}</td>
          <td>{{ row.username || '—' }}</td>
          <td>{{ row.action }}</td>
          <td class="font-mono text-xs">{{ row.resource }}</td>
          <td>{{ detailText(row.detail) }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
