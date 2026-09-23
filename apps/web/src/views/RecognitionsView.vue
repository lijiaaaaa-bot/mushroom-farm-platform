<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { INGEST_HTTP_PATH, MQTT_RECOGNITION_TOPIC } from '@mushroom/contracts';
import { errorText, http } from '../api';
import ResultCard from '../components/ResultCard.vue';

interface Row {
  id: string;
  shedCode: string;
  cameraCode: string;
  recognizedAt: string;
  mushroomCount: number;
  matureCount: number;
  diseaseCount: number;
  source: string;
  snapshotObjectKey: string | null;
  snapshotUrl: string | null;
}

const route = useRoute();
const rows = ref<Row[]>([]);
const loading = ref(true);
const error = ref('');
const filterError = ref('');

function queryValue(key: string) {
  const value = route.query[key];
  return typeof value === 'string' ? value : '';
}

const bounds = computed(() => ({
  from: queryValue('from'),
  to: queryValue('to'),
  shedCode: queryValue('shedCode'),
  cameraCode: queryValue('cameraCode'),
}));

const filterLabel = computed(() =>
  [bounds.value.from, bounds.value.to, bounds.value.shedCode, bounds.value.cameraCode].filter(Boolean).join(' · '),
);

function invalidBound(value: string) {
  return value !== '' && Number.isNaN(new Date(value).getTime());
}

async function load() {
  loading.value = true;
  error.value = '';
  filterError.value = '';
  const filter = bounds.value;
  if (invalidBound(filter.from) || invalidBound(filter.to)) {
    rows.value = [];
    filterError.value = '时间筛选无效';
    loading.value = false;
    return;
  }
  const params: Record<string, string> = { pageSize: '50' };
  if (filter.from) params.from = new Date(filter.from).toISOString();
  if (filter.to) params.to = new Date(filter.to).toISOString();
  if (filter.shedCode) params.shedCode = filter.shedCode;
  if (filter.cameraCode) params.cameraCode = filter.cameraCode;
  try {
    const response = await http.get<{ items: Row[] }>('/ingest/recognitions', { params });
    rows.value = response.data.items;
  } catch (cause) {
    error.value = errorText(cause);
    rows.value = [];
  } finally {
    loading.value = false;
  }
}

watch(
  () => [route.query.from, route.query.to, route.query.shedCode, route.query.cameraCode],
  () => {
    void load();
  },
  { immediate: true },
);
</script>

<template>
  <section class="ops-page">
    <h2 class="text-lg text-ink">识别记录</h2>
    <p class="mb-3 text-sm text-mist">HTTP {{ INGEST_HTTP_PATH }} · MQTT {{ MQTT_RECOGNITION_TOPIC }}</p>
    <p v-if="filterLabel" class="mb-3 text-sm text-mist">筛选 {{ filterLabel }}</p>
    <p v-if="loading" class="text-mist">加载中…</p>
    <p v-else-if="filterError" class="text-danger">{{ filterError }}</p>
    <p v-else-if="error" class="text-danger">{{ error }}</p>
    <p v-else-if="!rows.length" class="text-mist">{{ filterLabel ? '该时段没有识别记录。' : '暂无记录。' }}</p>
    <div v-else class="result-grid">
      <ResultCard
        v-for="row in rows"
        :key="row.id"
        :id="row.id"
        :snapshot-object-key="row.snapshotObjectKey"
        :snapshot-url="row.snapshotUrl"
      >
        <p class="font-mono text-xs text-mist">{{ new Date(row.recognizedAt).toLocaleString('zh-CN') }}</p>
        <p>{{ row.shedCode }} · {{ row.cameraCode }}</p>
        <p>成熟 {{ row.matureCount }} · 总数 {{ row.mushroomCount }} · 病害 {{ row.diseaseCount }}</p>
        <p class="text-mist">{{ row.source }}</p>
      </ResultCard>
    </div>
  </section>
</template>
