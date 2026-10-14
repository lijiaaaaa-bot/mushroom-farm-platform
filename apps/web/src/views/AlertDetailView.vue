<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  ALERT_CLOSE_REASON_LABEL,
  ALERT_LEVEL_LABEL,
  ALERT_METRIC_LABEL,
  ALERT_STATUS_LABEL,
  alertLevelSchema,
  alertStatusSchema,
  isAlertMetric,
  type AlertCloseReason,
  type AlertLevel,
  type AlertMetric,
  type AlertStatus,
} from '@mushroom/contracts';
import { canOperate, currentUser } from '../auth';
import { errorText, http } from '../api';

interface AlertDetail {
  id: string;
  shedCode: string;
  cameraCode: string | null;
  sensorCode?: string | null;
  level: AlertLevel;
  status: AlertStatus;
  title: string;
  message: string;
  metric: string | null;
  metricValue: number | null;
  threshold: number | null;
  createdAt: string;
  claimedBy: string | null;
  claimedAt?: string | null;
  claimNote: string | null;
  ackedBy?: string | null;
  ackedAt?: string | null;
  ackNote: string | null;
  closeReason: AlertCloseReason | null;
  closedBy?: string | null;
  closedAt?: string | null;
  closeNote: string | null;
  recognitionId?: string | null;
  snapshotObjectKey?: string | null;
}

const route = useRoute();
const row = ref<AlertDetail | null>(null);
const loading = ref(true);
const error = ref('');
const actionError = ref('');
const handleNote = ref('');
const snapshotUrl = ref('');
const snapshotError = ref('');
let snapshotTicket = 0;

const alertId = computed(() => {
  const value = route.params.id;
  return typeof value === 'string' ? value : '';
});

function plainQuery(key: string) {
  const value = route.query[key];
  return typeof value === 'string' ? value.trim() : '';
}

function allowedQuery(key: string, options: readonly string[]) {
  const value = plainQuery(key);
  return options.includes(value) ? value : '';
}

function instantQuery(key: string) {
  const value = plainQuery(key);
  if (!value || Number.isNaN(new Date(value).getTime())) return '';
  return new Date(value).toISOString();
}

const listReturn = computed(() => {
  const query: Record<string, string> = {};
  const status = allowedQuery('status', alertStatusSchema.options);
  const level = allowedQuery('level', alertLevelSchema.options);
  const shed = plainQuery('shedCode');
  const camera = plainQuery('cameraCode');
  const keyword = plainQuery('q');
  const from = instantQuery('from');
  const to = instantQuery('to');
  if (status) query.status = status;
  if (level) query.level = level;
  if (shed) query.shedCode = shed;
  if (camera) query.cameraCode = camera;
  if (keyword) query.q = keyword;
  if (from) query.from = from;
  if (to) query.to = to;
  if (!Object.keys(query).length) return '/alerts';
  return { path: '/alerts', query };
});

function metricOf(value: string | null): AlertMetric | null {
  return value && isAlertMetric(value) ? value : null;
}

function quantity(metric: string | null, value: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const known = metricOf(metric);
  if (known === 'mature_ratio') return `${Math.round(value * 100)}%`;
  if (known === 'temperature_high' || known === 'temperature_low') return `${value}℃`;
  if (
    known === 'humidity_high' ||
    known === 'humidity_low' ||
    known === 'substrate_moisture_low'
  ) {
    return `${value}%`;
  }
  if (known === 'co2_high') return `${value} ppm`;
  return String(value);
}

function handlingText(current: AlertDetail): string {
  if (current.status === 'closed') return (current.closeNote || '').trim();
  if (current.status === 'acked') return (current.ackNote || '').trim();
  return '';
}

function shanghaiStamp(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return '—';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(parsed));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')} ${read('hour')}:${read('minute')}`;
}

const fields = computed(() => {
  const current = row.value;
  if (!current) return [];
  const metric = metricOf(current.metric);
  return [
    { key: 'title', label: '标题', value: current.title },
    { key: 'message', label: '说明', value: current.message },
    { key: 'level', label: '级别', value: ALERT_LEVEL_LABEL[current.level] },
    { key: 'status', label: '状态', value: ALERT_STATUS_LABEL[current.status] },
    ...(handlingText(current)
      ? [{ key: 'handleNote', label: '处理说明', value: handlingText(current) }]
      : []),
    { key: 'shed', label: '棚区', value: current.shedCode },
    { key: 'camera', label: '摄像头', value: current.cameraCode || '—' },
    ...(current.sensorCode
      ? [{ key: 'sensor', label: '传感器', value: current.sensorCode }]
      : []),
    { key: 'time', label: '发生时间', value: shanghaiStamp(current.createdAt) },
    { key: 'metric', label: '指标', value: metric ? ALERT_METRIC_LABEL[metric] : '—' },
    { key: 'value', label: '当前值', value: quantity(current.metric, current.metricValue) },
    { key: 'threshold', label: '阈值', value: quantity(current.metric, current.threshold) },
    { key: 'claimedBy', label: '认领人', value: current.claimedBy || '—' },
    { key: 'claimedAt', label: '认领时间', value: shanghaiStamp(current.claimedAt) },
    { key: 'ackedBy', label: '确认人', value: current.ackedBy || '—' },
    { key: 'ackedAt', label: '确认时间', value: shanghaiStamp(current.ackedAt) },
    {
      key: 'closeReason',
      label: '关闭原因',
      value: current.closeReason ? ALERT_CLOSE_REASON_LABEL[current.closeReason] : '—',
    },
    { key: 'closedBy', label: '关闭人', value: current.closedBy || '—' },
    { key: 'closedAt', label: '关闭时间', value: shanghaiStamp(current.closedAt) },
    ...(current.claimNote ? [{ key: 'claimNote', label: '认领备注', value: current.claimNote }] : []),
    ...(current.ackNote ? [{ key: 'ackNote', label: '确认备注', value: current.ackNote }] : []),
    ...(current.closeNote ? [{ key: 'closeNote', label: '关闭备注', value: current.closeNote }] : []),
  ];
});

