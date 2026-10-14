<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
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

const route = useRoute();
const router = useRouter();
const latestRows = ref<Row[]>([]);
const rows = ref<Row[]>([]);
const loading = ref(true);
const error = ref('');
const filterError = ref('');
const sensorDraft = ref('');
const fromDraft = ref('');
const toDraft = ref('');
const hourPoints = ref<Array<{ hour: string; temperature: number | null; humidity: number | null }>>([]);

function queryValue(key: string) {
  const value = route.query[key];
  return typeof value === 'string' ? value : '';
}

function invalidBound(value: string) {
  return value !== '' && Number.isNaN(new Date(value).getTime());
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function toLocalInput(value: string) {
  if (!value || invalidBound(value)) return '';
  const date = new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function syncDrafts() {
  sensorDraft.value = (queryValue('sensorCode') || queryValue('deviceCode')).trim();
  fromDraft.value = toLocalInput(queryValue('from'));
  toDraft.value = toLocalInput(queryValue('to'));
}

const bounds = computed(() => ({
  sensorCode: (queryValue('sensorCode') || queryValue('deviceCode')).trim(),
  from: queryValue('from'),
  to: queryValue('to'),
}));

const filterLabel = computed(() => {
  const parts: string[] = [];
  if (bounds.value.sensorCode) parts.push(bounds.value.sensorCode);
  if (bounds.value.from && !invalidBound(bounds.value.from)) {
    parts.push(new Date(bounds.value.from).toLocaleString('zh-CN'));
  }
  if (bounds.value.to && !invalidBound(bounds.value.to)) {
    parts.push(new Date(bounds.value.to).toLocaleString('zh-CN'));
  }
  return parts.join(' · ');
});

function reading(value: number | null | undefined, unit: string) {
  return value === null || value === undefined ? '—' : `${value}${unit}`;
}

async function load() {
  loading.value = true;
  error.value = '';
  filterError.value = '';
  const filter = bounds.value;
  const badTime = invalidBound(filter.from) || invalidBound(filter.to);
  if (badTime) {
    rows.value = [];
    filterError.value = '时间筛选无效';
  }
  try {
    const latest = await http.get<{ items: Row[] }>('/ingest/environment-readings/latest');
    latestRows.value = Array.isArray(latest.data.items) ? latest.data.items : [];
    if (!badTime) {
      const params: Record<string, string> = { pageSize: '50' };
      if (filter.sensorCode) params.sensorCode = filter.sensorCode;
      if (filter.from) params.from = new Date(filter.from).toISOString();
      if (filter.to) params.to = new Date(filter.to).toISOString();
      const response = await http.get<{ items: Row[] }>('/ingest/environment-readings', { params });
      rows.value = Array.isArray(response.data.items) ? response.data.items : [];
    }
  } catch (cause) {
    error.value = errorText(cause);
    if (!badTime) rows.value = [];
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
}

async function applyHistory() {
  const sensorCode = sensorDraft.value.trim();
  const from = fromDraft.value.trim();
  const to = toDraft.value.trim();
  if ((from && invalidBound(from)) || (to && invalidBound(to))) {
    filterError.value = '时间筛选无效';
    return;
  }
  const query: Record<string, string> = {};
  if (sensorCode) query.sensorCode = sensorCode;
  if (from) query.from = new Date(from).toISOString();
  if (to) query.to = new Date(to).toISOString();
  await router.replace({ path: route.path, query });
}

async function clearHistory() {
  sensorDraft.value = '';
  fromDraft.value = '';
  toDraft.value = '';
  await router.replace({ path: route.path, query: {} });
}

watch(
  () => [route.query.sensorCode, route.query.deviceCode, route.query.from, route.query.to],
  () => {
    syncDrafts();
    void load();
  },
  { immediate: true },
);
</script>

<template>
  <section class="ops-page panel overflow-x-auto bg-white">
    <h2 class="text-lg">环境读数</h2>
    <p class="mb-3 text-sm text-mist">
      HTTP {{ INGEST_ENVIRONMENT_HTTP_PATH }} · MQTT {{ MQTT_ENVIRONMENT_TOPIC }}
    </p>
    <form class="mb-3 flex flex-wrap items-end gap-3" @submit.prevent="applyHistory">
      <label class="text-sm">传感器
        <input
          v-model="sensorDraft"
          class="field mt-1"
          placeholder="传感器 / 设备编号"
          data-testid="env-history-sensor"
        />
      </label>
      <label class="text-sm">开始
        <input
          v-model="fromDraft"
          class="field mt-1"
          type="datetime-local"
          data-testid="env-history-from"
        />
      </label>
      <label class="text-sm">结束
        <input
          v-model="toDraft"
          class="field mt-1"
          type="datetime-local"
          data-testid="env-history-to"
        />
      </label>
      <button class="btn-ghost" type="submit" data-testid="env-history-apply">查询</button>
      <button class="btn-ghost" type="button" data-testid="env-history-clear" @click="clearHistory">清除</button>
    </form>
    <p v-if="filterLabel" class="mb-3 text-sm text-mist" data-testid="env-history-scope">筛选 {{ filterLabel }}</p>
    <ul v-if="hourPoints.length" class="mb-3 text-sm" data-testid="env-hours">
      <li v-for="point in hourPoints" :key="point.hour" class="font-mono">
        {{ point.hour }} · {{ reading(point.temperature, '℃') }} · {{ reading(point.humidity, '%') }}
      </li>
    </ul>
    <p v-if="loading" class="text-mist">加载中…</p>
    <p v-else-if="error" class="text-danger">{{ error }}</p>
    <p v-else-if="filterError" class="text-danger">{{ filterError }}</p>
    <p v-else-if="!filterLabel && !latestRows.length && !rows.length" class="text-mist">暂无环境读数。</p>
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
      <h3 v-if="rows.length || filterLabel" class="mb-2 text-sm">历史读数</h3>
      <p v-if="filterLabel && !rows.length" class="text-mist">没有符合条件的环境读数。</p>
      <table v-if="rows.length" class="data-table" data-testid="env-history">
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
          <tr v-for="row in rows" :key="row.id">
            <td class="font-mono text-xs">{{ new Date(row.observedAt).toLocaleString('zh-CN') }}</td>
            <td>{{ row.shedCode }}</td>
            <td class="font-mono">
              <router-link class="text-accent" :to="`/environment/${row.id}`" data-testid="env-history-link">{{ row.sensorCode }}</router-link>
            </td>
            <td class="font-mono text-accent">{{ reading(row.temperature, '℃') }}</td>
            <td class="font-mono text-accent">{{ reading(row.humidity, '%') }}</td>
            <td class="font-mono">{{ reading(row.co2, '') }}</td>
            <td class="font-mono">{{ reading(row.substrateMoisture, '%') }}</td>
            <td>{{ row.source }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>
