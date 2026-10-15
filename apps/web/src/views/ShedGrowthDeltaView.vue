<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { errorText, http } from '../api';

const DEFAULT_CAMERA = 'CAM-GD-01';

interface Point {
  day: string;
  mushroomCount: number;
  matureCount?: number;
}

interface CameraSeries {
  cameraCode: string;
  points: Point[];
}

interface ShedSeries {
  shedCode: string;
  points: Point[];
  cameras: CameraSeries[];
}

interface TrendResponse {
  days: number;
  sheds: ShedSeries[];
}

interface ShedOption {
  code: string;
  name: string;
}

interface DeltaPoint {
  day: string;
  mushroomDelta: number;
  matureDelta: number;
}

interface ChartSpec {
  key: 'mushroom' | 'mature';
  label: string;
  color: string;
  pick: (point: DeltaPoint) => number;
}

const charts: ChartSpec[] = [
  { key: 'mushroom', label: '蘑菇增量', color: '#1B7A4E', pick: (point) => point.mushroomDelta },
  { key: 'mature', label: '成熟增量', color: '#334155', pick: (point) => point.matureDelta },
];

const route = useRoute();
const router = useRouter();
const sheds = ref<ShedOption[]>([]);
const shedCode = ref('');
const cameraDraft = ref(DEFAULT_CAMERA);
const days = ref<7 | 30>(7);
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

function formatDelta(value: number) {
  if (value > 0) return `+${formatPlain(value)}`;
  if (value < 0) return `-${formatPlain(Math.abs(value))}`;
  return '0';
}

function direction(first: number, last: number) {
  if (last > first) return '升';
  if (last < first) return '降';
  return '平';
}

function seriesNote(label: string, values: number[]) {
  if (values.length < 2) return '';
  const change = direction(values[0], values[values.length - 1]);
  return `${label} ${values.map((value) => formatPlain(value)).join(' → ')}（${change}）`;
}

function stepText(current: number, previous: number | undefined) {
  if (previous === undefined) return '—';
  const delta = Math.round((current - previous) * 10) / 10;
  if (delta > 0) return `升 ${formatPlain(delta)}`;
  if (delta < 0) return `降 ${formatPlain(Math.abs(delta))}`;
  return '平';
}

const deltas = computed<DeltaPoint[]>(() => {
  const ordered = [...points.value].sort((a, b) => a.day.localeCompare(b.day));
  const rows: DeltaPoint[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    rows.push({
      day: current.day,
      mushroomDelta: current.mushroomCount - previous.mushroomCount,
      matureDelta: (current.matureCount ?? 0) - (previous.matureCount ?? 0),
    });
  }
  return rows;
});

