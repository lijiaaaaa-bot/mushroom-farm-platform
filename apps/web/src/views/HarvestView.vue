<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { errorText, http } from '../api';

interface Item {
  id: string;
  shedCode: string;
  cameraCode: string;
  matureCount: number;
  mushroomCount: number;
  recognizedAt: string;
}
interface Daily {
  date: string;
  summary: { matureCount: number; mushroomCount: number; harvestableCameras: number };
  items: Item[];
}

const date = ref(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()));
const data = ref<Daily | null>(null);
const error = ref('');
const loading = ref(false);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const response = await http.get<Daily>('/harvest/daily', { params: { date: date.value } });
    data.value = response.data;
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section class="space-y-4">
    <form class="flex flex-wrap items-end gap-3" @submit.prevent="load">
      <label class="text-sm">日期
        <input v-model="date" class="field mt-1" type="date" />
      </label>
      <button class="btn-primary" type="submit">查询</button>
    </form>
    <p v-if="loading" class="text-mist">加载中…</p>
    <p v-else-if="error" class="text-red-300">{{ error }}</p>
    <template v-else-if="data">
      <div class="grid gap-3 sm:grid-cols-3">
        <article class="panel"><p class="text-mist">可采摄像头</p><p class="font-mono text-3xl">{{ data.summary.harvestableCameras }}</p></article>
        <article class="panel"><p class="text-mist">成熟数量</p><p class="font-mono text-3xl text-amber">{{ data.summary.matureCount }}</p></article>
        <article class="panel"><p class="text-mist">蘑菇数量</p><p class="font-mono text-3xl">{{ data.summary.mushroomCount }}</p></article>
      </div>
      <div class="panel overflow-x-auto">
        <p v-if="!data.items.length" class="text-mist">当日无识别记录。</p>
        <table v-else class="data-table">
          <thead><tr><th>棚区</th><th>摄像头</th><th>成熟</th><th>总数</th><th>最近识别</th></tr></thead>
          <tbody>
            <tr v-for="item in data.items" :key="item.id">
              <td>{{ item.shedCode }}</td>
              <td class="font-mono">{{ item.cameraCode }}</td>
              <td>{{ item.matureCount }}</td>
              <td>{{ item.mushroomCount }}</td>
              <td class="font-mono text-xs">{{ new Date(item.recognizedAt).toLocaleString('zh-CN') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>
