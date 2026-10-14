<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  ALERT_CLOSE_REASON_LABEL,
  ALERT_LEVEL_LABEL,
  ALERT_STATUS_LABEL,
  alertLevelSchema,
  alertStatusSchema,
  type AlertCloseReason,
  type AlertLevel,
  type AlertStatus,
  type CreateAlertInput,
} from '@mushroom/contracts';
import { canOperate, currentUser } from '../auth';
import { errorText, http } from '../api';

interface AlertRow {
  id: string;
  shedCode: string;
  cameraCode: string | null;
  level: AlertLevel;
  status: AlertStatus;
  title: string;
  message: string;
  createdAt: string;
  claimedBy: string | null;
  claimNote: string | null;
  closeReason: AlertCloseReason | null;
  closeNote: string | null;
}

const rows = ref<AlertRow[]>([]);
const loading = ref(true);
const error = ref('');
const note = ref('已确认');
const form = ref<CreateAlertInput>({
  shedCode: 'S01',
  cameraCode: 'CAM-S01-01',
  level: 'warning',
  title: '',
  message: '',
});
const route = useRoute();
const levels = alertLevelSchema.options;
const statuses = alertStatusSchema.options;
const rowEls = new Map<string, HTMLElement>();

function plainQuery(key: string): string {
  const value = route.query[key];
  return typeof value === 'string' ? value : '';
}

function allowedQuery(key: string, options: readonly string[]): string {
  const value = plainQuery(key);
  return options.includes(value) ? value : '';
}

const statusFilter = ref(allowedQuery('status', statuses));
const levelFilter = ref(allowedQuery('level', levels));
const shedCodeFilter = ref(plainQuery('shedCode'));
const highlightId = ref(plainQuery('alertId'));

function listParams() {
  return {
    pageSize: 50,
    status: statusFilter.value || undefined,
    level: levelFilter.value || undefined,
    ...(shedCodeFilter.value ? { shedCode: shedCodeFilter.value } : {}),
  };
}

function bindRow(id: string, el: unknown) {
  if (el instanceof HTMLElement) rowEls.set(id, el);
  else rowEls.delete(id);
}

async function scrollHighlight() {
  await nextTick();
  const id = highlightId.value;
  const node = id ? rowEls.get(id) : undefined;
  if (node && typeof node.scrollIntoView === 'function') {
    node.scrollIntoView({ block: 'center' });
  }
}

function applyRouteQuery() {
  statusFilter.value = allowedQuery('status', statuses);
  levelFilter.value = allowedQuery('level', levels);
  shedCodeFilter.value = plainQuery('shedCode');
  highlightId.value = plainQuery('alertId');
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const response = await http.get<{ items: AlertRow[] }>('/alerts', {
      params: listParams(),
    });
    rows.value = response.data.items;
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
  await scrollHighlight();
}

async function createAlert() {
  error.value = '';
  try {
    await http.post('/alerts', form.value);
    form.value.title = '';
    form.value.message = '';
    await load();
  } catch (cause) {
    error.value = errorText(cause);
  }
}

function reasonLabel(row: AlertRow) {
  if (!row.closeReason) return '—';
  return ALERT_CLOSE_REASON_LABEL[row.closeReason];
}

async function act(id: string, action: 'ack' | 'close' | 'claim' | 'false-positive') {
  if (action === 'false-positive' && !note.value.trim()) return;
  error.value = '';
  try {
    await http.post(`/alerts/${id}/${action}`, { note: note.value });
    await load();
  } catch (cause) {
    error.value = errorText(cause);
  }
}

watch([statusFilter, levelFilter, shedCodeFilter], () => {
  void load();
});

watch(() => route.fullPath, () => {
  applyRouteQuery();
});

watch(highlightId, () => {
  void scrollHighlight();
});

onMounted(load);
</script>

