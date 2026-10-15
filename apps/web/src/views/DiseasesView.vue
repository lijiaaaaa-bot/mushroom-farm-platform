<script setup lang="ts">
import { computed, ref, watch } from 'vue';
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
interface PeakPoint {
  bucketStart: string;
  diseaseCount: number;
}

interface ShedPeak {
  shedCode: string;
  diseaseCount: number;
}

interface Peaks {
  grain: string;
  from?: string;
  to?: string;
  byTime: PeakPoint[];
  byShed: ShedPeak[];
  peak: PeakPoint | null;
}

const peaks = ref<Peaks | null>(null);
const peaksError = ref('');
let peaksTicket = 0;

function queryValue(key: string) {
  const value = route.query[key];
  return typeof value === 'string' ? value : '';
}

function grainQuery(): 'hour' | 'day' {
  return queryValue('grain') === 'day' ? 'day' : 'hour';
}

function withGrain(query: Record<string, string>) {
  const raw = queryValue('grain');
  if (raw === 'hour' || raw === 'day') query.grain = raw;
  return query;
}

function bucketLabel(value: string, grain: string) {
  const text = shanghaiStamp(value);
  if (text === '—') return text;
  return grain === 'day' ? text.slice(0, 10) : text;
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

const timeMax = computed(() =>
  Math.max(0, ...(peaks.value?.byTime ?? []).map((row) => row.diseaseCount)),
);

const shedMax = computed(() =>
  Math.max(0, ...(peaks.value?.byShed ?? []).map((row) => row.diseaseCount)),
);

const topShed = computed(() => {
  const rows = peaks.value?.byShed ?? [];
  return rows.find((row) => row.diseaseCount > 0 && row.diseaseCount === shedMax.value) ?? null;
});

const windowText = computed(() => {
  const grain = peaks.value?.grain === 'day' ? 'day' : grainQuery();
  const title = grain === 'day' ? '近 7 日' : '近 24 小时';
  if (!peaks.value?.from || !peaks.value?.to) return title;
  return `${title} · ${bucketLabel(peaks.value.from, grain)} 至 ${bucketLabel(peaks.value.to, grain)}`;
});

const filterActive = computed(() => {
  const filter = bounds.value;
  return Boolean(
    filter.shedCode || filter.cameraCode || filter.from || filter.to || filter.diseaseLevel,
  );
});

function barWidth(count: number, max: number) {
  if (max <= 0 || count <= 0) return '0%';
  return `${Math.min(100, Math.max(8, Math.round((count / max) * 100)))}%`;
}

function isTimePeak(row: PeakPoint) {
  return Boolean(peaks.value?.peak && peaks.value.peak.bucketStart === row.bucketStart);
}

function isShedPeak(row: ShedPeak) {
  return row.diseaseCount > 0 && row.diseaseCount === shedMax.value;
}

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
  await router.replace({ path: '/diseases', query: withGrain(query) });
}

async function clearFilters() {
  shedDraft.value = '';
  cameraDraft.value = '';
  fromDraft.value = '';
  toDraft.value = '';
  levelDraft.value = '';
  await router.replace({ path: '/diseases', query: withGrain({}) });
}

async function setGrain(next: 'hour' | 'day') {
  const query: Record<string, string> = {};
  for (const key of ['shedCode', 'cameraCode', 'from', 'to', 'diseaseLevel'] as const) {
    const value = queryValue(key);
    if (value) query[key] = value;
  }
  query.grain = next;
  await router.replace({ path: '/diseases', query });
}

