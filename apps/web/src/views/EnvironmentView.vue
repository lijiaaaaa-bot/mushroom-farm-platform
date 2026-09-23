<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { INGEST_ENVIRONMENT_HTTP_PATH, MQTT_ENVIRONMENT_TOPIC } from '@mushroom/contracts';
import { errorText, http } from '../api';

interface Row {
  id: string;
  shedCode: string;
  sensorCode: string;
  observedAt: string;
  temperature: number | null;
  humidity: number | null;
  source: string;
}

const rows = ref<Row[]>([]);
const loading = ref(true);
const error = ref('');

onMounted(async () => {
  try {
    const response = await http.get<{ items: Row[] }>('/ingest/environment-readings?pageSize=50');
    rows.value = response.data.items;
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
});

function reading(value: number | null, unit: string) {
  return value === null || value === undefined ? '—' : `${value}${unit}`;
}
</script>

<template>
  <section class="panel overflow-x-auto bg-white">
    <h2 class="text-lg">环境读数</h2>
    <p class="mb-3 text-sm text-mist">
      HTTP {{ INGEST_ENVIRONMENT_HTTP_PATH }} · MQTT {{ MQTT_ENVIRONMENT_TOPIC }}
    </p>
    <p v-if="loading" class="text-mist">加载中…</p>
    <p v-else-if="error" class="text-danger">{{ error }}</p>
    <p v-else-if="!rows.length" class="text-mist">暂无环境读数。</p>
    <table v-else class="data-table">
      <thead>
        <tr>
          <th>时间</th>
          <th>棚区</th>
          <th>传感器</th>
          <th>温度</th>
          <th>湿度</th>
          <th>来源</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td class="font-mono text-xs">{{ new Date(row.observedAt).toLocaleString('zh-CN') }}</td>
          <td>{{ row.shedCode }}</td>
          <td class="font-mono">{{ row.sensorCode }}</td>
          <td class="font-mono text-accent">{{ reading(row.temperature, '℃') }}</td>
          <td class="font-mono text-accent">{{ reading(row.humidity, '%') }}</td>
          <td>{{ row.source }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
