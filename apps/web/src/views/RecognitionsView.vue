<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { INGEST_HTTP_PATH, MQTT_RECOGNITION_TOPIC } from '@mushroom/contracts';
import { errorText, http } from '../api';

interface Row {
  id: string;
  shedCode: string;
  cameraCode: string;
  recognizedAt: string;
  mushroomCount: number;
  matureCount: number;
  diseaseCount: number;
  source: string;
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
  <section class="panel overflow-x-auto">
    <h2 class="text-lg">识别记录</h2>
    <p class="mb-3 text-sm text-mist">HTTP {{ INGEST_HTTP_PATH }} · MQTT {{ MQTT_RECOGNITION_TOPIC }}</p>
    <p v-if="loading" class="text-mist">加载中…</p>
    <p v-else-if="error" class="text-red-300">{{ error }}</p>
    <p v-else-if="!rows.length" class="text-mist">暂无记录。</p>
    <table v-else class="data-table">
      <thead>
        <tr><th>时间</th><th>棚区</th><th>摄像头</th><th>总数</th><th>成熟</th><th>病害</th><th>来源</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td class="font-mono text-xs">{{ new Date(row.recognizedAt).toLocaleString('zh-CN') }}</td>
          <td>{{ row.shedCode }}</td>
          <td class="font-mono">{{ row.cameraCode }}</td>
          <td>{{ row.mushroomCount }}</td>
          <td>{{ row.matureCount }}</td>
          <td>{{ row.diseaseCount }}</td>
          <td>{{ row.source }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
