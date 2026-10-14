<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { errorText, http } from '../api';

interface Reading {
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
const row = ref<Reading | null>(null);
const loading = ref(true);
const error = ref('');

const readingId = computed(() => {
  const value = route.params.id;
  return typeof value === 'string' ? value : '';
});

function reading(value: number | null, unit: string) {
  return value === null || value === undefined ? '—' : `${value}${unit}`;
}

watch(
  readingId,
  async (id) => {
    row.value = null;
    error.value = '';
    if (!id) {
      error.value = '缺少读数编号';
      loading.value = false;
      return;
    }
    loading.value = true;
    try {
      const response = await http.get<Reading>(`/ingest/environment-readings/${id}`);
      row.value = response.data;
    } catch (cause) {
      error.value = errorText(cause);
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);
</script>

<template>
  <section class="ops-page panel bg-white">
    <p class="mb-3 text-sm">
      <router-link class="text-accent" to="/environment" data-testid="env-back">返回环境读数</router-link>
    </p>
    <h2 class="text-lg">环境读数详情</h2>
    <p v-if="loading" class="text-mist">加载中…</p>
    <p v-else-if="error" class="text-sm text-danger" data-testid="env-detail-error">{{ error }}</p>
    <dl v-else-if="row" class="mt-3 space-y-2 text-sm" data-testid="env-detail">
      <div><span class="text-mist">棚区</span> <span data-field="shed">{{ row.shedCode }}</span></div>
      <div>
        <span class="text-mist">传感器</span>
        <span class="font-mono" data-field="sensor">{{ row.sensorCode }}</span>
      </div>
      <div>
        <span class="text-mist">观测时间</span>
        <span class="font-mono" data-field="time">{{ new Date(row.observedAt).toLocaleString('zh-CN') }}</span>
      </div>
      <div>
        <span class="text-mist">温度</span>
        <span class="font-mono text-accent" data-field="temperature">{{ reading(row.temperature, '℃') }}</span>
      </div>
      <div>
        <span class="text-mist">湿度</span>
        <span class="font-mono text-accent" data-field="humidity">{{ reading(row.humidity, '%') }}</span>
      </div>
      <div>
        <span class="text-mist">CO₂</span>
        <span class="font-mono text-accent" data-field="co2">{{ reading(row.co2, '') }}</span>
      </div>
      <div>
        <span class="text-mist">基质含水率</span>
        <span class="font-mono text-accent" data-field="moisture">{{ reading(row.substrateMoisture, '%') }}</span>
      </div>
      <div><span class="text-mist">来源</span> <span data-field="source">{{ row.source }}</span></div>
    </dl>
  </section>
</template>
