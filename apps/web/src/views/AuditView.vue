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

const rows = ref<LogRow[]>([]);
const error = ref('');
const loading = ref(true);

onMounted(async () => {
  try {
    const response = await http.get<{ items: LogRow[] }>('/audit-logs');
    rows.value = response.data.items;
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <section class="panel overflow-x-auto">
    <h2 class="mb-3 text-lg">登录与操作审计</h2>
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
