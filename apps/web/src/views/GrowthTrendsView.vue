<script setup lang="ts">
import * as echarts from 'echarts';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { errorText, http } from '../api';

type WindowDays = 7 | 30;
type Mode = 'shed' | 'camera';

interface Point {
  day: string;
  mushroomCount: number;
  capDiameterMean: number | null;
  sampleCount: number;
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
  days: WindowDays;
  from: string;
  to: string;
  sheds: ShedSeries[];
}

interface ShedOption {
  code: string;
  name: string;
}

interface Line {
  name: string;
  points: Point[];
}

const loading = ref(true);
const error = ref('');
const sheds = ref<ShedOption[]>([]);
const shedCode = ref('');
const days = ref<WindowDays>(7);
const mode = ref<Mode>('shed');
const data = ref<TrendResponse | null>(null);
const countEl = ref<HTMLDivElement | null>(null);
const diameterEl = ref<HTMLDivElement | null>(null);
let countChart: echarts.ECharts | null = null;
let diameterChart: echarts.ECharts | null = null;

const current = computed(() => {
  if (!data.value) return null;
  return (
    data.value.sheds.find((item) => item.shedCode === shedCode.value) ??
    data.value.sheds[0] ??
    null
  );
});

const lines = computed<Line[]>(() => {
  const shed = current.value;
  if (!shed) return [];
  if (mode.value === 'shed') {
    return shed.points.length ? [{ name: shed.shedCode, points: shed.points }] : [];
  }
  return shed.cameras
    .filter((camera) => camera.points.length)
    .map((camera) => ({ name: camera.cameraCode, points: camera.points }));
});

const hasPoints = computed(() => lines.value.some((line) => line.points.length > 0));

const diameterLines = computed(() =>
  lines.value
    .map((line) => ({
      name: line.name,
      points: line.points.filter((point) => point.capDiameterMean !== null),
    }))
    .filter((line) => line.points.length > 0),
);

const tableRows = computed(() =>
  lines.value.flatMap((line) =>
    line.points.map((point) => ({
      key: `${line.name}-${point.day}`,
      name: line.name,
      ...point,
    })),
  ),
);

function chartOption(series: Line[], pick: (point: Point) => number | null) {
  const axisDays = [...new Set(series.flatMap((line) => line.points.map((point) => point.day)))].sort();
  const palette = ['#2F9E44', '#1B7A4E', '#d97706', '#3b82f6', '#c44536'];
  return {
    backgroundColor: 'transparent',
    textStyle: { color: '#64748b' },
    tooltip: { trigger: 'axis' },
    legend: { textStyle: { color: '#1e293b' } },
    xAxis: {
      type: 'category',
      data: axisDays.map((day) => day.slice(5)),
      axisLabel: { color: '#64748b' },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#64748b' },
      splitLine: { lineStyle: { color: '#e2e8f0' } },
    },
    series: series.map((line, index) => ({
      name: line.name,
      type: 'line',
      connectNulls: false,
      itemStyle: { color: palette[index % palette.length] },
      data: axisDays.map((day) => {
        const point = line.points.find((item) => item.day === day);
        return point ? pick(point) : null;
      }),
    })),
  };
}

function render() {
  if (!hasPoints.value || !countEl.value) {
    countChart?.dispose();
    countChart = null;
  } else {
    countChart ??= echarts.init(countEl.value);
    countChart.setOption(
      chartOption(lines.value, (point) => point.mushroomCount),
      true,
    );
  }
  if (!diameterLines.value.length || !diameterEl.value) {
    diameterChart?.dispose();
    diameterChart = null;
  } else {
    diameterChart ??= echarts.init(diameterEl.value);
    diameterChart.setOption(
      chartOption(diameterLines.value, (point) => point.capDiameterMean),
      true,
    );
  }
}

async function loadTrends() {
  if (!shedCode.value) {
    data.value = null;
    return;
  }
  const response = await http.get<TrendResponse>('/growth-trends', {
    params: { days: days.value, shedCode: shedCode.value },
  });
  data.value = response.data;
}

