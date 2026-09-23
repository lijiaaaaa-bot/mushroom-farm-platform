<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ALERT_LEVEL_LABEL, ALERT_METRIC_LABEL, type AlertLevel, type AlertMetric } from '@mushroom/contracts';
import { errorText, http } from '../api';

interface Rule {
  id: string;
  name: string;
  metric: AlertMetric;
  threshold: number;
  level: AlertLevel;
  enabled: boolean;
  windowMinutes: number;
}

const rows = ref<Rule[]>([]);
const error = ref('');
const loading = ref(true);

onMounted(async () => {
  try {
    const response = await http.get<Rule[]>('/alert-rules');
    rows.value = response.data;
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <section class="panel overflow-x-auto">
    <h2 class="mb-3 text-lg">阈值规则</h2>
    <p v-if="loading" class="text-mist">加载中…</p>
    <p v-else-if="error" class="text-red-300">{{ error }}</p>
    <table v-else class="data-table">
      <thead><tr><th>名称</th><th>指标</th><th>阈值</th><th>等级</th><th>窗口分钟</th><th>启用</th></tr></thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td>{{ row.name }}</td>
          <td>{{ ALERT_METRIC_LABEL[row.metric] }}</td>
          <td class="font-mono">{{ row.threshold }}</td>
          <td>{{ ALERT_LEVEL_LABEL[row.level] }}</td>
          <td>{{ row.windowMinutes }}</td>
          <td>{{ row.enabled ? '是' : '否' }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
