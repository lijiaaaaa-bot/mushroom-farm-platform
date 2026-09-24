<script setup lang="ts">
import * as echarts from 'echarts';
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { errorText, http } from '../api';
import ResultCard from '../components/ResultCard.vue';

interface Row {
  id: string;
  shedCode: string;
  cameraCode: string;
  recognizedAt: string;
  diseaseLevel: number;
  diseaseCount: number;
  snapshotObjectKey: string | null;
  snapshotUrl: string | null;
}

interface Reading {
  id: string;
  shedCode: string;
  sensorCode: string;
  observedAt: string;
  temperature: number | null;
  humidity: number | null;
  co2: number | null;
  substrateMoisture: number | null;
}

interface EnvironmentContext {
  recognition: {
    id: string;
    shedCode: string;
    cameraCode: string;
    recognizedAt: string;
    diseaseLevel: number;
    diseaseCount: number;
  };
  window: {
    start: string;
    end: string;
    beforeMinutes: number;
    afterMinutes: number;
  };
  alignment: { shedCode: string; sensorCode: string | null };
  readings: Reading[];
  empty: boolean;
  emptyReason: string | null;
}

const rows = ref<Row[]>([]);
const loading = ref(true);
const error = ref('');
const selectedId = ref('');
const sensorCode = ref('');
const sensorOptions = ref<string[]>([]);
const env = ref<EnvironmentContext | null>(null);
const envLoading = ref(false);
const envError = ref('');
const peaks = ref<{
  grain: string;
  byTime: Array<{ bucketStart: string; diseaseCount: number }>;
  byShed: Array<{ shedCode: string; diseaseCount: number }>;
  peak: { bucketStart: string; diseaseCount: number } | null;
} | null>(null);
const chartEl = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;

function metric(value: number | null): string {
  return value === null || value === undefined ? '—' : String(value);
}

function canvasReady(): boolean {
  if (/jsdom/i.test(navigator.userAgent)) return false;
  try {
    return document.createElement('canvas').getContext('2d') !== null;
  } catch {
    return false;
  }
}

function releaseChart() {
  const current = chart;
  chart = null;
  if (!current) return;
  try {
    current.dispose();
  } catch {
    /* jsdom has no canvas */
  }
}

function renderChart() {
  if (!chartEl.value || !env.value || env.value.empty || !canvasReady()) {
    releaseChart();
    return;
  }
  try {
    chart ??= echarts.init(chartEl.value);
    const readings = env.value.readings;
    chart.setOption(
      {
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis' },
        legend: { textStyle: { color: '#1e293b' } },
        xAxis: {
          type: 'category',
          data: readings.map((item) =>
            new Date(item.observedAt).toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit',
            }),
          ),
          axisLabel: { color: '#64748b' },
        },
        yAxis: [
          {
            type: 'value',
            name: '温度/湿度/基质',
            axisLabel: { color: '#64748b' },
            splitLine: { lineStyle: { color: '#e2e8f0' } },
          },
          { type: 'value', name: 'CO₂', axisLabel: { color: '#64748b' } },
        ],
        series: [
          {
            name: '温度',
            type: 'line',
            data: readings.map((item) => item.temperature),
            itemStyle: { color: '#c44536' },
          },
          {
            name: '湿度',
            type: 'line',
            data: readings.map((item) => item.humidity),
            itemStyle: { color: '#1B7A4E' },
          },
          {
            name: '基质含水率',
            type: 'line',
            data: readings.map((item) => item.substrateMoisture),
            itemStyle: { color: '#d97706' },
          },
          {
            name: 'CO₂',
            type: 'line',
            yAxisIndex: 1,
            data: readings.map((item) => item.co2),
            itemStyle: { color: '#334155' },
          },
        ],
      },
      true,
    );
  } catch {
    releaseChart();
  }
}

async function loadEnvironment() {
  if (!selectedId.value) return;
  envLoading.value = true;
  envError.value = '';
  try {
    const params: Record<string, string> = {};
    if (sensorCode.value) params.sensorCode = sensorCode.value;
    const response = await http.get<EnvironmentContext>(
      `/diseases/${selectedId.value}/environment`,
      { params },
    );
    env.value = response.data;
    if (!sensorCode.value) {
      sensorOptions.value = [
        ...new Set(response.data.readings.map((item) => item.sensorCode)),
      ];
    }
  } catch (cause) {
    env.value = null;
    envError.value = errorText(cause);
  } finally {
    envLoading.value = false;
  }
}

async function select(row: Row) {
  selectedId.value = row.id;
  sensorCode.value = '';
  sensorOptions.value = [];
  await loadEnvironment();
}

watch(env, async () => {
  await nextTick();
  renderChart();
});