async function reload() {
  loading.value = true;
  error.value = '';
  try {
    const response = await http.get<ShedOption[]>('/sheds');
    sheds.value = response.data;
    if (!sheds.value.some((shed) => shed.code === shedCode.value)) {
      shedCode.value = sheds.value[0]?.code ?? '';
    }
    await loadTrends();
  } catch (cause) {
    error.value = errorText(cause);
    data.value = null;
  } finally {
    loading.value = false;
  }
}

async function setDays(next: WindowDays) {
  if (days.value === next) return;
  days.value = next;
  loading.value = true;
  error.value = '';
  try {
    await loadTrends();
  } catch (cause) {
    error.value = errorText(cause);
    data.value = null;
  } finally {
    loading.value = false;
  }
}

async function onShedChange() {
  loading.value = true;
  error.value = '';
  try {
    await loadTrends();
  } catch (cause) {
    error.value = errorText(cause);
    data.value = null;
  } finally {
    loading.value = false;
  }
}

function diameterText(value: number | null) {
  return value === null ? '—' : String(value);
}

onMounted(() => {
  void reload();
});

watch([data, mode, lines], async () => {
  await nextTick();
  render();
});

onBeforeUnmount(() => {
  countChart?.dispose();
  diameterChart?.dispose();
});
</script>

<template>
  <section class="space-y-4">
    <div class="panel flex flex-wrap items-end gap-3 bg-white">
      <label class="text-sm text-mist">
        棚区
        <select v-model="shedCode" class="field mt-1" @change="onShedChange">
          <option v-for="shed in sheds" :key="shed.code" :value="shed.code">
            {{ shed.name }}（{{ shed.code }}）
          </option>
        </select>
      </label>
      <div class="flex gap-2">
        <button type="button" data-days="7" :class="days === 7 ? 'btn-primary' : 'btn-ghost'" @click="setDays(7)">
          7 天
        </button>
        <button type="button" data-days="30" :class="days === 30 ? 'btn-primary' : 'btn-ghost'" @click="setDays(30)">
          30 天
        </button>
      </div>
      <div class="flex gap-2">
        <button type="button" data-mode="shed" :class="mode === 'shed' ? 'btn-primary' : 'btn-ghost'" @click="mode = 'shed'">
          棚汇总
        </button>
        <button type="button" data-mode="camera" :class="mode === 'camera' ? 'btn-primary' : 'btn-ghost'" @click="mode = 'camera'">
          分摄像头
        </button>
      </div>
    </div>

    <p v-if="loading" class="text-mist">加载中…</p>
    <p v-else-if="error" class="text-danger">{{ error }}</p>
    <p v-else-if="!sheds.length" class="text-mist">没有可查看的棚区。</p>
    <p v-else-if="data && !hasPoints" class="text-mist">
      {{ data.from }} 至 {{ data.to }} 没有日聚合，未绘制曲线。
    </p>
    <template v-else-if="data && hasPoints">
      <section class="panel bg-white">
        <h2 class="mb-2 text-sm text-mist">蘑菇数量</h2>
        <div ref="countEl" class="h-72 w-full"></div>
      </section>
      <section class="panel bg-white">
        <h2 class="mb-2 text-sm text-mist">菌盖直径均值</h2>
        <div v-if="diameterLines.length" ref="diameterEl" class="h-72 w-full"></div>
        <p v-else class="text-sm text-mist">有数量日聚合，菌盖直径均值为空，未绘制直径曲线。</p>
      </section>
      <section class="panel overflow-x-auto bg-white">
        <table class="data-table">
          <thead>
            <tr>
              <th>日期</th>
              <th>对象</th>
              <th>蘑菇数量</th>
              <th>菌盖直径均值</th>
              <th>样本</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in tableRows" :key="row.key">
              <td class="font-mono">{{ row.day }}</td>
              <td class="font-mono">{{ row.name }}</td>
              <td class="font-mono">{{ row.mushroomCount }}</td>
              <td class="font-mono">{{ diameterText(row.capDiameterMean) }}</td>
              <td class="font-mono">{{ row.sampleCount }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </section>
</template>