async function loadPeaks() {
  const ticket = ++peaksTicket;
  const grain = grainQuery();
  peaksError.value = '';
  try {
    const peakResponse = await http.get<Peaks>('/diseases/peaks', { params: { grain } });
    if (ticket !== peaksTicket) return;
    const data = peakResponse.data;
    if (data && Array.isArray(data.byTime) && Array.isArray(data.byShed)) {
      peaks.value = data;
      return;
    }
    peaks.value = null;
  } catch (cause) {
    if (ticket !== peaksTicket) return;
    peaks.value = null;
    peaksError.value = errorText(cause);
  }
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

watch(
  () => route.query.grain,
  () => {
    void loadPeaks();
  },
  { immediate: true },
);
</script>

<template>
  <section class="ops-page space-y-4">
    <section
      v-if="peaks || peaksError"
      class="panel space-y-3"
      data-testid="disease-peaks"
      :data-grain="peaks?.grain || grainQuery()"
    >
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="text-lg text-ink">病害高发</h2>
        <button
          type="button"
          data-testid="disease-grain-hour"
          :class="grainQuery() === 'hour' ? 'btn-primary' : 'btn-ghost'"
          :aria-pressed="grainQuery() === 'hour'"
          @click="setGrain('hour')"
        >
          小时
        </button>
        <button
          type="button"
          data-testid="disease-grain-day"
          :class="grainQuery() === 'day' ? 'btn-primary' : 'btn-ghost'"
          :aria-pressed="grainQuery() === 'day'"
          @click="setGrain('day')"
        >
          日
        </button>
      </div>
      <p class="text-sm text-mist" data-testid="disease-peak-window">
        {{ windowText }}。读小时桶或日桶里的病害数。档案仍是下面的识别记录。
      </p>
      <p v-if="peaksError" class="text-danger" data-testid="disease-peak-error">{{ peaksError }}</p>
      <p
        v-else-if="peaks && !peaks.byTime.length && !peaks.byShed.length"
        class="text-mist"
        data-testid="disease-peak-empty"
      >
        该粒度下没有病害高发。
      </p>
      <template v-else-if="peaks">
        <p v-if="peaks.peak" class="text-sm text-ink" data-testid="disease-peak-headline">
          峰值时段 {{ bucketLabel(peaks.peak.bucketStart, peaks.grain) }} · 病害数量 {{ peaks.peak.diseaseCount }}
          <template v-if="topShed">
            · 最高棚区 {{ topShed.shedCode }} · 病害数量 {{ topShed.diseaseCount }}
          </template>
        </p>
        <div class="grid gap-4 md:grid-cols-2">
          <div>
            <h3 class="mb-2 text-sm text-ink">高发时段</h3>
            <table v-if="peaks.byTime.length" class="data-table" data-testid="disease-peak-times">
              <thead>
                <tr>
                  <th>时段</th>
                  <th>病害数量</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in peaks.byTime"
                  :key="row.bucketStart"
                  data-testid="disease-peak-time"
                  :data-bucket="row.bucketStart"
                  :data-peak="isTimePeak(row) ? '1' : '0'"
                >
                  <td class="font-mono text-xs" data-field="period">
                    {{ bucketLabel(row.bucketStart, peaks.grain) }}
                  </td>
                  <td>
                    <div class="flex items-center gap-2">
                      <span class="font-mono" :data-count="row.diseaseCount">{{ row.diseaseCount }}</span>
                      <span v-if="isTimePeak(row)" class="text-amber" data-testid="disease-peak-mark">峰值</span>
                    </div>
                    <div class="hotspot-track mt-1">
                      <div
                        class="hotspot-fill"
                        data-testid="disease-peak-bar"
                        :style="{ width: barWidth(row.diseaseCount, timeMax) }"
                      />
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-else class="text-sm text-mist">该粒度下没有高发时段。</p>
          </div>
          <div>
            <h3 class="mb-2 text-sm text-ink">高发棚区</h3>
            <table v-if="peaks.byShed.length" class="data-table" data-testid="disease-peak-sheds">
              <thead>
                <tr>
                  <th>棚区</th>
                  <th>病害数量</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in peaks.byShed"
                  :key="row.shedCode"
                  data-testid="disease-peak-shed"
                  :data-shed="row.shedCode"
                  :data-peak="isShedPeak(row) ? '1' : '0'"
                >
                  <td class="font-mono" data-field="peak-shed">{{ row.shedCode }}</td>
                  <td>
                    <div class="flex items-center gap-2">
                      <span class="font-mono" :data-count="row.diseaseCount">{{ row.diseaseCount }}</span>
                      <span v-if="isShedPeak(row)" class="text-amber" data-testid="disease-shed-mark">最高</span>
                    </div>
                    <div class="hotspot-track mt-1">
                      <div
                        class="hotspot-fill"
                        data-testid="disease-shed-bar"
                        :style="{ width: barWidth(row.diseaseCount, shedMax) }"
                      />
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-else class="text-sm text-mist">该粒度下没有高发棚区。</p>
          </div>
        </div>
      </template>
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

<style scoped>
tr[data-peak='1'] {
  background: var(--bg-sidebar-active);
}
.hotspot-track {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--line);
}
.hotspot-fill {
  height: 8px;
  border-radius: 999px;
  background: var(--accent);
}
tr[data-peak='1'] .hotspot-fill {
  background: var(--warn);
}
</style>