function polyline(spec: ChartSpec) {
  if (deltas.value.length < 2) return '';
  const nums = deltas.value.map((point) => spec.pick(point));
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const lastIndex = Math.max(deltas.value.length - 1, 1);
  const width = 320;
  const height = 120;
  return deltas.value
    .map((point, index) => {
      const x = 12 + (index / lastIndex) * (width - 24);
      const y = 12 + (1 - (spec.pick(point) - min) / span) * (height - 24);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

const drawn = computed(() =>
  charts
    .map((spec) => ({
      ...spec,
      span: seriesNote(spec.label, deltas.value.map((point) => spec.pick(point))),
      line: polyline(spec),
    }))
    .filter((spec) => spec.line),
);

const deltaNote = computed(() => drawn.value.map((spec) => spec.span).filter(Boolean).join('；'));

const scopeText = computed(() => {
  const shed = shedCode.value || '—';
  const camera = cameraDraft.value || DEFAULT_CAMERA;
  return `棚区 ${shed} · ${days.value} 天 · 摄像头 ${camera}`;
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
    const camera = queryText('cameraCode') || DEFAULT_CAMERA;
    const windowDays: 7 | 30 = route.query.days === '30' ? 30 : 7;
    const query = { days: String(windowDays), shedCode: shed, cameraCode: camera };
    if (
      queryText('days') !== query.days ||
      queryText('shedCode') !== query.shedCode ||
      queryText('cameraCode') !== query.cameraCode
    ) {
      await router.replace({ path: '/shed-growth-delta', query });
      return;
    }
    days.value = windowDays;
    shedCode.value = shed;
    cameraDraft.value = camera;
    const response = await http.get<TrendResponse>('/growth-trends', {
      params: { days: windowDays, shedCode: shed, cameraCode: camera },
    });
    const matched = response.data.sheds?.find((item) => item.shedCode === shed);
    const cameraSeries = matched?.cameras?.find((item) => item.cameraCode === camera);
    points.value = cameraSeries?.points ?? [];
  } catch (cause) {
    error.value = errorText(cause);
    points.value = [];
  } finally {
    loading.value = false;
  }
}

async function replaceQuery(next: { days?: 7 | 30; shedCode?: string; cameraCode?: string }) {
  const windowDays = next.days ?? days.value;
  const shed = next.shedCode ?? shedCode.value;
  const camera = (next.cameraCode ?? cameraDraft.value).trim() || DEFAULT_CAMERA;
  await router.replace({
    path: '/shed-growth-delta',
    query: { days: String(windowDays), shedCode: shed, cameraCode: camera },
  });
}

function mushroomStep(index: number) {
  const previous = index > 0 ? deltas.value[index - 1]?.mushroomDelta : undefined;
  return stepText(deltas.value[index].mushroomDelta, previous);
}

watch(
  () => [route.query.days, route.query.shedCode, route.query.cameraCode],
  () => {
    void load();
  },
  { immediate: true },
);
</script>

<template>
  <section class="ops-page space-y-4" data-testid="growth-delta-board">
    <h2 class="text-lg">单棚当日生长增量</h2>
    <form class="panel flex flex-wrap items-end gap-3 bg-white" @submit.prevent="replaceQuery({})">
      <label class="text-sm text-mist">
        棚区
        <select
          v-model="shedCode"
          class="field mt-1"
          data-testid="growth-delta-shed"
          @change="replaceQuery({ shedCode: shedCode })"
        >
          <option v-for="shed in sheds" :key="shed.code" :value="shed.code">
            {{ shed.name }}（{{ shed.code }}）
          </option>
        </select>
      </label>
      <label class="text-sm text-mist">
        摄像头
        <input v-model="cameraDraft" class="field mt-1 font-mono" data-testid="growth-delta-camera" />
      </label>
      <button class="btn-primary" type="submit" data-testid="growth-delta-apply">查看</button>
      <div class="flex gap-2">
        <button
          type="button"
          data-testid="growth-delta-days-7"
          :class="days === 7 ? 'btn-primary' : 'btn-ghost'"
          @click="replaceQuery({ days: 7 })"
        >
          7 天
        </button>
        <button
          type="button"
          data-testid="growth-delta-days-30"
          :class="days === 30 ? 'btn-primary' : 'btn-ghost'"
          @click="replaceQuery({ days: 30 })"
        >
          30 天
        </button>
      </div>
    </form>
    <p class="text-sm text-mist" data-testid="growth-delta-scope">{{ scopeText }}</p>
    <p class="text-sm text-mist">曲线和表是相邻日的差。</p>
    <p v-if="loading" class="text-mist">加载中…</p>
    <p v-else-if="error" class="text-danger" data-testid="growth-delta-error">{{ error }}</p>
    <template v-else>
      <p v-if="deltaNote" class="panel bg-white text-sm" data-testid="growth-delta-note">{{ deltaNote }}</p>
      <p v-if="!drawn.length" class="text-mist" data-testid="growth-delta-empty">没有相邻日增量，未绘制曲线。</p>
      <div v-else class="grid gap-3 md:grid-cols-2">
        <article
          v-for="chart in drawn"
          :key="chart.key"
          class="panel bg-white"
          :data-testid="`growth-delta-card-${chart.key}`"
        >
          <h3 class="text-sm">{{ chart.label }}曲线</h3>
          <p class="mb-2 text-sm" :data-testid="`growth-delta-span-${chart.key}`">{{ chart.span }}</p>
          <svg
            class="h-36 w-full"
            viewBox="0 0 320 120"
            role="img"
            :aria-label="chart.span"
            :data-testid="`growth-delta-chart-${chart.key}`"
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
      <table v-if="deltas.length >= 2" class="data-table" data-testid="growth-delta-table">
        <thead>
          <tr>
            <th>日期</th>
            <th>蘑菇增量</th>
            <th>成熟增量</th>
            <th>相对上一增量</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(point, index) in deltas" :key="point.day">
            <td class="font-mono text-xs">{{ point.day }}</td>
            <td class="font-mono" data-testid="growth-delta-mushroom">{{ formatDelta(point.mushroomDelta) }}</td>
            <td class="font-mono" data-testid="growth-delta-mature">{{ formatDelta(point.matureDelta) }}</td>
            <td data-testid="growth-delta-step">{{ mushroomStep(index) }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>
