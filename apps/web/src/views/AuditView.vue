<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { errorText, http } from '../api';

interface LogRow {
  id: string;
  username: string | null;
  action: string;
  resource: string;
  createdAt: string;
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
    <p v-else-if="error" class="text-red-300">{{ error }}</p>
    <table v-else class="data-table">
      <thead><tr><th>时间</th><th>用户</th><th>动作</th><th>资源</th></tr></thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td class="font-mono text-xs">{{ new Date(row.createdAt).toLocaleString('zh-CN') }}</td>
          <td>{{ row.username || '—' }}</td>
          <td>{{ row.action }}</td>
          <td class="font-mono text-xs">{{ row.resource }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
