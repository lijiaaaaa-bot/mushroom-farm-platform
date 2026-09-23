<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { errorText, http } from '../api';

interface Shed {
  id: string;
  code: string;
  name: string;
  location: string | null;
}

const rows = ref<Shed[]>([]);
const error = ref('');
const loading = ref(true);

onMounted(async () => {
  try {
    const response = await http.get<Shed[]>('/sheds');
    rows.value = response.data;
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <section class="panel">
    <h2 class="mb-3 text-lg">棚区</h2>
    <p v-if="loading" class="text-mist">加载中…</p>
    <p v-else-if="error" class="text-danger">{{ error }}</p>
    <p v-else-if="!rows.length" class="text-mist">当前账号没有可见棚区。</p>
    <ul v-else class="space-y-2">
      <li v-for="row in rows" :key="row.id" class="flex justify-between border-b border-line/70 py-2">
        <span>{{ row.name }}</span>
        <span class="font-mono text-accent">{{ row.code }} · {{ row.location || '未填位置' }}</span>
      </li>
    </ul>
  </section>
</template>
