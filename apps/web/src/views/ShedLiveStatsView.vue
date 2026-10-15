<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { errorText, http } from '../api';

interface LiveStats {
  shedCode: string;
  cameraCode: string | null;
  available: boolean;
  mushroomCount: number | null;
  matureCount: number | null;
  pendingMatureCount: number | null;
  diseaseCount: number | null;
}

interface ShedOption {
  code: string;
  name: string;
}

const route = useRoute();
const router = useRouter();
const sheds = ref<ShedOption[]>([]);
const shedCode = ref('');
const cameraDraft = ref('');
const stats = ref<LiveStats | null>(null);
const loading = ref(true);
const error = ref('');

function queryText(key: string) {
  const value = route.query[key];
  return typeof value === 'string' ? value.trim() : '';
}

function cell(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : String(value);
}

const note = computed(() => {
  const current = stats.value;
  if (!current?.available) return '';
  return `蘑菇 ${cell(current.mushroomCount)} · 成熟 ${cell(current.matureCount)} · 待成熟 ${cell(current.pendingMatureCount)} · 病害 ${cell(current.diseaseCount)}`;
});

const scopeText = computed(() => {
  const shed = shedCode.value || '—';
  const camera = cameraDraft.value.trim();
  const cameraText = camera ? `摄像头 ${camera}` : '各摄像头汇总';
  return `棚区 ${shed} · ${cameraText}`;
});

async function loadSheds() {
  if (sheds.value.length) return;
  const response = await http.get<ShedOption[]>('/sheds');
  sheds.value = Array.isArray(response.data) ? response.data : [];
}

function resolvedShed() {
  const asked = queryText('shedCode');
  if (asked && sheds.value.some((shed) => shed.code === asked)) return asked;
  if (sheds.value.some((shed) => shed.code === 'S01')) return 'S01';
  return sheds.value[0]?.code ?? asked;
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    await loadSheds();
    const shed = resolvedShed();
    if (!shed) {
      shedCode.value = '';
      cameraDraft.value = queryText('cameraCode');
      stats.value = null;
      return;
    }
    const camera = queryText('cameraCode');
    const query: Record<string, string> = { shedCode: shed };
    if (camera) query.cameraCode = camera;
    if (queryText('shedCode') !== query.shedCode || queryText('cameraCode') !== (query.cameraCode ?? '')) {
      await router.replace({ path: '/shed-live-stats', query });
      return;
    }
    shedCode.value = shed;
    cameraDraft.value = camera;
    const response = await http.get<LiveStats>('/growth-trends/live', { params: query });
    stats.value = response.data;
  } catch (cause) {
    error.value = errorText(cause);
    stats.value = null;
  } finally {
    loading.value = false;
  }
}

async function replaceQuery(next: { shedCode?: string; cameraCode?: string }) {
  const shed = (next.shedCode ?? shedCode.value).trim();
  const camera = (next.cameraCode ?? cameraDraft.value).trim();
  const query: Record<string, string> = {};
  if (shed) query.shedCode = shed;
  if (camera) query.cameraCode = camera;
  await router.replace({ path: '/shed-live-stats', query });
}

watch(
  () => [route.query.shedCode, route.query.cameraCode],
  () => {
    void load();
  },
  { immediate: true },
);
</script>

<template>
  <section class="ops-page space-y-4" data-testid="live-stats-board">
    <h2 class="text-lg">单棚实时</h2>
    <form class="panel flex flex-wrap items-end gap-3 bg-white" @submit.prevent="replaceQuery({})">
      <label class="text-sm text-mist">
        棚区
        <select
          v-model="shedCode"
          class="field mt-1"
          data-testid="live-stats-shed"
          @change="replaceQuery({ shedCode: shedCode })"
        >
          <option v-for="shed in sheds" :key="shed.code" :value="shed.code">
            {{ shed.name }}（{{ shed.code }}）
          </option>
        </select>
      </label>
      <label class="text-sm text-mist">
        摄像头
        <input v-model="cameraDraft" class="field mt-1 font-mono" data-testid="live-stats-camera" />
      </label>
      <button class="btn-primary" type="submit" data-testid="live-stats-apply">查看</button>
    </form>
    <p class="text-sm text-mist" data-testid="live-stats-scope">{{ scopeText }}</p>
    <p v-if="loading" class="text-mist">加载中…</p>
    <p v-else-if="error" class="text-danger" data-testid="live-stats-error">{{ error }}</p>
    <template v-else>
      <p v-if="note" class="panel bg-white text-sm" data-testid="live-stats-note">{{ note }}</p>
      <p v-if="!stats?.available" class="text-mist" data-testid="live-stats-empty">该棚暂无实时生长数据。</p>
      <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="live-stats-grid">
        <article class="panel bg-white">
          <p class="text-mist">蘑菇数</p>
          <p class="font-mono text-3xl text-accent" data-testid="live-stats-mushroom">{{ cell(stats?.mushroomCount) }}</p>
        </article>
        <article class="panel bg-white">
          <p class="text-mist">成熟数</p>
          <p class="font-mono text-3xl text-accent" data-testid="live-stats-mature">{{ cell(stats?.matureCount) }}</p>
        </article>
        <article class="panel bg-white">
          <p class="text-mist">待成熟</p>
          <p class="font-mono text-3xl text-accent" data-testid="live-stats-pending">{{ cell(stats?.pendingMatureCount) }}</p>
        </article>
        <article class="panel bg-white">
          <p class="text-mist">病害数</p>
          <p class="font-mono text-3xl text-accent" data-testid="live-stats-disease">{{ cell(stats?.diseaseCount) }}</p>
        </article>
      </section>
    </template>
  </section>
</template>
