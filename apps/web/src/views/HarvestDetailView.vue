<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { errorText, http } from '../api';
import { shanghaiStamp } from '../disease-level';

interface Row {
  id: string;
  shedCode: string;
  cameraCode: string;
  recognizedAt: string;
  matureCount: number;
  mushroomCount: number;
  avgCapDiameter: number | null;
}

const route = useRoute();
const row = ref<Row | null>(null);
const loading = ref(true);
const error = ref('');

const harvestId = computed(() => {
  const value = route.params.id;
  return typeof value === 'string' ? value : '';
});

function plainQuery(key: string) {
  const value = route.query[key];
  return typeof value === 'string' ? value.trim() : '';
}

const listReturn = computed(() => {
  const query: Record<string, string> = {};
  const date = plainQuery('date');
  const camera = plainQuery('cameraCode');
  const shed = plainQuery('shedCode');
  const from = plainQuery('from');
  const to = plainQuery('to');
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) query.date = date;
  if (camera) query.cameraCode = camera;
  if (shed) query.shedCode = shed;
  if (from) query.from = from;
  if (to) query.to = to;
  if (!Object.keys(query).length) return '/harvest';
  return { path: '/harvest', query };
});

function diameterText(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return String(value);
}

async function load() {
  row.value = null;
  error.value = '';
  if (!harvestId.value) {
    error.value = '缺少采摘记录';
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const response = await http.get<Row>(`/harvest/daily/${harvestId.value}`);
    row.value = response.data;
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
}

watch(harvestId, () => {
  void load();
}, { immediate: true });
</script>

<template>
  <section class="ops-page space-y-4">
    <p class="text-sm">
      <router-link class="text-accent" :to="listReturn" data-testid="harvest-back">返回采摘清单</router-link>
    </p>
    <h2 class="text-lg text-ink">采摘详情</h2>
    <p v-if="loading" class="text-mist">加载中…</p>
    <p v-else-if="error" class="text-danger" data-testid="harvest-detail-error">{{ error }}</p>
    <dl v-else-if="row" class="panel space-y-2 text-sm" data-testid="harvest-detail">
      <div>
        <span class="text-mist">时间</span>
        <span class="ml-2 font-mono" data-field="time">{{ shanghaiStamp(row.recognizedAt) }}</span>
      </div>
      <div>
        <span class="text-mist">棚区</span>
        <span class="ml-2 font-mono" data-field="shed">{{ row.shedCode }}</span>
      </div>
      <div>
        <span class="text-mist">摄像头</span>
        <span class="ml-2 font-mono" data-field="camera">{{ row.cameraCode }}</span>
      </div>
      <div>
        <span class="text-mist">成熟数</span>
        <span class="ml-2" data-field="mature">{{ row.matureCount }}</span>
      </div>
      <div>
        <span class="text-mist">蘑菇数</span>
        <span class="ml-2" data-field="mushroom">{{ row.mushroomCount }}</span>
      </div>
      <div>
        <span class="text-mist">菌盖直径</span>
        <span class="ml-2" data-field="diameter">{{ diameterText(row.avgCapDiameter) }}</span>
      </div>
    </dl>
  </section>
</template>
