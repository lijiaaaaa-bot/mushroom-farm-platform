<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { canCorrectHarvest, currentUser } from '../auth';
import { errorText, http } from '../api';
import { shanghaiStamp } from '../disease-level';

type Phase = 'flush' | 'fast_growth' | 'mature';

interface BatchRow {
  id: string;
  shedCode: string;
  batchCode: string;
  startedAt: string;
  phase: Phase;
  closedAt: string | null;
  note: string | null;
}

interface PhaseEvent {
  id: string;
  phase: Phase;
  occurredAt: string;
  note: string | null;
  recordedBy: string | null;
}

interface CurvePoint {
  day: string;
  mushroomCount: number | null;
  matureCount: number | null;
  capDiameterMean: number | null;
}

interface Replay {
  batch: BatchRow;
  phases: PhaseEvent[];
  curve: CurvePoint[];
}

const PHASE_LABEL: Record<Phase, string> = {
  flush: '出菇',
  fast_growth: '快速生长',
  mature: '成熟',
};

const route = useRoute();
const canWrite = () => canCorrectHarvest(currentUser.value?.role);
const shedCode = ref('S01');
const batchCode = ref('');
const startedAt = ref(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()));
const note = ref('');
const items = ref<BatchRow[]>([]);
const replay = ref<Replay | null>(null);
const error = ref('');
const loading = ref(false);

function queriedBatchCode() {
  const value = route.query.batchCode;
  return typeof value === 'string' ? value.trim() : '';
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const response = await http.get<{ items: BatchRow[] }>('/batches');
    items.value = response.data.items;
    const code = queriedBatchCode();
    const row = code ? items.value.find((item) => item.batchCode === code) : undefined;
    if (row) await openReplay(row.id);
  } catch (cause) {
    items.value = [];
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
}

async function createBatch() {
  error.value = '';
  try {
    await http.post('/batches', {
      shedCode: shedCode.value,
      batchCode: batchCode.value,
      startedAt: startedAt.value,
      note: note.value || undefined,
    });
    batchCode.value = '';
    note.value = '';
    await load();
  } catch (cause) {
    error.value = errorText(cause);
  }
}

async function openReplay(id: string) {
  error.value = '';
  try {
    const response = await http.get<Replay>(`/batches/${id}/replay`);
    replay.value = response.data;
  } catch (cause) {
    replay.value = null;
    error.value = errorText(cause);
  }
}

async function recordPhase(phase: Phase) {
  if (!replay.value) return;
  error.value = '';
  try {
    await http.post(`/batches/${replay.value.batch.id}/phases`, { phase });
    await openReplay(replay.value.batch.id);
    await load();
  } catch (cause) {
    error.value = errorText(cause);
  }
}

async function closeBatch() {
  if (!replay.value) return;
  error.value = '';
  try {
    await http.post(`/batches/${replay.value.batch.id}/close`, {});
    await openReplay(replay.value.batch.id);
    await load();
  } catch (cause) {
    error.value = errorText(cause);
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <section class="ops-page space-y-4">
    <form v-if="canWrite()" class="panel grid gap-3 sm:grid-cols-4" @submit.prevent="createBatch">
      <label class="text-sm">棚区
        <input v-model="shedCode" class="field mt-1" />
      </label>
      <label class="text-sm">批次编号
        <input v-model="batchCode" class="field mt-1" required />
      </label>
      <label class="text-sm">开始日
        <input v-model="startedAt" class="field mt-1" type="date" />
      </label>
      <label class="text-sm">备注
        <input v-model="note" class="field mt-1" />
      </label>
      <button class="btn-primary sm:col-span-4 w-fit" type="submit">新建批次</button>
    </form>
    <p v-if="loading" class="text-mist">加载中…</p>
    <p v-if="error" class="text-sm text-danger">{{ error }}</p>
    <section class="panel overflow-x-auto">
      <h2 class="text-lg">出菇批次</h2>
      <p v-if="!loading && !error && !items.length" class="text-mist">还没有批次。</p>
      <table v-else-if="items.length" class="data-table">
        <thead>
          <tr>
            <th>棚区</th>
            <th>批次</th>
            <th>当前阶段</th>
            <th>开始</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.id" :data-batch-code="item.batchCode">
            <td>{{ item.shedCode }}</td>
            <td class="font-mono">{{ item.batchCode }}</td>
            <td>{{ PHASE_LABEL[item.phase] }}</td>
            <td class="font-mono text-xs">{{ shanghaiStamp(item.startedAt).slice(0, 10) }}</td>
            <td>
              <button class="btn-ghost" type="button" @click="openReplay(item.id)">回放</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
    <section v-if="replay" class="panel space-y-3" data-testid="batch-replay">
      <h2 class="text-lg">全周期回放 {{ replay.batch.batchCode }}</h2>
      <p class="text-sm">当前阶段 {{ PHASE_LABEL[replay.batch.phase] }}</p>
      <div v-if="canWrite() && !replay.batch.closedAt" class="flex flex-wrap gap-2">
        <button class="btn-ghost" type="button" @click="recordPhase('flush')">记出菇</button>
        <button class="btn-ghost" type="button" @click="recordPhase('fast_growth')">记快速生长</button>
        <button class="btn-ghost" type="button" @click="recordPhase('mature')">记成熟</button>
        <button class="btn-ghost" type="button" @click="closeBatch">结束批次</button>
      </div>
      <h3 class="text-base">阶段</h3>
      <ol class="space-y-1 text-sm" data-testid="batch-phases">
        <li v-for="phase in replay.phases" :key="phase.id">
          {{ PHASE_LABEL[phase.phase] }} · {{ shanghaiStamp(phase.occurredAt) }}
          <span v-if="phase.recordedBy" class="text-mist">{{ phase.recordedBy }}</span>
        </li>
      </ol>
      <p v-if="!replay.curve.length" class="text-sm text-mist">该时间窗内没有棚级日桶。</p>
      <p v-else class="text-sm" data-testid="batch-window">
        回放 {{ replay.curve[0].day }} 至 {{ replay.curve[replay.curve.length - 1].day }}，共 {{ replay.curve.length }} 天
      </p>
      <h3 v-if="replay.curve.length" class="text-base">棚级日桶</h3>
      <table v-if="replay.curve.length" class="data-table" data-testid="batch-curve">
        <thead>
          <tr>
            <th>日期</th>
            <th>蘑菇</th>
            <th>成熟</th>
            <th>菌盖</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="point in replay.curve" :key="point.day">
            <td class="font-mono">{{ point.day }}</td>
            <td>{{ point.mushroomCount ?? '—' }}</td>
            <td>{{ point.matureCount ?? '—' }}</td>
            <td>{{ point.capDiameterMean ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>
