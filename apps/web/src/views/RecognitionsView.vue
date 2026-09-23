<script setup lang="ts">
import { onMounted, ref } from 'vue';
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

const rows = ref<Row[]>([]);
const loading = ref(true);
const error = ref('');

onMounted(async () => {
  try {
    const response = await http.get<{ items: Row[] }>('/ingest/recognitions?pageSize=50');
    rows.value = response.data.items;
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <section class="ops-page">
    <h2 class="text-lg text-ink">识别记录</h2>
    <p class="mb-3 text-sm text-mist">HTTP {{ INGEST_HTTP_PATH }} · MQTT {{ MQTT_RECOGNITION_TOPIC }}</p>
    <p v-if="loading" class="text-mist">加载中…</p>
    <p v-else-if="error" class="text-danger">{{ error }}</p>
    <p v-else-if="!rows.length" class="text-mist">暂无记录。</p>
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
