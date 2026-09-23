<script setup lang="ts">
import { onMounted, ref } from 'vue';
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

const rows = ref<Row[]>([]);
const loading = ref(true);
const error = ref('');

onMounted(async () => {
  try {
    const response = await http.get<{ items: Row[] }>('/diseases?pageSize=50');
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
    <h2 class="text-lg text-ink">病害记录</h2>
    <p class="mb-3 text-sm text-mist">只列出病害数量大于 0 的识别。抓拍从已入库对象或原图地址打开。</p>
    <p v-if="loading" class="text-mist">加载中…</p>
    <p v-else-if="error" class="text-danger">{{ error }}</p>
    <p v-else-if="!rows.length" class="text-mist">暂无病害记录。</p>
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
        <p>病害 {{ row.diseaseCount }} · 等级 {{ row.diseaseLevel }}</p>
      </ResultCard>
    </div>
  </section>
</template>
