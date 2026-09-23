<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { errorText, http } from '../api';

const props = defineProps<{
  id: string;
  snapshotObjectKey?: string | null;
  snapshotUrl?: string | null;
}>();

const open = ref(false);
const loading = ref(false);
const error = ref('');
const imageUrl = ref('');
const hasSnapshot = computed(
  () => Boolean(props.snapshotObjectKey || props.snapshotUrl),
);

async function show() {
  if (!hasSnapshot.value) return;
  open.value = true;
  loading.value = true;
  error.value = '';
  try {
    const response = await http.get<Blob>(`/ingest/recognitions/${props.id}/snapshot`, {
      responseType: 'blob',
    });
    if (!response.data || response.data.size === 0) {
      error.value = '无抓拍';
      return;
    }
    if (imageUrl.value) URL.revokeObjectURL(imageUrl.value);
    imageUrl.value = URL.createObjectURL(response.data);
  } catch (cause) {
    imageUrl.value = '';
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
}

function close() {
  open.value = false;
}

onBeforeUnmount(() => {
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value);
});
</script>

<template>
  <span v-if="!hasSnapshot" class="text-mist">无抓拍</span>
  <button v-else class="btn-ghost" type="button" @click="show">查看抓拍</button>
  <div
    v-if="open"
    class="fixed inset-0 z-20 flex items-center justify-center bg-ink/30 p-4"
    @click.self="close"
  >
    <div class="panel max-w-3xl bg-white">
      <p v-if="loading" class="text-mist">加载中…</p>
      <p v-else-if="error" class="text-danger">{{ error }}</p>
      <img
        v-else-if="imageUrl"
        :src="imageUrl"
        alt="抓拍"
        class="max-h-[70vh] max-w-full rounded-lg border border-line bg-white"
      />
      <p v-else class="text-mist">无抓拍</p>
      <button class="btn-ghost mt-3" type="button" @click="close">关闭</button>
    </div>
  </div>
</template>
