<script setup lang="ts">
import * as echarts from 'echarts';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { errorText, http } from '../api';
import ResultCard from '../components/ResultCard.vue';
import { DISEASE_LEVEL_OPTIONS, diseaseLevelText, shanghaiStamp } from '../disease-level';

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

const route = useRoute();
const row = ref<Row | null>(null);
const loading = ref(true);
const error = ref('');
const sensorCode = ref('');
const sensorOptions = ref<string[]>([]);
const env = ref<EnvironmentContext | null>(null);
const envLoading = ref(false);
const envError = ref('');
const chartEl = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;

const diseaseId = computed(() => {
  const value = route.params.id;
  return typeof value === 'string' ? value : '';
});

const hasSnapshot = computed(() => Boolean(row.value?.snapshotObjectKey || row.value?.snapshotUrl));

function plainQuery(key: string) {
  const value = route.query[key];
  return typeof value === 'string' ? value.trim() : '';
}

function instantQuery(key: string) {
  const value = plainQuery(key);
  if (!value || Number.isNaN(new Date(value).getTime())) return '';
  return new Date(value).toISOString();
}

const listReturn = computed(() => {
  const query: Record<string, string> = {};
  const shed = plainQuery('shedCode');
  const camera = plainQuery('cameraCode');
  const from = instantQuery('from');
  const to = instantQuery('to');
  const level = plainQuery('diseaseLevel');
  if (shed) query.shedCode = shed;
  if (camera) query.cameraCode = camera;
  if (from) query.from = from;
  if (to) query.to = to;
  if (DISEASE_LEVEL_OPTIONS.some((item) => item.value === level)) query.diseaseLevel = level;
  if (!Object.keys(query).length) return '/diseases';
  return { path: '/diseases', query };
});

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
  if (!diseaseId.value || !row.value) return;
  envLoading.value = true;
  envError.value = '';
  try {
    const params: Record<string, string> = {};
    if (sensorCode.value) params.sensorCode = sensorCode.value;
    const response = await http.get<EnvironmentContext>(
      `/diseases/${diseaseId.value}/environment`,
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

async function load() {
  row.value = null;
  env.value = null;
  error.value = '';
  sensorCode.value = '';
  sensorOptions.value = [];
  if (!diseaseId.value) {
    error.value = '缺少病害记录';
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const response = await http.get<Row>(`/diseases/${diseaseId.value}`);
    row.value = response.data;
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
  if (row.value) await loadEnvironment();
}

watch(env, async () => {
  await nextTick();
  renderChart();
});

watch(diseaseId, () => {
  void load();
}, { immediate: true });

onBeforeUnmount(releaseChart);
</script>

<template>
  <section class="ops-page space-y-4">
    <p class="text-sm">
      <router-link class="text-accent" :to="listReturn" data-testid="disease-back">返回病害记录</router-link>
    </p>
    <h2 class="text-lg text-ink">病害详情</h2>
    <p v-if="loading" class="text-mist">加载中…</p>
    <p v-else-if="error" class="text-danger" data-testid="disease-detail-error">{{ error }}</p>
    <template v-else-if="row">
      <dl class="panel space-y-2 text-sm" data-testid="disease-detail">
        <div>
          <span class="text-mist">时间</span>
          <span class="ml-2 font-mono" data-field="time">{{ shanghaiStamp(row.recognizedAt) }}</span>
        </div>
        <div>
          <span class="text-mist">棚区</span>
          <span class="ml-2 font-mono" data-field="shed">{{ row.shedCode }}</span>
        </div>
        <div>
          <span class="text-mist">位置</span>
          <span class="ml-2 font-mono" data-field="location">{{ row.cameraCode }}</span>
        </div>
        <div>
          <span class="text-mist">病害等级</span>
          <span class="ml-2" data-field="level">{{ diseaseLevelText(row.diseaseLevel) }}</span>
        </div>
        <div>
          <span class="text-mist">病害数量</span>
          <span class="ml-2" data-field="count">{{ row.diseaseCount }}</span>
        </div>
      </dl>
      <section data-testid="disease-image">
        <h3 class="mb-2 text-lg">病害图片</h3>
        <ResultCard
          v-if="hasSnapshot"
          :id="row.id"
          :snapshot-object-key="row.snapshotObjectKey"
          :snapshot-url="row.snapshotUrl"
          empty-label="无病害图片"
        >
          <p class="text-sm text-mist">{{ row.cameraCode }}</p>
        </ResultCard>
        <p v-else class="text-mist" data-testid="disease-image-empty">无病害图片</p>
      </section>
      <section class="panel space-y-3" data-testid="env-panel">
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
                  <td class="font-mono text-xs">{{ shanghaiStamp(reading.observedAt) }}</td>
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
    </template>
  </section>
</template>
