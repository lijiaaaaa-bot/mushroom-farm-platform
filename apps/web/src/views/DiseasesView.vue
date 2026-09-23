<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { errorText, http } from '../api';
import SnapshotCell from '../components/SnapshotCell.vue';

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
  <section class="panel overflow-x-auto bg-white">
    <h2 class="text-lg">病害记录</h2>
    <p class="mb-3 text-sm text-mist">只列出病害数量大于 0 的识别。抓拍从已入库对象或原图地址打开。</p>
    <p v-if="loading" class="text-mist">加载中…</p>
    <p v-else-if="error" class="text-danger">{{ error }}</p>
    <p v-else-if="!rows.length" class="text-mist">暂无病害记录。</p>
    <table v-else class="data-table">
      <thead>
        <tr>
          <th>时间</th>
          <th>棚区</th>
          <th>摄像头</th>
          <th>等级</th>
          <th>数量</th>
          <th>抓拍</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td class="font-mono text-xs">{{ new Date(row.recognizedAt).toLocaleString('zh-CN') }}</td>
          <td>{{ row.shedCode }}</td>
          <td class="font-mono">{{ row.cameraCode }}</td>
          <td>{{ row.diseaseLevel }}</td>
          <td>{{ row.diseaseCount }}</td>
          <td>
            <SnapshotCell
              :id="row.id"
              :snapshot-object-key="row.snapshotObjectKey"
              :snapshot-url="row.snapshotUrl"
            />
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
