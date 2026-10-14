<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
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
const router = useRouter();
const rows = ref<Row[]>([]);
const loading = ref(true);
const error = ref('');
const filterError = ref('');
const cameraDraft = ref('');
const fromDraft = ref('');
const toDraft = ref('');

function queryValue(key: string) {
  const value = route.query[key];
  return typeof value === 'string' ? value : '';
}

function invalidBound(value: string) {
  return value !== '' && Number.isNaN(new Date(value).getTime());
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function toLocalInput(value: string) {
  if (!value || invalidBound(value)) return '';
  const date = new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function syncDrafts() {
  cameraDraft.value = queryValue('cameraCode').trim();
  fromDraft.value = toLocalInput(queryValue('from'));
  toDraft.value = toLocalInput(queryValue('to'));
}

const bounds = computed(() => ({
  from: queryValue('from'),
  to: queryValue('to'),
  shedCode: queryValue('shedCode'),
  cameraCode: queryValue('cameraCode').trim(),
}));

const filterLabel = computed(() => {
  const parts: string[] = [];
  if (bounds.value.shedCode) parts.push(bounds.value.shedCode);
  if (bounds.value.cameraCode) parts.push(bounds.value.cameraCode);
  if (bounds.value.from && !invalidBound(bounds.value.from)) {
    parts.push(new Date(bounds.value.from).toLocaleString('zh-CN'));
  }
  if (bounds.value.to && !invalidBound(bounds.value.to)) {
    parts.push(new Date(bounds.value.to).toLocaleString('zh-CN'));
  }
  return parts.join(' · ');
});

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

async function applyHistory() {
  const cameraCode = cameraDraft.value.trim();
  const from = fromDraft.value.trim();
  const to = toDraft.value.trim();
  if ((from && invalidBound(from)) || (to && invalidBound(to))) {
    rows.value = [];
    filterError.value = '时间筛选无效';
    loading.value = false;
    return;
  }
  const query: Record<string, string> = {};
  const shedCode = queryValue('shedCode');
  if (shedCode) query.shedCode = shedCode;
  if (cameraCode) query.cameraCode = cameraCode;
  if (from) query.from = new Date(from).toISOString();
  if (to) query.to = new Date(to).toISOString();
  await router.replace({ path: route.path, query });
}

async function clearHistory() {
  cameraDraft.value = '';
  fromDraft.value = '';
  toDraft.value = '';
  await router.replace({ path: route.path, query: {} });
}

watch(
  () => [route.query.from, route.query.to, route.query.shedCode, route.query.cameraCode],
  () => {
    syncDrafts();
    void load();
  },
  { immediate: true },
);
</script>

<template>
  <section class="ops-page">
    <h2 class="text-lg text-ink">识别记录</h2>
    <p class="mb-3 text-sm text-mist">HTTP {{ INGEST_HTTP_PATH }} · MQTT {{ MQTT_RECOGNITION_TOPIC }}</p>
    <form class="mb-3 flex flex-wrap items-end gap-3" @submit.prevent="applyHistory">
      <label class="text-sm">摄像头
        <input
          v-model="cameraDraft"
          class="field mt-1"
          placeholder="摄像头编号"
          data-testid="recog-history-camera"
        />
      </label>
      <label class="text-sm">开始
        <input
          v-model="fromDraft"
          class="field mt-1"
          type="datetime-local"
          data-testid="recog-history-from"
        />
      </label>
      <label class="text-sm">结束
        <input
          v-model="toDraft"
          class="field mt-1"
          type="datetime-local"
          data-testid="recog-history-to"
        />
      </label>
      <button class="btn-ghost" type="submit" data-testid="recog-history-apply">查询</button>
      <button class="btn-ghost" type="button" data-testid="recog-history-clear" @click="clearHistory">清除</button>
    </form>
    <p v-if="filterLabel" class="mb-3 text-sm text-mist" data-testid="recog-history-scope">筛选 {{ filterLabel }}</p>
    <p v-if="loading" class="text-mist">加载中…</p>
    <p v-else-if="filterError" class="text-danger">{{ filterError }}</p>
    <p v-else-if="error" class="text-danger">{{ error }}</p>
    <p v-else-if="!rows.length" class="text-mist" data-testid="recog-history-empty">{{ filterLabel ? '没有符合条件的识别记录。' : '暂无记录。' }}</p>
    <div v-else class="result-grid" data-testid="recog-history">
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
