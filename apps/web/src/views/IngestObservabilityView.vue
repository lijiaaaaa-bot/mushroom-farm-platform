<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { errorText, http } from '../api';

interface ChannelRow {
  channel: 'recognition' | 'environment' | 'heartbeat';
  transport: 'http' | 'mqtt';
  accepted: number;
  rejected: number;
  latencyP50Ms: number | null;
  latencyLatestMs: number | null;
}

interface ErrorRow {
  id: string;
  channel: 'recognition' | 'environment' | 'heartbeat';
  transport: 'http' | 'mqtt';
  shedCode: string | null;
  code: string | null;
  errors: string[];
  createdAt: string;
}

interface Summary {
  windowMinutes: number;
  accepted: number;
  rejected: number;
  latencyP50Ms: number | null;
  latencyLatestMs: number | null;
  channels: ChannelRow[];
  recentErrors: ErrorRow[];
}

const loading = ref(true);
const error = ref('');
const summary = ref<Summary | null>(null);

const channelName: Record<ChannelRow['channel'], string> = {
  recognition: '识别',
  environment: '环境',
  heartbeat: '心跳',
};

onMounted(async () => {
  try {
    const response = await http.get<Summary>('/ingest/observability');
    summary.value = response.data;
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
});

function latency(value: number | null) {
  return value === null || value === undefined ? '—' : `${value} ms`;
}

function label(row: { channel: ChannelRow['channel']; transport: string }) {
  const via = row.transport === 'mqtt' ? 'MQTT' : 'HTTP';
  return `${channelName[row.channel]} ${via}`;
}
</script>

<template>
  <div class="ops-page space-y-4 bg-canvas">
    <p v-if="loading" class="text-mist">加载中…</p>
    <p v-else-if="error" class="text-danger">{{ error }}</p>
    <template v-else-if="summary">
      <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article class="panel bg-white">
          <p class="text-mist">近 {{ summary.windowMinutes }} 分钟接收</p>
          <p class="font-mono text-3xl text-accent">{{ summary.accepted }}</p>
        </article>
        <article class="panel bg-white">
          <p class="text-mist">近 {{ summary.windowMinutes }} 分钟拒收</p>
          <p class="font-mono text-3xl text-accent">{{ summary.rejected }}</p>
        </article>
        <article class="panel bg-white">
          <p class="text-mist">延迟 p50</p>
          <p class="font-mono text-3xl text-accent">{{ latency(summary.latencyP50Ms) }}</p>
        </article>
        <article class="panel bg-white">
          <p class="text-mist">最近延迟</p>
          <p class="font-mono text-3xl text-accent">{{ latency(summary.latencyLatestMs) }}</p>
        </article>
      </section>
      <section class="panel overflow-x-auto bg-white">
        <h2 class="mb-3 text-lg">分通道</h2>
        <table class="data-table">
          <thead>
            <tr>
              <th>通道</th>
              <th>接收</th>
              <th>拒收</th>
              <th>延迟 p50</th>
              <th>最近延迟</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in summary.channels" :key="`${row.channel}-${row.transport}`">
              <td>{{ label(row) }}</td>
              <td class="font-mono text-accent">{{ row.accepted }}</td>
              <td class="font-mono">{{ row.rejected }}</td>
              <td class="font-mono">{{ latency(row.latencyP50Ms) }}</td>
              <td class="font-mono">{{ latency(row.latencyLatestMs) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <section class="panel overflow-x-auto bg-white" data-test="recent-errors">
        <h2 class="mb-3 text-lg">最近错误</h2>
        <p v-if="!summary.recentErrors.length" class="text-mist">近窗没有拒收。</p>
        <table v-else class="data-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>通道</th>
              <th>棚区</th>
              <th>错误</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in summary.recentErrors" :key="row.id">
              <td class="font-mono text-xs">{{ new Date(row.createdAt).toLocaleString('zh-CN') }}</td>
              <td>{{ label(row) }}</td>
              <td>{{ row.shedCode || '—' }}</td>
              <td class="text-danger">{{ row.errors.join('；') }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>
