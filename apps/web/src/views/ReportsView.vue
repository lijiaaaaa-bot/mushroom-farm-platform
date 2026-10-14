<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  ALERT_CLOSE_REASON_LABEL,
  ALERT_LEVEL_LABEL,
  ALERT_STATUS_LABEL,
  alertStatusSchema,
} from '@mushroom/contracts';
import { errorText, http } from '../api';

interface PreviewColumn {
  key: string;
  header: string;
}

interface Preview {
  title: string;
  columns: PreviewColumn[];
  rows: Record<string, string | number | null>[];
}

const error = ref('');
const emptyNote = ref('');
const files = [
  ['growth.xlsx', '生长'],
  ['disease.xlsx', '病害'],
  ['env.xlsx', '环境'],
  ['devices.xlsx', '设备'],
  ['alerts.xlsx', '告警'],
] as const;

const kinds = [
  ['growth', '园区生长'],
  ['yield', '分棚产量与品质'],
  ['disease', '病害统计'],
  ['environment', '环境监控'],
  ['devices', '设备在线台账'],
  ['alerts', '告警闭环台账'],
] as const;

const kind = ref<(typeof kinds)[number][0]>('growth');
const grain = ref('day');
const from = ref('');
const to = ref('');
const shedCode = ref('');
const online = ref('');
const alertStatus = ref('');
const alertStatuses = alertStatusSchema.options;
const preview = ref<Preview | null>(null);
const previewError = ref('');
const downloadNote = ref('');

function cellText(key: string, value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '—';
  if (key === 'status' && typeof value === 'string' && value in ALERT_STATUS_LABEL) {
    return ALERT_STATUS_LABEL[value as keyof typeof ALERT_STATUS_LABEL];
  }
  if (key === 'level' && typeof value === 'string' && value in ALERT_LEVEL_LABEL) {
    return ALERT_LEVEL_LABEL[value as keyof typeof ALERT_LEVEL_LABEL];
  }
  if (key === 'closeReason' && typeof value === 'string' && value in ALERT_CLOSE_REASON_LABEL) {
    return ALERT_CLOSE_REASON_LABEL[value as keyof typeof ALERT_CLOSE_REASON_LABEL];
  }
  return String(value);
}

function queryText(search: URLSearchParams, key: string) {
  return search.get(key)?.trim() || '';
}

function applySearch(search: URLSearchParams) {
  const kindValue = queryText(search, 'kind');
  const known = kinds.find(([value]) => value === kindValue);
  if (!known) return false;
  kind.value = known[0];
  const grainValue = queryText(search, 'grain');
  if (grainValue === 'day' || grainValue === 'week' || grainValue === 'month') {
    grain.value = grainValue;
  }
  const fromValue = queryText(search, 'from');
  const toValue = queryText(search, 'to');
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromValue)) from.value = fromValue;
  if (/^\d{4}-\d{2}-\d{2}$/.test(toValue)) to.value = toValue;
  shedCode.value = queryText(search, 'shedCode');
  const onlineValue = queryText(search, 'online');
  online.value = onlineValue === 'online' || onlineValue === 'offline' ? onlineValue : '';
  const statusValue = queryText(search, 'status');
  alertStatus.value = (alertStatuses as readonly string[]).includes(statusValue) ? statusValue : '';
  return true;
}

function syncAddress() {
  const url = new URL(window.location.href);
  url.pathname = '/reports';
  url.search = '';
  for (const [key, value] of Object.entries(params())) {
    if (value) url.searchParams.set(key, String(value));
  }
  window.history.replaceState({}, '', `${url.pathname}${url.search}`);
}

function params() {
  return {
    kind: kind.value,
    grain: kind.value === 'growth' ? grain.value : undefined,
    from: from.value || undefined,
    to: to.value || undefined,
    shedCode: shedCode.value || undefined,
    online: kind.value === 'devices' && online.value ? online.value : undefined,
    status: kind.value === 'alerts' && alertStatus.value ? alertStatus.value : undefined,
  };
}

async function loadPreview() {
  previewError.value = '';
  emptyNote.value = '';
  downloadNote.value = '';
  syncAddress();
  try {
    const response = await http.get<Preview>('/reports/preview', { params: params() });
    preview.value = response.data;
  } catch (cause) {
    preview.value = null;
    previewError.value = errorText(cause);
  }
}

