<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { errorText, http } from '../api';

const DEFAULT_SENSOR = 'SENSOR-ENV24-01';

interface Point {
  hour: string;
  temperature: number | null;
  humidity: number | null;
  co2: number | null;
  substrateMoisture: number | null;
}

interface SeriesResponse {
  hours: number;
  from: string;
  to: string;
  sensorCode: string | null;
  points: Point[];
  sheds: Array<{ shedCode: string; points: Point[] }>;
}

interface ShedOption {
  code: string;
  name: string;
}

interface ChartSpec {
  key: string;
  label: string;
  unit: string;
  color: string;
  pick: (point: Point) => number | null;
}

const charts: ChartSpec[] = [
  { key: 'temperature', label: '温度', unit: '℃', color: '#c44536', pick: (point) => point.temperature },
  { key: 'humidity', label: '湿度', unit: '%', color: '#1B7A4E', pick: (point) => point.humidity },
  { key: 'co2', label: 'CO₂', unit: '', color: '#334155', pick: (point) => point.co2 },
  { key: 'moisture', label: '基质含水率', unit: '%', color: '#d97706', pick: (point) => point.substrateMoisture },
];

const route = useRoute();
const router = useRouter();
const sheds = ref<ShedOption[]>([]);
const shedCode = ref('');
const sensorDraft = ref(DEFAULT_SENSOR);
const points = ref<Point[]>([]);
const loading = ref(true);
const error = ref('');

function queryText(key: string) {
  const value = route.query[key];
  return typeof value === 'string' ? value.trim() : '';
}

