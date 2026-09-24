<script setup lang="ts">
import { ref } from 'vue';
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
const preview = ref<Preview | null>(null);
const previewError = ref('');

function params() {
  return {
    kind: kind.value,
    grain: kind.value === 'growth' ? grain.value : undefined,
    from: from.value || undefined,
    to: to.value || undefined,
    shedCode: shedCode.value || undefined,
  };
}

async function loadPreview() {
  previewError.value = '';
  emptyNote.value = '';
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
  } catch (cause) {
    error.value = errorText(cause);
  }
}
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
            <td v-for="column in preview.columns" :key="column.key">{{ row[column.key] ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