<template>
  <div class="ops-page space-y-4">
    <p class="text-sm">
      <a class="text-accent" href="/phase2/wecom">企微/钉钉推送</a>
    </p>
    <form v-if="canOperate(currentUser?.role)" class="panel grid gap-3 md:grid-cols-6" @submit.prevent="createAlert">
      <input v-model="form.shedCode" class="field" placeholder="棚区" />
      <input v-model="form.cameraCode" class="field" placeholder="摄像头" />
      <select v-model="form.level" class="field">
        <option v-for="level in levels" :key="level" :value="level">{{ ALERT_LEVEL_LABEL[level] }}</option>
      </select>
      <input v-model="form.title" class="field md:col-span-2" placeholder="标题" required />
      <button class="btn-primary" type="submit">新建告警</button>
      <textarea v-model="form.message" class="field md:col-span-5" placeholder="说明" required />
      <input v-model="note" class="field" placeholder="处置备注（误报必填）" />
    </form>
    <p v-if="error" class="text-sm text-danger">{{ error }}</p>
    <section class="panel overflow-x-auto">
      <div class="mb-3 flex flex-wrap gap-3">
        <label class="text-sm">状态
          <select v-model="statusFilter" class="field mt-1" data-testid="alert-status-filter">
            <option value="">全部</option>
            <option v-for="value in statuses" :key="value" :value="value">{{ ALERT_STATUS_LABEL[value] }}</option>
          </select>
        </label>
        <label class="text-sm">级别
          <select v-model="levelFilter" class="field mt-1" data-testid="alert-level-filter">
            <option value="">全部</option>
            <option v-for="level in levels" :key="level" :value="level">{{ ALERT_LEVEL_LABEL[level] }}</option>
          </select>
        </label>
        <p v-if="shedCodeFilter" class="self-end text-sm text-mist" data-testid="alert-shed-scope">棚 {{ shedCodeFilter }}</p>
      </div>
      <p v-if="loading" class="text-mist">加载中…</p>
      <p v-else-if="!error && !rows.length" class="text-mist">暂无告警。</p>
      <table v-else-if="rows.length" class="data-table">
        <thead>
          <tr><th>等级</th><th>状态</th><th>原因</th><th>认领人</th><th>棚区</th><th>标题</th><th>时间</th><th></th></tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.id"
            :ref="(el) => bindRow(row.id, el)"
            :data-alert-id="row.id"
            :data-highlight="row.id === highlightId ? 'true' : undefined"
          >
            <td>{{ ALERT_LEVEL_LABEL[row.level] }}</td>
            <td>
              {{ ALERT_STATUS_LABEL[row.status] }}
              <span v-if="row.claimedBy && row.status !== 'closed'"> · 已认领</span>
            </td>
            <td>{{ reasonLabel(row) }}</td>
            <td>{{ row.claimedBy || '—' }}</td>
            <td>{{ row.shedCode }}</td>
            <td>
              <router-link
                class="text-accent"
                :to="`/alerts/${row.id}`"
                data-testid="alert-detail-link"
              >{{ row.title }}</router-link>
              <p class="text-xs text-mist">{{ row.message }}</p>
              <p v-if="row.claimNote" class="text-xs text-mist">认领备注 {{ row.claimNote }}</p>
              <p v-if="row.closeNote" class="text-xs text-mist">关闭备注 {{ row.closeNote }}</p>
            </td>
            <td class="font-mono text-xs">{{ new Date(row.createdAt).toLocaleString('zh-CN') }}</td>
            <td class="space-x-2 whitespace-nowrap" v-if="canOperate(currentUser?.role)">
              <button v-if="row.status === 'open'" class="btn-ghost" type="button" @click="act(row.id, 'ack')">确认</button>
              <button v-if="row.status !== 'closed'" class="btn-ghost" type="button" @click="act(row.id, 'claim')">认领</button>
              <button v-if="row.status !== 'closed'" class="btn-ghost" type="button" @click="act(row.id, 'close')">关闭</button>
              <button
                v-if="row.status !== 'closed'"
                class="btn-ghost"
                type="button"
                :disabled="!note.trim()"
                @click="act(row.id, 'false-positive')"
              >误报关闭</button>
            </td>
            <td v-else></td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
tr[data-highlight='true'] {
  background: #fff7e6;
  outline: 2px solid #f59e0b;
  outline-offset: -2px;
}
</style>