onMounted(async () => {
  try {
    const [archive, peakResponse] = await Promise.all([
      http.get<{ items: Row[] }>('/diseases?pageSize=50'),
      http.get<NonNullable<typeof peaks.value>>('/diseases/peaks').catch(() => null),
    ]);
    rows.value = archive.data.items;
    if (peakResponse && Array.isArray(peakResponse.data.byTime)) {
      peaks.value = peakResponse.data;
    }
    if (rows.value[0]) await select(rows.value[0]);
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(releaseChart);
</script>

<template>
  <section class="ops-page space-y-4">
    <section
      v-if="peaks && (peaks.byTime.length || peaks.byShed.length)"
      class="panel space-y-2"
      data-testid="disease-peaks"
    >
      <h2 class="text-lg text-ink">高发统计</h2>
      <p class="text-sm text-mist">读小时桶或日桶里的病害数。档案仍是下面的识别记录。</p>
      <p v-if="peaks.peak" class="font-mono text-sm">
        峰值 {{ new Date(peaks.peak.bucketStart).toLocaleString('zh-CN') }} · {{ peaks.peak.diseaseCount }}
      </p>
      <ul class="text-sm">
        <li v-for="row in peaks.byShed" :key="row.shedCode" class="font-mono">
          {{ row.shedCode }} · {{ row.diseaseCount }}
        </li>
      </ul>
    </section>
    <div>
      <h2 class="text-lg text-ink">病害记录</h2>
      <p class="mb-3 text-sm text-mist">只列出病害数量大于 0 的识别。选中一条后，同屏对照该棚在识别时间窗内的环境读数。抓拍从已入库对象或原图地址打开。</p>
      <p v-if="loading" class="text-mist">加载中…</p>
      <p v-else-if="error" class="text-danger">{{ error }}</p>
      <p v-else-if="!rows.length" class="text-mist">暂无病害记录。</p>
      <div v-else class="result-grid">
        <div
          v-for="row in rows"
          :key="row.id"
          class="cursor-pointer"
          :aria-selected="selectedId === row.id"
          @click="select(row)"
        >
          <ResultCard
            :id="row.id"
            :snapshot-object-key="row.snapshotObjectKey"
            :snapshot-url="row.snapshotUrl"
          >
            <p class="font-mono text-xs text-mist">{{ new Date(row.recognizedAt).toLocaleString('zh-CN') }}</p>
            <p>{{ row.shedCode }} · {{ row.cameraCode }}</p>
            <p>病害 {{ row.diseaseCount }} · 等级 {{ row.diseaseLevel }}</p>
          </ResultCard>
        </div>
      </div>
    </div>

    <section v-if="selectedId" class="panel space-y-3" data-testid="env-panel">
      <h3 class="text-lg">同期环境</h3>
      <p v-if="envLoading" class="text-mist">加载中…</p>
      <p v-else-if="envError" class="text-danger">{{ envError }}</p>
      <template v-else-if="env">
        <p class="text-sm text-mist" data-testid="env-window">
          棚 {{ env.alignment.shedCode }}
          · 摄像头 {{ env.recognition.cameraCode }}
          · 病害 {{ env.recognition.diseaseCount }} / 等级 {{ env.recognition.diseaseLevel }}
          · 识别前后 {{ env.window.beforeMinutes }}/{{ env.window.afterMinutes }} 分钟
          · 传感器 {{ env.alignment.sensorCode ?? '全部' }}
        </p>
        <label v-if="sensorOptions.length" class="block text-sm">
          传感器
          <select v-model="sensorCode" class="field mt-1" aria-label="传感器" @change="loadEnvironment">
            <option value="">全部</option>
            <option v-for="code in sensorOptions" :key="code" :value="code">{{ code }}</option>
          </select>
        </label>
        <p v-if="env.empty" class="text-mist" data-testid="env-empty">{{ env.emptyReason }}</p>
        <template v-else>
          <div ref="chartEl" class="h-64 w-full" data-testid="env-chart"></div>
          <table class="data-table" data-testid="env-readings">
            <thead>
              <tr>
                <th>观测时间</th>
                <th>传感器</th>
                <th>温度</th>
                <th>湿度</th>
                <th>CO₂</th>
                <th>基质含水率</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="reading in env.readings" :key="reading.id">
                <td class="font-mono text-xs">{{ new Date(reading.observedAt).toLocaleString('zh-CN') }}</td>
                <td class="font-mono">{{ reading.sensorCode }}</td>
                <td>{{ metric(reading.temperature) }}</td>
                <td>{{ metric(reading.humidity) }}</td>
                <td>{{ metric(reading.co2) }}</td>
                <td>{{ metric(reading.substrateMoisture) }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </template>
    </section>
  </section>
</template>
