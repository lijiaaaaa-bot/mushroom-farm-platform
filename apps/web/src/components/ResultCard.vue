<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { errorText, http } from '../api';

const props = defineProps<{
  id: string;
  snapshotObjectKey?: string | null;
  snapshotUrl?: string | null;
  emptyLabel?: string;
}>();

const open = ref(false);
const loading = ref(false);
const error = ref('');
const imageUrl = ref('');
const ownedUrl = ref('');
const hasSnapshot = computed(() => Boolean(props.snapshotObjectKey || props.snapshotUrl));
const emptyLabel = computed(() => props.emptyLabel || '无抓拍');
const mediaText = computed(() => {
  if (error.value === '无抓拍' || error.value === '抓拍不可用') return emptyLabel.value;
  return error.value || emptyLabel.value;
});

function directImage(url: string | null | undefined) {
  const value = url?.trim() ?? '';
  if (/^data:image\//i.test(value)) return value;
  if (/^https?:\/\//i.test(value)) return value;
  return '';
}

async function load() {
  if (!hasSnapshot.value || ownedUrl.value || loading.value) return;
  const direct = directImage(props.snapshotUrl);
  if (direct && !imageUrl.value) imageUrl.value = direct;
  if (direct.startsWith('data:') && !props.snapshotObjectKey) return;
  loading.value = true;
  error.value = '';
  try {
    const response = await http.get<Blob>(`/ingest/recognitions/${props.id}/snapshot`, {
      responseType: 'blob',
    });
    if (!response.data || response.data.size === 0) {
      if (!imageUrl.value) error.value = emptyLabel.value;
      return;
    }
    ownedUrl.value = URL.createObjectURL(response.data);
    imageUrl.value = ownedUrl.value;
  } catch (cause) {
    if (!imageUrl.value) {
      error.value = errorText(cause);
    }
  } finally {
    loading.value = false;
  }
}

function show() {
  open.value = true;
  void load();
}

onMounted(() => {
  void load();
});

onBeforeUnmount(() => {
  if (ownedUrl.value) URL.revokeObjectURL(ownedUrl.value);
});
</script>

<template>
  <figure class="result-card">
    <div class="result-card-media" :class="{ 'is-empty': !imageUrl }">
      <img v-if="imageUrl" :src="imageUrl" alt="抓拍" />
      <span v-else-if="loading">加载中…</span>
      <span v-else>{{ mediaText }}</span>
    </div>
    <figcaption class="result-card-caption">
      <slot />
      <button v-if="hasSnapshot" class="result-card-detail" type="button" @click="show">详情</button>
    </figcaption>
    <div
      v-if="open"
      class="fixed inset-0 z-20 flex items-center justify-center bg-ink/30 p-4"
      @click.self="open = false"
    >
      <div class="panel max-w-3xl bg-white">
        <p v-if="loading && !imageUrl" class="text-mist">加载中…</p>
        <p v-else-if="error && !imageUrl" class="text-danger">{{ error }}</p>
        <img
          v-else-if="imageUrl"
          :src="imageUrl"
          alt="抓拍"
          class="max-h-[70vh] max-w-full rounded-lg border border-line bg-white"
        />
        <button class="btn-ghost mt-3" type="button" @click="open = false">关闭</button>
      </div>
    </div>
  </figure>
</template>
