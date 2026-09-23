<script setup lang="ts">
import * as echarts from 'echarts';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  ALERT_LEVEL_LABEL,
  ALERT_STATUS_LABEL,
  type AlertLevel,
  type AlertStatus,
} from '@mushroom/contracts';
import { errorText, http } from '../api';

interface TrendPoint {
  day: string;
  mushroom: number;
  mature: number;
  disease: number;
}

interface AlertItem {
  id: string;
  shedCode: string;
  cameraCode: string | null;
  level: AlertLevel;
  status: AlertStatus;
  title: string;
  createdAt: string;
}

interface RecordItem {
  id: string;
  shedCode: string;
  cameraCode: string;
  recognizedAt: string;
  mushroomCount: number;
  matureCount: number;
  diseaseCount: number;
}

interface Overview {
  shedCount?: number;
  deviceTotal?: number;
  deviceOnline?: number;
  todayMushroom?: number;
  todayMature?: number;
  harvestableCameras?: number;
  openAlerts?: number;
  severeAlerts?: number;
  env?: {
    avgTemp: number | null;
    avgHumidity: number | null;
    avgCo2: number | null;
    avgSubstrateMoisture: number | null;
  };
  trend?: TrendPoint[];
  recentAlerts?: AlertItem[];
  recentRecords?: RecordItem[];
}

const MATURE_COLOR = '#2F9E44';
const TOTAL_COLOR = '#3B6EA5';
const DISEASE_COLOR = '#E03131';

const loading = ref(true);
const error = ref('');
const data = ref<Overview | null>(null);
const chartEl = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;

const trend = computed(() => data.value?.trend ?? []);
const alerts = computed(() => data.value?.recentAlerts ?? []);
const records = computed(() => data.value?.recentRecords ?? []);

