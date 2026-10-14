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
  co2: number | null;
  substrateMoisture: number | null;
  source: string;
}

const latestRows = ref<Row[]>([]);
const rows = ref<Row[]>([]);
const loading = ref(true);
const error = ref('');
const hourPoints = ref<Array<{ hour: string; temperature: number | null; humidity: number | null }>>([]);

onMounted(async () => {
  try {
    const latest = await http.get<{ items: Row[] }>('/ingest/environment-readings/latest');
    latestRows.value = Array.isArray(latest.data.items) ? latest.data.items : [];
    const response = await http.get<{ items: Row[] }>('/ingest/environment-readings?pageSize=50');
    rows.value = Array.isArray(response.data.items) ? response.data.items : [];
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
  try {
    const series = await http.get<{
      points?: Array<{ hour: string; temperature: number | null; humidity: number | null }>;
    }>('/growth-trends/environment', { params: { hours: 24 } });
    if (Array.isArray(series.data.points)) hourPoints.value = series.data.points;
  } catch {
    hourPoints.value = [];
  }
});

function reading(value: number | null | undefined, unit: string) {
  return value === null || value === undefined ? '—' : `${value}${unit}`;
}
</script>

<template>
  <section class="ops-page panel overflow-x-auto bg-white">
    <h2 class="text-lg">环境读数</h2>
    <p class="mb-3 text-sm text-mist">
      HTTP {{ INGEST_ENVIRONMENT_HTTP_PATH }} · MQTT {{ MQTT_ENVIRONMENT_TOPIC }}
    </p>
    <ul v-if="hourPoints.length" class="mb-3 text-sm" data-testid="env-hours">
      <li v-for="point in hourPoints" :key="point.hour" class="font-mono">
        {{ point.hour }} · {{ reading(point.temperature, '℃') }} · {{ reading(point.humidity, '%') }}
      </li>
    </ul>
    <p v-if="loading" class="text-mist">加载中…</p>
    <p v-else-if="error" class="text-danger">{{ error }}</p>
    <p v-else-if="!latestRows.length && !rows.length" class="text-mist">暂无环境读数。</p>
    <template v-else>
      <h3 v-if="latestRows.length" class="mb-2 text-sm">最新值</h3>
      <table v-if="latestRows.length" class="data-table mb-4" data-testid="env-latest">
        <thead>
          <tr>
            <th>时间</th>
            <th>棚区</th>
            <th>传感器</th>
            <th>温度</th>
            <th>湿度</th>
            <th>CO₂</th>
            <th>基质含水率</th>
            <th>来源</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in latestRows" :key="row.id">
            <td class="font-mono text-xs">{{ new Date(row.observedAt).toLocaleString('zh-CN') }}</td>
            <td>{{ row.shedCode }}</td>
            <td class="font-mono">
              <router-link
                class="text-accent"
                :to="`/environment/${row.id}`"
                data-testid="env-latest-link"
              >{{ row.sensorCode }}</router-link>
            </td>
            <td class="font-mono text-accent">{{ reading(row.temperature, '℃') }}</td>
            <td class="font-mono text-accent">{{ reading(row.humidity, '%') }}</td>
            <td class="font-mono">{{ reading(row.co2, '') }}</td>
            <td class="font-mono">{{ reading(row.substrateMoisture, '%') }}</td>
            <td>{{ row.source }}</td>
          </tr>
        </tbody>
      </table>
      <h3 v-if="rows.length" class="mb-2 text-sm">最近读数</h3>
      <table v-if="rows.length" class="data-table">
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
    </template>
  </section>
</template>