async function exportPreview() {
  previewError.value = '';
  emptyNote.value = '';
  downloadNote.value = '';
  syncAddress();
  try {
    const response = await http.get<Blob>('/reports/export.xlsx', {
      params: params(),
      responseType: 'blob',
    });
    const blob = response.data;
    if (!blob || blob.size === 0) {
      emptyNote.value = '该报表没有可导出的数据。';
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${kind.value}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
    downloadNote.value = `已开始下载 ${kind.value}.xlsx`;
  } catch (cause) {
    previewError.value = errorText(cause);
  }
}

function printPreview() {
  window.print();
}

async function download(path: string) {
  error.value = '';
  emptyNote.value = '';
  downloadNote.value = '';
  try {
    const response = await http.get<Blob>(`/reports/${path}`, { responseType: 'blob' });
    const blob = response.data;
    if (!blob || blob.size === 0) {
      emptyNote.value = '该报表没有可导出的数据。';
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = path;
    link.click();
    URL.revokeObjectURL(url);
    downloadNote.value = `已开始下载 ${path}`;
  } catch (cause) {
    error.value = errorText(cause);
  }
}

onMounted(() => {
  const search = new URLSearchParams(window.location.search);
  if (!applySearch(search)) return;
  void loadPreview();
});
</script>

<template>
  <section class="panel space-y-3">
    <h2 class="text-lg">Excel 报表</h2>
    <p class="text-sm text-mist">生长、病害、环境默认导出近 7 日识别记录；设备与告警导出当前可见范围。</p>
    <div class="flex flex-wrap gap-2">
      <button v-for="[file, label] in files" :key="file" class="btn-primary" type="button" @click="download(file)">
        下载{{ label }}
      </button>
    </div>
    <p v-if="downloadNote" class="text-sm text-mist" data-testid="report-download">{{ downloadNote }}</p>
    <p v-if="emptyNote" class="text-sm text-mist">{{ emptyNote }}</p>
    <p v-if="error" class="text-sm text-danger">{{ error }}</p>
    <form class="grid gap-3 border-t border-line pt-3 sm:grid-cols-3" data-testid="report-filters" @submit.prevent="loadPreview">
      <label class="text-sm">报表
        <select v-model="kind" class="field mt-1">
          <option v-for="[value, label] in kinds" :key="value" :value="value">{{ label }}</option>
        </select>
      </label>
      <label v-if="kind === 'growth'" class="text-sm">粒度
        <select v-model="grain" class="field mt-1">
          <option value="day">日</option>
          <option value="week">周</option>
          <option value="month">月</option>
        </select>
      </label>
      <label v-if="kind === 'devices'" class="text-sm">在线
        <select v-model="online" class="field mt-1" data-testid="report-online">
          <option value="">全部</option>
          <option value="online">在线</option>
          <option value="offline">离线</option>
        </select>
      </label>
      <label v-if="kind === 'alerts'" class="text-sm">状态
        <select v-model="alertStatus" class="field mt-1" data-testid="report-status">
          <option value="">全部</option>
          <option v-for="value in alertStatuses" :key="value" :value="value">{{ ALERT_STATUS_LABEL[value] }}</option>
        </select>
      </label>
      <label class="text-sm">棚区
        <input v-model="shedCode" class="field mt-1" placeholder="全部可见棚" />
      </label>
      <label class="text-sm">从
        <input v-model="from" class="field mt-1" type="date" />
      </label>
      <label class="text-sm">到
        <input v-model="to" class="field mt-1" type="date" />
      </label>
      <div class="flex flex-wrap items-end gap-2">
        <button class="btn-primary" type="submit">预览</button>
        <button class="btn-ghost" type="button" @click="exportPreview">导出</button>
        <button class="btn-ghost" type="button" @click="printPreview">打印</button>
      </div>
    </form>
    <p v-if="previewError" class="text-sm text-danger">{{ previewError }}</p>
    <div v-if="preview" data-testid="report-preview">
      <h3 class="text-base">{{ preview.title }}</h3>
      <p v-if="!preview.rows.length" class="text-sm text-mist">该筛选下没有数据。</p>
      <table v-else class="data-table">
        <thead>
          <tr>
            <th v-for="column in preview.columns" :key="column.key">{{ column.header }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in preview.rows" :key="index">
            <td v-for="column in preview.columns" :key="column.key">{{ cellText(column.key, row[column.key]) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