function formatPlain(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatMetric(value: number | null, unit: string) {
  if (value === null || value === undefined) return '—';
  return `${formatPlain(value)}${unit}`;
}

function hourLabel(iso: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const hour = pick('hour') === '24' ? '00' : pick('hour');
  return `${pick('month')}-${pick('day')} ${hour}:00`;
}

function seriesValues(pick: (point: Point) => number | null) {
  return points.value
    .map((point) => pick(point))
    .filter((value): value is number => value !== null && Number.isFinite(value));
}

function spanText(spec: ChartSpec) {
  const values = seriesValues(spec.pick);
  if (values.length < 2) return '';
  const first = values[0];
  const last = values[values.length - 1];
  const delta = Math.round((last - first) * 10) / 10;
  const change = delta > 0 ? `升 ${formatPlain(delta)}` : delta < 0 ? `降 ${formatPlain(Math.abs(delta))}` : '平';
  return `${spec.label} ${formatMetric(first, spec.unit)} → ${formatMetric(last, spec.unit)}（${change}）`;
}

function stepText(spec: ChartSpec, index: number) {
  const current = spec.pick(points.value[index]);
  const previous = index > 0 ? spec.pick(points.value[index - 1]) : undefined;
  if (previous === undefined || previous === null || current === null) return '—';
  const delta = Math.round((current - previous) * 10) / 10;
  if (delta > 0) return `升 ${formatPlain(delta)}`;
  if (delta < 0) return `降 ${formatPlain(Math.abs(delta))}`;
  return '平';
}

function polyline(spec: ChartSpec) {
  const indexed = points.value.map((point, index) => ({ index, value: spec.pick(point) }));
  const present = indexed.filter((item): item is { index: number; value: number } => item.value !== null && Number.isFinite(item.value));
  if (present.length < 2) return '';
  const nums = present.map((item) => item.value);
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const lastIndex = Math.max(points.value.length - 1, 1);
  const width = 320;
  const height = 120;
  return present
    .map((item) => {
      const x = 12 + (item.index / lastIndex) * (width - 24);
      const y = 12 + (1 - (item.value - min) / span) * (height - 24);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

const drawn = computed(() =>
  charts
    .map((spec) => ({ ...spec, span: spanText(spec), line: polyline(spec) }))
    .filter((spec) => spec.line),
);

const deltaNote = computed(() => drawn.value.map((spec) => spec.span).filter(Boolean).join('；'));

const scopeText = computed(() => {
  const shed = shedCode.value || '—';
  const sensor = sensorDraft.value || DEFAULT_SENSOR;
  return `棚区 ${shed} · 24 小时 · 传感器 ${sensor}`;
});

async function loadSheds() {
  if (sheds.value.length) return;
  const response = await http.get<ShedOption[]>('/sheds');
  sheds.value = Array.isArray(response.data) ? response.data : [];
}

function resolvedShed() {
  const asked = queryText('shedCode');
  if (asked && sheds.value.some((shed) => shed.code === asked)) return asked;
  if (sheds.value.some((shed) => shed.code === 'S01')) return 'S01';
  return sheds.value[0]?.code ?? asked;
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    await loadSheds();
    const shed = resolvedShed();
    const sensor = queryText('sensorCode') || DEFAULT_SENSOR;
    if (queryText('shedCode') !== shed || queryText('sensorCode') !== sensor) {
      await router.replace({ path: '/shed-env-24h', query: { shedCode: shed, sensorCode: sensor } });
      return;
    }
    shedCode.value = shed;
    sensorDraft.value = sensor;
    const response = await http.get<SeriesResponse>('/growth-trends/environment', {
      params: { hours: 24, shedCode: shed, sensorCode: sensor },
    });
    const matched = response.data.sheds?.find((item) => item.shedCode === shed);
    points.value = matched?.points?.length ? matched.points : response.data.points ?? [];
  } catch (cause) {
    error.value = errorText(cause);
    points.value = [];
  } finally {
    loading.value = false;
  }
}

async function onShedChange() {
  const sensor = sensorDraft.value.trim() || DEFAULT_SENSOR;
  await router.replace({
    path: '/shed-env-24h',
    query: { shedCode: shedCode.value, sensorCode: sensor },
  });
}

async function applySensor() {
  const sensor = sensorDraft.value.trim() || DEFAULT_SENSOR;
  await router.replace({
    path: '/shed-env-24h',
    query: { shedCode: shedCode.value || resolvedShed(), sensorCode: sensor },
  });
}

watch(
  () => [route.query.shedCode, route.query.sensorCode],
  () => {
    void load();
  },
  { immediate: true },
);
</script>

<template>
  <section class="ops-page space-y-4" data-testid="env24-board">
    <h2 class="text-lg">单棚环境 24 小时</h2>
    <form class="panel flex flex-wrap items-end gap-3 bg-white" @submit.prevent="applySensor">
      <label class="text-sm text-mist">
        棚区
        <select v-model="shedCode" class="field mt-1" data-testid="env24-shed" @change="onShedChange">
          <option v-for="shed in sheds" :key="shed.code" :value="shed.code">
            {{ shed.name }}（{{ shed.code }}）
          </option>
        </select>
      </label>
      <label class="text-sm text-mist">
        传感器
        <input v-model="sensorDraft" class="field mt-1" data-testid="env24-sensor" />
      </label>
      <button class="btn-primary" type="submit" data-testid="env24-apply">查看</button>
    </form>
    <p class="text-sm text-mist" data-testid="env24-scope">{{ scopeText }}</p>
    <p v-if="loading" class="text-mist">加载中…</p>
    <p v-else-if="error" class="text-danger" data-testid="env24-error">{{ error }}</p>
    <template v-else>
      <p v-if="deltaNote" class="panel bg-white text-sm" data-testid="env24-delta">{{ deltaNote }}</p>
      <p v-if="!drawn.length" class="text-mist" data-testid="env24-empty">近 24 小时没有小时桶，未绘制曲线。</p>
      <div v-else class="grid gap-3 md:grid-cols-2">
        <article
          v-for="chart in drawn"
          :key="chart.key"
          class="panel bg-white"
          :data-testid="`env24-card-${chart.key}`"
        >
          <h3 class="text-sm">{{ chart.label }}</h3>
          <p class="mb-2 text-sm" :data-testid="`env24-span-${chart.key}`">{{ chart.span }}</p>
          <svg
            class="h-36 w-full"
            viewBox="0 0 320 120"
            role="img"
            :aria-label="chart.span"
            :data-testid="`env24-chart-${chart.key}`"
          >
            <polyline
              fill="none"
              :stroke="chart.color"
              stroke-width="2.5"
              stroke-linejoin="round"
              stroke-linecap="round"
              :points="chart.line"
            />
          </svg>
        </article>
      </div>
      <table v-if="points.length" class="data-table" data-testid="env24-table">
        <thead>
          <tr>
            <th>小时</th>
            <th>温度</th>
            <th>温度变化</th>
            <th>湿度</th>
            <th>湿度变化</th>
            <th>CO₂</th>
            <th>基质含水率</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(point, index) in points" :key="point.hour">
            <td class="font-mono text-xs">{{ hourLabel(point.hour) }}</td>
            <td class="font-mono">{{ formatMetric(point.temperature, '℃') }}</td>
            <td data-testid="env24-temp-step">{{ stepText(charts[0], index) }}</td>
            <td class="font-mono">{{ formatMetric(point.humidity, '%') }}</td>
            <td data-testid="env24-humidity-step">{{ stepText(charts[1], index) }}</td>
            <td class="font-mono">{{ formatMetric(point.co2, '') }}</td>
            <td class="font-mono">{{ formatMetric(point.substrateMoisture, '%') }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>