async function act(action: 'ack' | 'close') {
  const id = row.value?.id;
  if (!id) return;
  const note = handleNote.value.trim();
  if (!note) {
    actionError.value = '请填写处理说明';
    return;
  }
  actionError.value = '';
  try {
    await http.post(`/alerts/${id}/${action}`, { note });
    await load();
  } catch (cause) {
    actionError.value = errorText(cause);
  }
}

function clearSnapshot() {
  if (snapshotUrl.value) URL.revokeObjectURL(snapshotUrl.value);
  snapshotUrl.value = '';
  snapshotError.value = '';
}

async function loadSnapshot(current: AlertDetail) {
  const ticket = ++snapshotTicket;
  clearSnapshot();
  if (!current.snapshotObjectKey) return;
  try {
    const response = await http.get<Blob>(`/alerts/${current.id}/snapshot`, {
      responseType: 'blob',
    });
    if (ticket !== snapshotTicket) return;
    if (!response.data || response.data.size === 0) {
      snapshotError.value = '抓拍不可用';
      return;
    }
    snapshotUrl.value = URL.createObjectURL(response.data);
  } catch (cause) {
    if (ticket !== snapshotTicket) return;
    snapshotError.value = errorText(cause);
  }
}

async function load() {
  const id = alertId.value;
  snapshotTicket += 1;
  clearSnapshot();
  loading.value = true;
  error.value = '';
  actionError.value = '';
  row.value = null;
  if (!id) {
    error.value = '告警不存在';
    loading.value = false;
    return;
  }
  try {
    const response = await http.get<AlertDetail>(`/alerts/${id}`);
    row.value = response.data;
    await loadSnapshot(response.data);
  } catch (cause) {
    error.value = errorText(cause);
    row.value = null;
  } finally {
    loading.value = false;
  }
}

watch(alertId, () => {
  handleNote.value = '';
  void load();
}, { immediate: true });

onBeforeUnmount(() => {
  snapshotTicket += 1;
  clearSnapshot();
});
</script>

<template>
  <div class="ops-page space-y-4">
    <p class="text-sm">
      <router-link class="text-accent" :to="listReturn" data-testid="alert-back">返回告警列表</router-link>
    </p>
    <p v-if="loading" class="text-mist">加载中…</p>
    <p v-else-if="error" class="text-sm text-danger" data-testid="alert-detail-error">{{ error }}</p>
    <section v-else-if="row" class="panel" data-testid="alert-detail">
      <h1 class="mb-3 text-base font-semibold">{{ row.title }}</h1>
      <figure v-if="row.snapshotObjectKey" class="snapshot" data-testid="alert-snapshot">
        <img
          v-if="snapshotUrl"
          :src="snapshotUrl"
          alt="抓拍"
          data-testid="alert-snapshot-image"
        />
        <p v-else-if="snapshotError" class="text-sm text-danger" data-testid="alert-snapshot-error">{{ snapshotError }}</p>
        <p v-else class="text-sm text-mist" data-testid="alert-snapshot-pending">加载中…</p>
        <a
          v-if="snapshotUrl"
          class="text-accent"
          :href="snapshotUrl"
          target="_blank"
          rel="noopener"
          data-testid="alert-snapshot-link"
        >打开抓拍</a>
        <p class="key" data-testid="alert-snapshot-key">{{ row.snapshotObjectKey }}</p>
      </figure>
      <dl class="detail">
        <div v-for="field in fields" :key="field.key">
          <dt>{{ field.label }}</dt>
          <dd :data-field="field.key">{{ field.value }}</dd>
        </div>
      </dl>
      <p v-if="actionError" class="mt-3 text-sm text-danger" data-testid="alert-action-error">{{ actionError }}</p>
      <div
        v-if="canOperate(currentUser?.role) && row.status !== 'closed'"
        class="mt-4 space-y-3"
        data-testid="alert-actions"
      >
        <label class="block text-sm">
          处理说明
          <textarea
            v-model="handleNote"
            class="field mt-1 w-full"
            rows="2"
            maxlength="500"
            placeholder="填写本次确认或关闭的说明"
            data-testid="alert-handle-note"
          />
        </label>
        <div class="flex flex-wrap gap-2">
          <button
            v-if="row.status === 'open'"
            class="btn-ghost"
            type="button"
            data-testid="alert-ack"
            :disabled="!handleNote.trim()"
            @click="act('ack')"
          >确认</button>
          <button
            class="btn-ghost"
            type="button"
            data-testid="alert-close"
            :disabled="!handleNote.trim()"
            @click="act('close')"
          >关闭</button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.detail {
  display: grid;
  gap: 12px 24px;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  margin: 0;
}
.detail div:first-child,
.detail div:nth-child(2) {
  grid-column: 1 / -1;
}
dt {
  color: var(--text-secondary);
  font-size: 12px;
}
dd {
  margin: 2px 0 0;
  white-space: pre-wrap;
}
.snapshot {
  margin: 0 0 16px;
}
.snapshot img {
  display: block;
  max-width: 240px;
  max-height: 180px;
  border: 1px solid #e5e6eb;
  border-radius: 8px;
  background: #fff;
}
.snapshot a {
  display: inline-block;
  margin-top: 8px;
  font-size: 13px;
}
.key {
  margin: 8px 0 0;
  color: var(--text-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  word-break: break-all;
}
</style>
