<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { errorText, http } from '../api';

interface BackupStatus {
  lastSuccessAt: string | null;
  lastRunAt: string | null;
  lastStatus: 'success' | 'failed' | 'never';
  lastFileName: string | null;
  lastBytes: number | null;
  lastError: string | null;
  triggeredBy: string | null;
}

const STATUS_LABEL = {
  success: '成功',
  failed: '失败',
  never: '尚未运行',
} as const;

const status = ref<BackupStatus | null>(null);
const loadError = ref('');
const actionError = ref('');
const notice = ref('');
const loading = ref(true);
const running = ref(false);
const highlighted = ref(false);

function formatTime(value: string | null) {
  if (!value) return '';
  return new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

function successText(row: BackupStatus) {
  return row.lastSuccessAt ? formatTime(row.lastSuccessAt) : '尚未成功备份';
}

function apply(row: BackupStatus, fromRun: boolean) {
  status.value = row;
  highlighted.value = fromRun;
  if (!fromRun) {
    notice.value = '';
    return;
  }
  const time = successText(row);
  notice.value =
    row.lastStatus === 'success'
      ? `本次备份成功。最近成功时间是 ${time}。`
      : `本次备份失败。最近成功时间仍是 ${time}。`;
}

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    const response = await http.get<BackupStatus>('/backups/status');
    apply(response.data, false);
  } catch (cause) {
    status.value = null;
    loadError.value = errorText(cause);
  } finally {
    loading.value = false;
  }
}

async function runBackup() {
  actionError.value = '';
  notice.value = '';
  running.value = true;
  try {
    const response = await http.post<BackupStatus>('/backups/run');
    apply(response.data, true);
  } catch (cause) {
    actionError.value = errorText(cause);
  } finally {
    running.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section class="panel space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg">数据备份</h2>
      <button
        class="btn-primary"
        type="button"
        data-testid="backup-run"
        :disabled="running || loading"
        @click="runBackup"
      >
        {{ running ? '备份中…' : '立即备份' }}
      </button>
    </div>
    <p class="text-sm text-mist">只记录 PostgreSQL 逻辑备份。Redis 和对象存储不在这份文件里。</p>
    <p v-if="notice" class="text-sm" data-testid="backup-notice">{{ notice }}</p>
    <p v-if="actionError" class="text-sm text-danger" data-testid="backup-action-error">{{ actionError }}</p>
    <p v-if="loading" class="text-mist">加载中…</p>
    <p v-else-if="loadError" class="text-danger">{{ loadError }}</p>
    <dl v-else-if="status" class="grid gap-3 text-sm md:grid-cols-2" :data-highlight="highlighted ? 'true' : undefined">
      <div>
        <dt class="text-mist">最近成功</dt>
        <dd
          class="font-mono"
          data-field="lastSuccessAt"
          :data-at="status.lastSuccessAt ?? ''"
          :class="status.lastSuccessAt ? 'font-medium text-accent' : 'text-mist'"
        >
          {{ successText(status) }}
        </dd>
      </div>
      <div>
        <dt class="text-mist">最近一次</dt>
        <dd
          data-field="lastStatus"
          :data-status="status.lastStatus"
          :class="status.lastStatus === 'success' ? 'font-medium text-accent' : status.lastStatus === 'failed' ? 'font-medium text-danger' : 'text-mist'"
        >
          {{ STATUS_LABEL[status.lastStatus] }}
          <span v-if="status.lastRunAt" class="font-mono">{{ formatTime(status.lastRunAt) }}</span>
        </dd>
      </div>
      <div>
        <dt class="text-mist">文件</dt>
        <dd class="font-mono" data-field="lastFileName">{{ status.lastFileName || '—' }}</dd>
      </div>
      <div>
        <dt class="text-mist">大小</dt>
        <dd data-field="lastBytes">{{ status.lastBytes == null ? '—' : `${status.lastBytes} 字节` }}</dd>
      </div>
      <div>
        <dt class="text-mist">触发人</dt>
        <dd data-field="triggeredBy">{{ status.triggeredBy || '—' }}</dd>
      </div>
      <div v-if="status.lastError">
        <dt class="text-mist">失败说明</dt>
        <dd class="text-danger" data-field="lastError">{{ status.lastError }}</dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
dl[data-highlight='true'] {
  background: #fff7e6;
  outline: 2px solid #f59e0b;
  outline-offset: 6px;
}
</style>
