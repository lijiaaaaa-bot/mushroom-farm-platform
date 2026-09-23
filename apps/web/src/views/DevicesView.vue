<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { DEVICE_TYPE_LABEL, type DeviceType } from '@mushroom/contracts';
import { canImportDevices, currentUser } from '../auth';
import { errorText, http } from '../api';

interface DeviceRow {
  id: string;
  code: string;
  name: string;
  type: DeviceType;
  shedCode: string;
  onlineStatus: string;
  lastSeenAt: string | null;
  lastHeartbeatAt?: string | null;
}

interface ImportMessage {
  row: number;
  reason: string;
}

interface ImportReport {
  successCount: number;
  failCount: number;
  skippedCount: number;
  errors: ImportMessage[];
  skipped: ImportMessage[];
}

const rows = ref<DeviceRow[]>([]);
const loading = ref(true);
const error = ref('');
const csvText = ref('');
const file = ref<File | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const importing = ref(false);
const report = ref<ImportReport | null>(null);
const canImport = computed(() => canImportDevices(currentUser.value?.role));

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const response = await http.get<{ items: DeviceRow[] }>('/devices?pageSize=100');
    rows.value = response.data.items;
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
}

function onFile(event: Event) {
  const input = event.target as HTMLInputElement;
  file.value = input.files?.[0] ?? null;
}

function clearFile() {
  file.value = null;
  if (fileInput.value) fileInput.value.value = '';
}

async function submitImport() {
  error.value = '';
  if (!file.value && !csvText.value.trim()) {
    error.value = '请选择 CSV 文件或粘贴内容';
    return;
  }
  importing.value = true;
  try {
    const response = file.value
      ? await http.post<ImportReport>('/devices/import', fileBody(file.value))
      : await http.post<ImportReport>('/devices/import', { csv: csvText.value });
    report.value = response.data;
    csvText.value = '';
    clearFile();
    await load();
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    importing.value = false;
  }
}

function fileBody(selected: File) {
  const body = new FormData();
  body.append('file', selected);
  return body;
}

function heartbeatText(row: DeviceRow): string {
  const value = row.lastHeartbeatAt || row.lastSeenAt;
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

onMounted(load);
</script>

<template>
  <div class="ops-page space-y-4">
    <section class="panel space-y-3">
      <h2 class="text-lg">批量导入</h2>
      <p v-if="canImport" class="text-sm text-mist">
        表头需包含设备编码、棚编码、名称。未填类型时记为摄像头。已存在的设备编码会跳过，不覆盖原档案。失败行号按数据行计算，不含表头。选择文件时以文件为准。
      </p>
      <p v-else class="text-sm text-mist">当前角色不能批量导入设备。</p>
      <form v-if="canImport" class="grid gap-3" @submit.prevent="submitImport">
        <input
          ref="fileInput"
          class="text-sm"
          type="file"
          accept=".csv,text/csv"
          aria-label="CSV 文件"
          @change="onFile"
        />
        <textarea
          v-model="csvText"
          class="field min-h-28 font-mono"
          aria-label="粘贴 CSV"
          placeholder="或粘贴 CSV"
        />
        <button class="btn-primary w-fit" type="submit" :disabled="importing">
          {{ importing ? '导入中…' : '导入' }}
        </button>
      </form>
      <p v-if="report" data-testid="import-report">
        成功 {{ report.successCount }}，失败 {{ report.failCount }}，跳过 {{ report.skippedCount }}
      </p>
      <ul v-if="report?.errors.length" class="space-y-1 text-sm text-danger">
        <li v-for="item in report.errors" :key="`e-${item.row}-${item.reason}`">
          第 {{ item.row }} 行：{{ item.reason }}
        </li>
      </ul>
      <ul v-if="report?.skipped.length" class="space-y-1 text-sm text-mist">
        <li v-for="item in report.skipped" :key="`s-${item.row}-${item.reason}`">
          第 {{ item.row }} 行：{{ item.reason }}
        </li>
      </ul>
    </section>
    <section class="panel overflow-x-auto">
      <h2 class="mb-3 text-lg">摄像头 / AI 盒 / 传感器</h2>
      <p v-if="loading" class="text-mist">加载中…</p>
      <p v-else-if="error" class="text-danger">{{ error }}</p>
      <p v-else-if="!rows.length" class="text-mist">暂无设备。识别上报会自动建档。</p>
      <table v-else class="data-table">
        <thead>
          <tr><th>编号</th><th>名称</th><th>类型</th><th>棚区</th><th>状态</th><th>最近心跳</th></tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td class="font-mono">{{ row.code }}</td>
            <td>{{ row.name }}</td>
            <td>{{ DEVICE_TYPE_LABEL[row.type] }}</td>
            <td>{{ row.shedCode }}</td>
            <td>
              <span
                class="inline-flex rounded-lg bg-canvas px-2 py-0.5"
                :class="row.onlineStatus === 'online' ? 'text-accent' : 'text-mist'"
              >{{ row.onlineStatus === 'online' ? '在线' : '离线' }}</span>
            </td>
            <td class="font-mono text-xs">{{ heartbeatText(row) }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
