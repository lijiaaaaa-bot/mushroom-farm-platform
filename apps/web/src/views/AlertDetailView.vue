<script setup lang="ts">
import { computed, ref, watch } from 'vue';
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
  level: AlertLevel;
  status: AlertStatus;
  title: string;
  message: string;
  metric: string | null;
  metricValue: number | null;
  threshold: number | null;
  createdAt: string;
  claimedBy: string | null;
  claimNote: string | null;
  ackNote: string | null;
  closeReason: AlertCloseReason | null;
  closeNote: string | null;
}

const route = useRoute();
const row = ref<AlertDetail | null>(null);
const loading = ref(true);
const error = ref('');
const actionError = ref('');

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

const listReturn = computed(() => {
  const query: Record<string, string> = {};
  const status = allowedQuery('status', alertStatusSchema.options);
  const level = allowedQuery('level', alertLevelSchema.options);
  const shed = plainQuery('shedCode');
  const camera = plainQuery('cameraCode');
  const keyword = plainQuery('q');
  if (status) query.status = status;
  if (level) query.level = level;
  if (shed) query.shedCode = shed;
  if (camera) query.cameraCode = camera;
  if (keyword) query.q = keyword;
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
    { key: 'shed', label: '棚区', value: current.shedCode },
    { key: 'camera', label: '摄像头', value: current.cameraCode || '—' },
    { key: 'time', label: '发生时间', value: shanghaiStamp(current.createdAt) },
    { key: 'metric', label: '指标', value: metric ? ALERT_METRIC_LABEL[metric] : '—' },
    { key: 'value', label: '当前值', value: quantity(current.metric, current.metricValue) },
    { key: 'threshold', label: '阈值', value: quantity(current.metric, current.threshold) },
    { key: 'claimedBy', label: '认领人', value: current.claimedBy || '—' },
    {
      key: 'closeReason',
      label: '关闭原因',
      value: current.closeReason ? ALERT_CLOSE_REASON_LABEL[current.closeReason] : '—',
    },
    ...(current.claimNote ? [{ key: 'claimNote', label: '认领备注', value: current.claimNote }] : []),
    ...(current.ackNote ? [{ key: 'ackNote', label: '确认备注', value: current.ackNote }] : []),
    ...(current.closeNote ? [{ key: 'closeNote', label: '关闭备注', value: current.closeNote }] : []),
  ];
});

async function act(action: 'ack' | 'close') {
  const id = row.value?.id;
  if (!id) return;
  actionError.value = '';
  try {
    await http.post(`/alerts/${id}/${action}`, {
      note: action === 'ack' ? '已确认' : '已关闭',
    });
    await load();
  } catch (cause) {
    actionError.value = errorText(cause);
  }
}

async function load() {
  const id = alertId.value;
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
  } catch (cause) {
    error.value = errorText(cause);
    row.value = null;
  } finally {
    loading.value = false;
  }
}

watch(alertId, () => {
  void load();
}, { immediate: true });
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
      <dl class="detail">
        <div v-for="field in fields" :key="field.key">
          <dt>{{ field.label }}</dt>
          <dd :data-field="field.key">{{ field.value }}</dd>
        </div>
      </dl>
      <p v-if="actionError" class="mt-3 text-sm text-danger" data-testid="alert-action-error">{{ actionError }}</p>
      <div
        v-if="canOperate(currentUser?.role) && row.status !== 'closed'"
        class="mt-4 flex flex-wrap gap-2"
        data-testid="alert-actions"
      >
        <button
          v-if="row.status === 'open'"
          class="btn-ghost"
          type="button"
          data-testid="alert-ack"
          @click="act('ack')"
        >确认</button>
        <button class="btn-ghost" type="button" data-testid="alert-close" @click="act('close')">关闭</button>
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
</style>
