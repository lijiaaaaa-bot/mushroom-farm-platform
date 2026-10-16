<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { errorText, http } from '../api';

interface Row {
  id: string;
  shedCode: string;
  cameraCode: string;
  recognizedAt: string;
  mushroomCount: number;
  matureCount: number;
  diseaseCount: number;
  snapshotObjectKey: string | null;
  snapshotUrl: string | null;
}

interface ShedOption {
  code: string;
  name: string;
}

const route = useRoute();
const router = useRouter();
const sheds = ref<ShedOption[]>([]);
const rows = ref<Row[]>([]);
const shedDraft = ref('');
const cameraDraft = ref('');
const fromDraft = ref('');
const toDraft = ref('');
const loading = ref(true);
const error = ref('');
const filterError = ref('');
const imageUrl = ref('');
const imageLoading = ref(false);
const imageMissing = ref(false);
let ownedUrl = '';

function queryText(key: string) {
  const value = route.query[key];
  return typeof value === 'string' ? value.trim() : '';
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

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function syncDrafts() {
  shedDraft.value = queryText('shedCode');
  cameraDraft.value = queryText('cameraCode');
  fromDraft.value = toLocalInput(queryText('from'));
  toDraft.value = toLocalInput(queryText('to'));
}

const bounds = computed(() => ({
  shedCode: queryText('shedCode'),
  cameraCode: queryText('cameraCode'),
  from: queryText('from'),
  to: queryText('to'),
  id: queryText('id'),
}));

const selected = computed(() => {
  const asked = bounds.value.id;
  if (asked) {
    const match = rows.value.find((row) => row.id === asked);
    if (match) return match;
  }
  return rows.value[0] ?? null;
});

const timelineNote = computed(() => {
  const count = rows.value.length;
  if (!count) return '';
  return `原始 · 标注 · 时间轴 ${count} 点`;
});

const scopeText = computed(() => {
  const shed = bounds.value.shedCode || '全部';
  const camera = bounds.value.cameraCode || '全部';
  return `棚区 ${shed} · 摄像头 ${camera}`;
});

function hasSnapshot(row: Row | null) {
  return Boolean(row?.snapshotObjectKey || row?.snapshotUrl);
}

function revokeImage() {
  if (ownedUrl) URL.revokeObjectURL(ownedUrl);
  ownedUrl = '';
  imageUrl.value = '';
}

async function loadSheds() {
  if (sheds.value.length) return;
  const response = await http.get<ShedOption[]>('/sheds');
  sheds.value = Array.isArray(response.data) ? response.data : [];
}

async function loadImage(row: Row | null) {
  revokeImage();
  imageMissing.value = false;
  if (!row || !hasSnapshot(row)) {
    imageMissing.value = Boolean(row);
    imageLoading.value = false;
    return;
  }
  imageLoading.value = true;
  try {
    const response = await http.get<Blob>(`/ingest/recognitions/${row.id}/snapshot`, {
      responseType: 'blob',
    });
    if (!response.data || response.data.size === 0) {
      imageMissing.value = true;
      return;
    }
    ownedUrl = URL.createObjectURL(response.data);
    imageUrl.value = ownedUrl;
  } catch {
    imageMissing.value = true;
  } finally {
    imageLoading.value = false;
  }
}

async function load() {
  loading.value = true;
  error.value = '';
  filterError.value = '';
  syncDrafts();
  const filter = bounds.value;
  if (invalidBound(filter.from) || invalidBound(filter.to)) {
    rows.value = [];
    revokeImage();
    imageMissing.value = false;
    filterError.value = '时间筛选无效';
    loading.value = false;
    return;
  }
  const params: Record<string, string> = { pageSize: '50' };
  if (filter.shedCode) params.shedCode = filter.shedCode;
  if (filter.cameraCode) params.cameraCode = filter.cameraCode;
  if (filter.from) params.from = new Date(filter.from).toISOString();
  if (filter.to) params.to = new Date(filter.to).toISOString();
  try {
    await loadSheds();
    const response = await http.get<{ items: Row[] }>('/ingest/recognitions', { params });
    rows.value = Array.isArray(response.data.items) ? response.data.items : [];
    await loadImage(selected.value);
  } catch (cause) {
    error.value = errorText(cause);
    rows.value = [];
    revokeImage();
  } finally {
    loading.value = false;
  }
}

function queryFromDrafts(extra: Record<string, string> = {}) {
  const query: Record<string, string> = { ...extra };
  const shed = shedDraft.value.trim();
  const camera = cameraDraft.value.trim();
  const from = fromDraft.value.trim();
  const to = toDraft.value.trim();
  if (shed) query.shedCode = shed;
  if (camera) query.cameraCode = camera;
  if (from && !invalidBound(from)) query.from = new Date(from).toISOString();
  if (to && !invalidBound(to)) query.to = new Date(to).toISOString();
  const currentId = queryText('id');
  if (currentId && !query.id) query.id = currentId;
  return query;
}

async function applyFilters() {
  const from = fromDraft.value.trim();
  const to = toDraft.value.trim();
  if ((from && invalidBound(from)) || (to && invalidBound(to))) {
    rows.value = [];
    revokeImage();
    filterError.value = '时间筛选无效';
    loading.value = false;
    return;
  }
  const query = queryFromDrafts();
  delete query.id;
  await router.replace({ path: '/capture-preview', query });
}

async function selectPoint(id: string) {
  await router.replace({ path: '/capture-preview', query: queryFromDrafts({ id }) });
}

watch(
  () => [route.query.shedCode, route.query.cameraCode, route.query.from, route.query.to, route.query.id],
  () => {
    void load();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  revokeImage();
});
</script>

<template>
  <section class="ops-page space-y-4" data-testid="capture-preview">
    <h2 class="text-lg">抓拍对照</h2>
    <form class="panel flex flex-wrap items-end gap-3 bg-white" @submit.prevent="applyFilters">
      <label class="text-sm text-mist">
        棚区
        <select v-model="shedDraft" class="field mt-1" data-testid="capture-shed" @change="applyFilters">
          <option value="">全部</option>
          <option v-for="shed in sheds" :key="shed.code" :value="shed.code">
            {{ shed.name }}（{{ shed.code }}）
          </option>
        </select>
      </label>
      <label class="text-sm text-mist">
        摄像头
        <input v-model="cameraDraft" class="field mt-1 font-mono" data-testid="capture-camera" />
      </label>
      <label class="text-sm text-mist">
        开始
        <input v-model="fromDraft" class="field mt-1" type="datetime-local" data-testid="capture-from" />
      </label>
      <label class="text-sm text-mist">
        结束
        <input v-model="toDraft" class="field mt-1" type="datetime-local" data-testid="capture-to" />
      </label>
      <button class="btn-primary" type="submit" data-testid="capture-apply">查看</button>
    </form>
    <p class="text-sm text-mist" data-testid="capture-scope">{{ scopeText }}</p>
    <p v-if="loading" class="text-mist">加载中…</p>
    <p v-else-if="filterError" class="text-danger" data-testid="capture-filter-error">{{ filterError }}</p>
    <p v-else-if="error" class="text-danger" data-testid="capture-error">{{ error }}</p>
    <p v-else-if="!rows.length" class="text-mist" data-testid="capture-empty">没有可回看的抓拍。</p>
    <template v-else>
      <p class="panel bg-white text-sm" data-testid="capture-note">{{ timelineNote }}</p>
      <div class="grid gap-3 lg:grid-cols-2" data-testid="capture-pair">
        <article class="panel bg-white" data-testid="capture-original">
          <h3 class="mb-2 text-sm">原始</h3>
          <img v-if="imageUrl" :src="imageUrl" alt="原始抓拍" class="max-h-80 w-full rounded-lg border border-line object-contain" />
          <p v-else-if="imageLoading" class="text-mist">加载中…</p>
          <p v-else class="text-mist" data-testid="capture-original-empty">无原始抓拍</p>
        </article>
        <article class="panel bg-white" data-testid="capture-annotated">
          <h3 class="mb-2 text-sm">标注</h3>
          <div v-if="imageUrl && selected" class="relative">
            <img :src="imageUrl" alt="AI标注" class="max-h-80 w-full rounded-lg border border-line object-contain" />
            <div
              class="absolute inset-x-2 bottom-2 rounded-lg border border-line bg-white/95 p-2 text-sm"
              data-testid="capture-labels"
            >
              <p class="font-medium">AI标注</p>
              <p>蘑菇数 {{ selected.mushroomCount }}</p>
              <p>成熟 {{ selected.matureCount }}</p>
              <p>病害 {{ selected.diseaseCount }}</p>
            </div>
          </div>
          <p v-else-if="imageLoading" class="text-mist">加载中…</p>
          <p v-else class="text-mist" data-testid="capture-annotated-empty">无标注图</p>
        </article>
      </div>
      <section data-testid="capture-timeline">
        <h3 class="mb-2 text-sm">历史时间轴</h3>
        <ol class="space-y-2">
          <li v-for="row in rows" :key="row.id">
            <button
              class="panel w-full bg-white text-left text-sm"
              type="button"
              data-testid="capture-timeline-item"
              :data-selected="row.id === selected?.id ? 'true' : 'false'"
              @click="selectPoint(row.id)"
            >
              {{ formatTime(row.recognizedAt) }} · {{ row.cameraCode }} · 蘑菇数 {{ row.mushroomCount }} · 成熟 {{ row.matureCount }} · 病害 {{ row.diseaseCount }}
            </button>
          </li>
        </ol>
      </section>
    </template>
  </section>
</template>
