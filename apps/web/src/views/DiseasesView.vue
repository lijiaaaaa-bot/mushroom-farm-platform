<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { errorText, http } from '../api';
import { DISEASE_LEVEL_OPTIONS, diseaseLevelText, shanghaiStamp } from '../disease-level';

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

const route = useRoute();
const router = useRouter();
const rows = ref<Row[]>([]);
const loading = ref(true);
const error = ref('');
const filterError = ref('');
const shedDraft = ref('');
const cameraDraft = ref('');
const fromDraft = ref('');
const toDraft = ref('');
const levelDraft = ref('');
const peaks = ref<{
  grain: string;
  byTime: Array<{ bucketStart: string; diseaseCount: number }>;
  byShed: Array<{ shedCode: string; diseaseCount: number }>;
  peak: { bucketStart: string; diseaseCount: number } | null;
} | null>(null);

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

function levelQuery(value: string) {
  return DISEASE_LEVEL_OPTIONS.some((item) => item.value === value) ? value : '';
}

function syncDrafts() {
  shedDraft.value = queryValue('shedCode').trim();
  cameraDraft.value = queryValue('cameraCode').trim();
  fromDraft.value = toLocalInput(queryValue('from'));
  toDraft.value = toLocalInput(queryValue('to'));
  levelDraft.value = levelQuery(queryValue('diseaseLevel').trim());
}

const bounds = computed(() => ({
  shedCode: queryValue('shedCode').trim(),
  cameraCode: queryValue('cameraCode').trim(),
  from: queryValue('from'),
  to: queryValue('to'),
  diseaseLevel: queryValue('diseaseLevel').trim(),
}));

const filterActive = computed(() => {
  const filter = bounds.value;
  return Boolean(
    filter.shedCode || filter.cameraCode || filter.from || filter.to || filter.diseaseLevel,
  );
});

function hasImage(row: Row) {
  return Boolean(row.snapshotObjectKey || row.snapshotUrl);
}

function detailTo(row: Row) {
  const query: Record<string, string> = {};
  const filter = bounds.value;
  if (filter.shedCode) query.shedCode = filter.shedCode;
  if (filter.cameraCode) query.cameraCode = filter.cameraCode;
  if (filter.from && !invalidBound(filter.from)) query.from = new Date(filter.from).toISOString();
  if (filter.to && !invalidBound(filter.to)) query.to = new Date(filter.to).toISOString();
  if (levelQuery(filter.diseaseLevel)) query.diseaseLevel = filter.diseaseLevel;
  return { path: `/diseases/${row.id}`, query };
}

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
  if (filter.diseaseLevel && !levelQuery(filter.diseaseLevel)) {
    rows.value = [];
    filterError.value = '病害等级无效';
    loading.value = false;
    return;
  }
  const params: Record<string, string> = { pageSize: '50' };
  if (filter.shedCode) params.shedCode = filter.shedCode;
  if (filter.cameraCode) params.cameraCode = filter.cameraCode;
  if (filter.from) params.from = new Date(filter.from).toISOString();
  if (filter.to) params.to = new Date(filter.to).toISOString();
  if (filter.diseaseLevel) params.diseaseLevel = filter.diseaseLevel;
  try {
    const response = await http.get<{ items: Row[] }>('/diseases', { params });
    rows.value = response.data.items;
  } catch (cause) {
    error.value = errorText(cause);
    rows.value = [];
  } finally {
    loading.value = false;
  }
}

async function apply() {
  const shedCode = shedDraft.value.trim();
  const cameraCode = cameraDraft.value.trim();
  const from = fromDraft.value.trim();
  const to = toDraft.value.trim();
  const diseaseLevel = levelDraft.value.trim();
  if ((from && invalidBound(from)) || (to && invalidBound(to))) {
    rows.value = [];
    filterError.value = '时间筛选无效';
    error.value = '';
    loading.value = false;
    return;
  }
  const query: Record<string, string> = {};
  if (shedCode) query.shedCode = shedCode;
  if (cameraCode) query.cameraCode = cameraCode;
  if (from) query.from = new Date(from).toISOString();
  if (to) query.to = new Date(to).toISOString();
  if (diseaseLevel) query.diseaseLevel = diseaseLevel;
  await router.replace({ path: '/diseases', query });
}

async function clearFilters() {
  shedDraft.value = '';
  cameraDraft.value = '';
  fromDraft.value = '';
  toDraft.value = '';
  levelDraft.value = '';
  await router.replace({ path: '/diseases', query: {} });
}

