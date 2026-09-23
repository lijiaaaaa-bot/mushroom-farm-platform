<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { DEVICE_TYPE_LABEL, type DeviceType } from '@mushroom/contracts';
import { errorText, http } from '../api';

interface DeviceRow {
  id: string;
  code: string;
  name: string;
  type: DeviceType;
  shedCode: string;
  onlineStatus: string;
  lastSeenAt: string | null;
}

const rows = ref<DeviceRow[]>([]);
const loading = ref(true);
const error = ref('');

onMounted(async () => {
  try {
    const response = await http.get<{ items: DeviceRow[] }>('/devices?pageSize=100');
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
    <h2 class="mb-3 text-lg">摄像头 / AI 盒 / 传感器</h2>
    <p v-if="loading" class="text-mist">加载中…</p>
    <p v-else-if="error" class="text-red-300">{{ error }}</p>
    <p v-else-if="!rows.length" class="text-mist">暂无设备。识别上报会自动建档。</p>
    <table v-else class="data-table">
      <thead>
        <tr><th>编号</th><th>名称</th><th>类型</th><th>棚区</th><th>状态</th><th>最后心跳</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td class="font-mono">{{ row.code }}</td>
          <td>{{ row.name }}</td>
          <td>{{ DEVICE_TYPE_LABEL[row.type] }}</td>
          <td>{{ row.shedCode }}</td>
          <td :class="row.onlineStatus === 'online' ? 'text-accent' : 'text-mist'">{{ row.onlineStatus === 'online' ? '在线' : '离线' }}</td>
          <td class="font-mono text-xs">{{ row.lastSeenAt ? new Date(row.lastSeenAt).toLocaleString('zh-CN') : '—' }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
