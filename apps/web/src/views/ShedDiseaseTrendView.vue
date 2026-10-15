<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { errorText, http } from '../api';

interface Point {
  day: string;
  diseaseCount: number;
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

const route = useRoute();
const router = useRouter();
const sheds = ref<ShedOption[]>([]);
const shedCode = ref('');
const cameraDraft = ref('');
const days = ref<7 | 30>(7);
const points = ref<Point[]>([]);
const loading = ref(true);
const error = ref('');

function queryText(key: string) {
  const value = route.query[key];
  return typeof value === 'string' ? value.trim() : '';
}

function formatCount(value: number) {
  return String(Math.round(value));
}

function direction(first: number, last: number) {
  if (last > first) return '升';
  if (last < first) return '降';
  return '平';
}

function diseaseNote(values: number[]) {
  if (values.length < 2) return '';
  const change = direction(values[0], values[values.length - 1]);
  return `病害 ${values.map((value) => formatCount(value)).join(' → ')}（${change}）`;
}

function stepText(current: number, previous: number | undefined) {
  if (previous === undefined) return '—';
  const delta = Math.round(current - previous);
  if (delta > 0) return `升 ${delta}`;
  if (delta < 0) return `降 ${Math.abs(delta)}`;
  return '平';
}

const ordered = computed(() => [...points.value].sort((a, b) => a.day.localeCompare(b.day)));

const note = computed(() => diseaseNote(ordered.value.map((point) => point.diseaseCount)));

function polyline() {
  if (ordered.value.length < 2) return '';
  const nums = ordered.value.map((point) => point.diseaseCount);
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const lastIndex = Math.max(ordered.value.length - 1, 1);
  const width = 320;
  const height = 120;
  return ordered.value
    .map((point, index) => {
      const x = 12 + (index / lastIndex) * (width - 24);
      const y = 12 + (1 - (point.diseaseCount - min) / span) * (height - 24);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

const line = computed(() => polyline());

const scopeText = computed(() => {
  const shed = shedCode.value || '—';
  const camera = cameraDraft.value.trim();
  const cameraText = camera ? `摄像头 ${camera}` : '棚汇总';
  return `棚区 ${shed} · ${days.value} 天 · ${cameraText}`;
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
    const camera = queryText('cameraCode');
    const windowDays: 7 | 30 = route.query.days === '30' ? 30 : 7;
    const query: Record<string, string> = { days: String(windowDays), shedCode: shed };
    if (camera) query.cameraCode = camera;
    if (
      queryText('days') !== query.days ||
      queryText('shedCode') !== query.shedCode ||
      queryText('cameraCode') !== (query.cameraCode ?? '')
    ) {
      await router.replace({ path: '/shed-disease-trend', query });
      return;
    }
    days.value = windowDays;
    shedCode.value = shed;
    cameraDraft.value = camera;
    const response = await http.get<TrendResponse>('/diseases/trends', {
      params: query,
    });
    const matched = response.data.sheds?.find((item) => item.shedCode === shed);
    const cameraSeries = camera
      ? matched?.cameras?.find((item) => item.cameraCode === camera)
      : undefined;
    points.value = camera ? (cameraSeries?.points ?? []) : (matched?.points ?? []);
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
  const camera = (next.cameraCode ?? cameraDraft.value).trim();
  const query: Record<string, string> = { days: String(windowDays), shedCode: shed };
  if (camera) query.cameraCode = camera;
  await router.replace({ path: '/shed-disease-trend', query });
}

function dayStep(index: number) {
  const previous = index > 0 ? ordered.value[index - 1]?.diseaseCount : undefined;
  return stepText(ordered.value[index].diseaseCount, previous);
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
  <section class="ops-page space-y-4" data-testid="disease-trend-board">
    <h2 class="text-lg">单棚病害发生趋势</h2>
    <form class="panel flex flex-wrap items-end gap-3 bg-white" @submit.prevent="replaceQuery({})">
      <label class="text-sm text-mist">
        棚区
        <select
          v-model="shedCode"
          class="field mt-1"
          data-testid="disease-trend-shed"
          @change="replaceQuery({ shedCode: shedCode })"
        >
          <option v-for="shed in sheds" :key="shed.code" :value="shed.code">
            {{ shed.name }}（{{ shed.code }}）
          </option>
        </select>
      </label>
      <label class="text-sm text-mist">
        摄像头
        <input v-model="cameraDraft" class="field mt-1 font-mono" data-testid="disease-trend-camera" />
      </label>
      <button class="btn-primary" type="submit" data-testid="disease-trend-apply">查看</button>
      <div class="flex gap-2">
        <button
          type="button"
          data-testid="disease-trend-days-7"
          :class="days === 7 ? 'btn-primary' : 'btn-ghost'"
          @click="replaceQuery({ days: 7 })"
        >
          7 天
        </button>
        <button
          type="button"
          data-testid="disease-trend-days-30"
          :class="days === 30 ? 'btn-primary' : 'btn-ghost'"
          @click="replaceQuery({ days: 30 })"
        >
          30 天
        </button>
      </div>
    </form>
    <p class="text-sm text-mist" data-testid="disease-trend-scope">{{ scopeText }}</p>
    <p class="text-sm text-mist">曲线和表是病害数量。</p>
    <p v-if="loading" class="text-mist">加载中…</p>
    <p v-else-if="error" class="text-danger" data-testid="disease-trend-error">{{ error }}</p>
    <template v-else>
      <p v-if="note" class="panel bg-white text-sm" data-testid="disease-trend-note">{{ note }}</p>
      <p v-if="!line" class="text-mist" data-testid="disease-trend-empty">没有病害日趋势，未绘制曲线。</p>
      <article v-else class="panel bg-white" data-testid="disease-trend-card">
        <h3 class="text-sm">病害数量曲线</h3>
        <p class="mb-2 text-sm" data-testid="disease-trend-span">{{ note }}</p>
        <svg
          class="h-36 w-full"
          viewBox="0 0 320 120"
          role="img"
          :aria-label="note"
          data-testid="disease-trend-chart"
        >
          <polyline
            fill="none"
            stroke="#9A3412"
            stroke-width="2.5"
            stroke-linejoin="round"
            stroke-linecap="round"
            :points="line"
          />
        </svg>
      </article>
      <table v-if="ordered.length >= 2" class="data-table" data-testid="disease-trend-table">
        <thead>
          <tr>
            <th>日期</th>
            <th>病害数量</th>
            <th>相对上一日</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(point, index) in ordered" :key="point.day">
            <td class="font-mono text-xs">{{ point.day }}</td>
            <td class="font-mono" data-testid="disease-trend-count">{{ formatCount(point.diseaseCount) }}</td>
            <td data-testid="disease-trend-step">{{ dayStep(index) }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>