watch(
  () => [
    route.query.shedCode,
    route.query.cameraCode,
    route.query.from,
    route.query.to,
    route.query.diseaseLevel,
  ],
  () => {
    syncDrafts();
    void load();
  },
  { immediate: true },
);

onMounted(async () => {
  try {
    const peakResponse = await http
      .get<NonNullable<typeof peaks.value>>('/diseases/peaks')
      .catch(() => null);
    if (
      peakResponse &&
      Array.isArray(peakResponse.data.byTime) &&
      Array.isArray(peakResponse.data.byShed)
    ) {
      peaks.value = peakResponse.data;
    }
  } catch {
    peaks.value = null;
  }
});
</script>

<template>
  <section class="ops-page space-y-4">
    <section
      v-if="peaks && (peaks.byTime.length || peaks.byShed.length)"
      class="panel space-y-2"
      data-testid="disease-peaks"
    >
      <h2 class="text-lg text-ink">高发统计</h2>
      <p class="text-sm text-mist">读小时桶或日桶里的病害数。档案仍是下面的识别记录。</p>
      <p v-if="peaks.peak" class="font-mono text-sm">
        峰值 {{ shanghaiStamp(peaks.peak.bucketStart) }} · {{ peaks.peak.diseaseCount }}
      </p>
      <ul class="text-sm">
        <li v-for="row in peaks.byShed" :key="row.shedCode" class="font-mono">
          {{ row.shedCode }} · {{ row.diseaseCount }}
        </li>
      </ul>
    </section>
    <div>
      <h2 class="text-lg text-ink">病害记录</h2>
      <p class="mb-3 text-sm text-mist">
        只列出病害数量大于 0 的识别。可按时间、棚区、位置和病害等级检索。点「打开」看时间、棚区、位置、病害等级和病害图片。
      </p>
      <form class="mb-3 flex flex-wrap items-end gap-3" @submit.prevent="apply">
        <label class="text-sm">棚区
          <input v-model="shedDraft" class="field mt-1" aria-label="棚区" data-testid="disease-shed" />
        </label>
        <label class="text-sm">位置
          <input v-model="cameraDraft" class="field mt-1" aria-label="位置" data-testid="disease-camera" />
        </label>
        <label class="text-sm">开始时间
          <input v-model="fromDraft" class="field mt-1" type="datetime-local" data-testid="disease-from" />
        </label>
        <label class="text-sm">结束时间
          <input v-model="toDraft" class="field mt-1" type="datetime-local" data-testid="disease-to" />
        </label>
        <label class="text-sm">病害等级
          <select v-model="levelDraft" class="field mt-1" aria-label="病害等级" data-testid="disease-level">
            <option value="">全部</option>
            <option v-for="item in DISEASE_LEVEL_OPTIONS" :key="item.value" :value="item.value">
              {{ item.label }}
            </option>
          </select>
        </label>
        <button class="btn-ghost" type="submit" data-testid="disease-apply">查询</button>
        <button class="btn-ghost" type="button" data-testid="disease-clear" @click="clearFilters">清除</button>
      </form>
      <p v-if="loading" class="text-mist">加载中…</p>
      <p v-else-if="filterError" class="text-danger" data-testid="disease-filter-error">{{ filterError }}</p>
      <p v-else-if="error" class="text-danger">{{ error }}</p>
      <p v-else-if="!rows.length" class="text-mist" data-testid="disease-empty">
        {{ filterActive ? '没有符合条件的病害记录。' : '暂无病害记录。' }}
      </p>
      <table v-else class="data-table" data-testid="disease-list">
        <thead>
          <tr>
            <th>时间</th>
            <th>棚区</th>
            <th>位置</th>
            <th>病害等级</th>
            <th>病害数量</th>
            <th>图片</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id" :data-id="row.id">
            <td class="font-mono text-xs" data-field="time">{{ shanghaiStamp(row.recognizedAt) }}</td>
            <td class="font-mono" data-field="shed">{{ row.shedCode }}</td>
            <td class="font-mono" data-field="location">{{ row.cameraCode }}</td>
            <td data-field="level">{{ diseaseLevelText(row.diseaseLevel) }}</td>
            <td data-field="count">{{ row.diseaseCount }}</td>
            <td>{{ hasImage(row) ? '有图' : '无图' }}</td>
            <td>
              <router-link class="text-accent" :to="detailTo(row)" data-testid="disease-open">打开</router-link>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
