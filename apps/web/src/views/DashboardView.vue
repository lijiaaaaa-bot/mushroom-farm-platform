<script setup lang="ts">
import * as echarts from 'echarts';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { errorText, http } from '../api';

interface Overview {
  shedCount: number;
  deviceTotal: number;
  deviceOnline: number;
  todayMushroom: number;
  todayMature: number;
  openAlerts: number;
  severeAlerts: number;
  trend: { day: string; mature: number; disease: number }[];
}

const loading = ref(true);
const error = ref('');
const data = ref<Overview | null>(null);
const chartEl = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;

function render() {
  if (!chartEl.value || !data.value) return;
  chart ??= echarts.init(chartEl.value);
  chart.setOption({
    backgroundColor: 'transparent',
    textStyle: { color: '#93c4ab' },
    tooltip: { trigger: 'axis' },
    legend: { textStyle: { color: '#e7f6ee' } },
    xAxis: { type: 'category', data: data.value.trend.map((item) => item.day.slice(5)), axisLabel: { color: '#93c4ab' } },
    yAxis: { type: 'value', axisLabel: { color: '#93c4ab' }, splitLine: { lineStyle: { color: '#1f4a38' } } },
    series: [
      { name: '成熟', type: 'bar', data: data.value.trend.map((item) => item.mature), itemStyle: { color: '#f0b429' } },
      { name: '病害', type: 'line', data: data.value.trend.map((item) => item.disease), itemStyle: { color: '#ff6b6b' } },
    ],
  });
}

onMounted(async () => {
  try {
    const response = await http.get<Overview>('/dashboard/overview');
    data.value = response.data;
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
});
watch(data, render);
onBeforeUnmount(() => chart?.dispose());
</script>

<template>
  <p v-if="loading" class="text-mist">加载中…</p>
  <p v-else-if="error" class="text-red-300">{{ error }}</p>
  <div v-else-if="data" class="space-y-4">
    <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <article class="panel"><p class="text-mist">棚区</p><p class="font-mono text-3xl text-accent">{{ data.shedCount }}</p></article>
      <article class="panel"><p class="text-mist">设备在线</p><p class="font-mono text-3xl">{{ data.deviceOnline }}/{{ data.deviceTotal }}</p></article>
      <article class="panel"><p class="text-mist">今日成熟</p><p class="font-mono text-3xl text-amber">{{ data.todayMature }}</p></article>
      <article class="panel"><p class="text-mist">未关闭告警</p><p class="font-mono text-3xl">{{ data.openAlerts }} <span class="text-base text-red-300">严重 {{ data.severeAlerts }}</span></p></article>
    </section>
    <section class="panel">
      <h2 class="mb-2 text-sm text-mist">近 7 日各摄像头最新成熟 / 病害</h2>
      <div ref="chartEl" class="h-72 w-full"></div>
      <p v-if="!data.trend.length" class="text-sm text-mist">还没有识别记录。可用黄金报文走 HTTP 接入。</p>
    </section>
  </div>
</template>