function metric(value: number | null | undefined, suffix = '') {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value}${suffix}`;
}

function clock(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function dayLabel(day: string) {
  return day.length >= 10 ? day.slice(5) : day;
}

function levelClass(level: AlertLevel) {
  if (level === 'severe') return 'level-pill level-pill-critical';
  if (level === 'warning') return 'level-pill level-pill-warn';
  return 'level-pill';
}

function render() {
  if (!chartEl.value || trend.value.length === 0) {
    chart?.dispose();
    chart = null;
    return;
  }
  chart ??= echarts.init(chartEl.value);
  chart.setOption({
    backgroundColor: 'transparent',
    textStyle: { color: '#646A73' },
    tooltip: { trigger: 'axis' },
    legend: { textStyle: { color: '#1F2329' } },
    grid: { left: 40, right: 16, top: 32, bottom: 28 },
    xAxis: {
      type: 'category',
      data: trend.value.map((item) => dayLabel(item.day)),
      axisLabel: { color: '#646A73' },
      axisLine: { lineStyle: { color: '#E5E6EB' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#646A73' },
      splitLine: { lineStyle: { color: '#E5E6EB' } },
    },
    series: [
      {
        name: '成熟',
        type: 'line',
        smooth: true,
        showSymbol: true,
        data: trend.value.map((item) => item.mature),
        itemStyle: { color: MATURE_COLOR },
        lineStyle: { color: MATURE_COLOR, width: 2 },
        areaStyle: { color: 'rgba(47, 158, 68, 0.12)' },
      },
      {
        name: '总数',
        type: 'line',
        smooth: true,
        showSymbol: true,
        data: trend.value.map((item) => item.mushroom),
        itemStyle: { color: TOTAL_COLOR },
        lineStyle: { color: TOTAL_COLOR, width: 2 },
      },
      {
        name: '病害',
        type: 'line',
        smooth: true,
        showSymbol: true,
        data: trend.value.map((item) => item.disease),
        itemStyle: { color: DISEASE_COLOR },
        lineStyle: { color: DISEASE_COLOR, width: 2 },
      },
    ],
  });
}

function onResize() {
  chart?.resize();
}

onMounted(async () => {
  window.addEventListener('resize', onResize);
  try {
    const response = await http.get<Overview>('/dashboard/overview');
    data.value = response.data;
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
});

watch(
  data,
  async () => {
    await nextTick();
    render();
  },
  { flush: 'post' },
);

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
  chart?.dispose();
});
</script>

<template>
  <p v-if="loading" class="text-mist">加载中…</p>
  <p v-else-if="error" class="text-danger">{{ error }}</p>
  <div v-else-if="data" class="ops-page space-y-4">
    <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <article class="panel kpi-tile">
        <p class="text-sm text-mist">棚区</p>
        <p class="font-mono text-3xl text-ink">{{ metric(data.shedCount) }}</p>
      </article>
      <article class="panel kpi-tile">
        <p class="text-sm text-mist">设备在线</p>
        <p class="font-mono text-3xl text-accent">
          {{ metric(data.deviceOnline) }}<span class="text-lg text-mist">/{{ metric(data.deviceTotal) }}</span>
        </p>
      </article>
      <article class="panel kpi-tile">
        <p class="text-sm text-mist">今日成熟</p>
        <p class="font-mono text-3xl text-accent">{{ metric(data.todayMature) }}</p>
      </article>
      <article class="panel kpi-tile">
        <p class="text-sm text-mist">今日菇数</p>
        <p class="font-mono text-3xl text-ink">{{ metric(data.todayMushroom) }}</p>
      </article>
      <article class="panel kpi-tile">
        <p class="text-sm text-mist">可采摄像头</p>
        <p class="font-mono text-3xl text-ink">{{ metric(data.harvestableCameras) }}</p>
      </article>
      <article class="panel kpi-tile">
        <p class="text-sm text-mist">未关闭告警</p>
        <p class="font-mono text-3xl text-ink">
          {{ metric(data.openAlerts) }}
          <span class="text-base text-danger">严重 {{ metric(data.severeAlerts) }}</span>
        </p>
      </article>
      <article class="panel kpi-tile">
        <p class="text-sm text-mist">均温</p>
        <p class="font-mono text-3xl text-ink">{{ metric(data.env?.avgTemp, '℃') }}</p>
      </article>
      <article class="panel kpi-tile">
        <p class="text-sm text-mist">均湿</p>
        <p class="font-mono text-3xl text-ink">{{ metric(data.env?.avgHumidity, '%') }}</p>
      </article>
    </section>
    <section class="grid gap-3 xl:grid-cols-5">
      <article class="panel xl:col-span-3">
        <h2 class="mb-2 text-sm font-medium text-ink">近 7 日成熟 / 病害</h2>
        <div v-if="trend.length" ref="chartEl" class="overview-chart h-72 w-full"></div>
        <p v-else class="overview-chart-empty text-sm text-mist">这一窗没有识别汇总。</p>
      </article>
      <article class="panel xl:col-span-2">
        <h2 class="mb-2 text-sm font-medium text-ink">告警</h2>
        <p v-if="!alerts.length" class="text-sm text-mist">暂无未关闭告警。</p>
        <table v-else class="data-table overview-alarms">
          <thead>
            <tr>
              <th>时间</th>
              <th>来源</th>
              <th>类型</th>
              <th>严重程度</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in alerts" :key="row.id">
              <td class="font-mono text-xs">{{ clock(row.createdAt) }}</td>
              <td>
                {{ row.shedCode }}<span v-if="row.cameraCode"> · {{ row.cameraCode }}</span>
              </td>
              <td>{{ row.title }}</td>
              <td><span :class="levelClass(row.level)">{{ ALERT_LEVEL_LABEL[row.level] }}</span></td>
              <td>{{ ALERT_STATUS_LABEL[row.status] }}</td>
            </tr>
          </tbody>
        </table>
      </article>
    </section>
    <section class="panel">
      <h2 class="mb-2 text-sm font-medium text-ink">最近识别</h2>
      <p v-if="!records.length" class="text-sm text-mist">暂无识别记录。</p>
      <ul v-else class="overview-results divide-y divide-line">
        <li
          v-for="row in records"
          :key="row.id"
          class="overview-result flex flex-wrap gap-x-4 gap-y-1 py-2 text-sm"
        >
          <span class="font-mono text-xs text-mist">{{ clock(row.recognizedAt) }}</span>
          <span class="text-ink">{{ row.shedCode }} · {{ row.cameraCode }}</span>
          <span>成熟 {{ row.matureCount }}</span>
          <span>总数 {{ row.mushroomCount }}</span>
          <span :class="row.diseaseCount > 0 ? 'text-danger' : 'text-mist'">病害 {{ row.diseaseCount }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>
