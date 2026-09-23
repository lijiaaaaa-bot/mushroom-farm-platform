<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  ALERT_LEVEL_LABEL,
  ALERT_STATUS_LABEL,
  alertLevelSchema,
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
const levels = alertLevelSchema.options;

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const response = await http.get<{ items: AlertRow[] }>('/alerts?pageSize=50');
    rows.value = response.data.items;
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
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

async function act(id: string, action: 'ack' | 'close') {
  error.value = '';
  try {
    await http.post(`/alerts/${id}/${action}`, { note: note.value });
    await load();
  } catch (cause) {
    error.value = errorText(cause);
  }
}

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <form v-if="canOperate(currentUser?.role)" class="panel grid gap-3 md:grid-cols-6" @submit.prevent="createAlert">
      <input v-model="form.shedCode" class="field" placeholder="棚区" />
      <input v-model="form.cameraCode" class="field" placeholder="摄像头" />
      <select v-model="form.level" class="field">
        <option v-for="level in levels" :key="level" :value="level">{{ ALERT_LEVEL_LABEL[level] }}</option>
      </select>
      <input v-model="form.title" class="field md:col-span-2" placeholder="标题" required />
      <button class="btn-primary" type="submit">新建告警</button>
      <textarea v-model="form.message" class="field md:col-span-5" placeholder="说明" required />
      <input v-model="note" class="field" placeholder="确认/关闭备注" />
    </form>
    <p v-if="error" class="text-sm text-red-300">{{ error }}</p>
    <section class="panel overflow-x-auto">
      <p v-if="loading" class="text-mist">加载中…</p>
      <p v-else-if="!rows.length" class="text-mist">暂无告警。</p>
      <table v-else class="data-table">
        <thead>
          <tr><th>等级</th><th>状态</th><th>棚区</th><th>标题</th><th>时间</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td>{{ ALERT_LEVEL_LABEL[row.level] }}</td>
            <td>{{ ALERT_STATUS_LABEL[row.status] }}</td>
            <td>{{ row.shedCode }}</td>
            <td>{{ row.title }}<p class="text-xs text-mist">{{ row.message }}</p></td>
            <td class="font-mono text-xs">{{ new Date(row.createdAt).toLocaleString('zh-CN') }}</td>
            <td class="space-x-2 whitespace-nowrap" v-if="canOperate(currentUser?.role)">
              <button v-if="row.status === 'open'" class="btn-ghost" type="button" @click="act(row.id, 'ack')">确认</button>
              <button v-if="row.status !== 'closed'" class="btn-ghost" type="button" @click="act(row.id, 'close')">关闭</button>
            </td>
            <td v-else></td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
