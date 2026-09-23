<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  ALERT_LEVEL_LABEL,
  ALERT_LEVELS,
  ALERT_METRIC_LABEL,
  ALERT_METRICS,
  type AlertLevel,
  type AlertMetric,
} from '@mushroom/contracts';
import { canWriteRules, currentUser } from '../auth';
import { errorText, http } from '../api';

interface Rule {
  id: string;
  name: string;
  metric: AlertMetric;
  threshold: number;
  level: AlertLevel;
  enabled: boolean;
  windowMinutes: number;
  shedCode: string | null;
}

interface EditableRule extends Rule {
  draftThreshold: number;
  draftLevel: AlertLevel;
  draftWindow: number;
}

const rows = ref<EditableRule[]>([]);
const error = ref('');
const loading = ref(true);
const metrics = ALERT_METRICS;
const levels = ALERT_LEVELS;
const canWrite = computed(() => canWriteRules(currentUser.value?.role));
const form = ref({
  name: '',
  metric: 'temperature_high' as AlertMetric,
  threshold: 30,
  level: 'warning' as AlertLevel,
  windowMinutes: 720,
});

function withDraft(rule: Rule): EditableRule {
  return {
    ...rule,
    draftThreshold: rule.threshold,
    draftLevel: rule.level,
    draftWindow: rule.windowMinutes,
  };
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const response = await http.get<Rule[]>('/alert-rules');
    rows.value = response.data.map(withDraft);
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
}

async function createRule() {
  error.value = '';
  try {
    await http.post('/alert-rules', {
      name: form.value.name.trim(),
      metric: form.value.metric,
      threshold: Number(form.value.threshold),
      level: form.value.level,
      windowMinutes: Number(form.value.windowMinutes),
    });
    form.value.name = '';
    await load();
  } catch (cause) {
    error.value = errorText(cause);
  }
}

async function patchRule(id: string, body: Record<string, unknown>) {
  error.value = '';
  try {
    await http.patch(`/alert-rules/${id}`, body);
    await load();
  } catch (cause) {
    error.value = errorText(cause);
  }
}

function saveRow(row: EditableRule) {
  return patchRule(row.id, {
    threshold: Number(row.draftThreshold),
    level: row.draftLevel,
    windowMinutes: Number(row.draftWindow),
  });
}

function toggleEnabled(row: EditableRule) {
  return patchRule(row.id, { enabled: !row.enabled });
}

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <form v-if="canWrite" class="panel grid gap-3 md:grid-cols-6" @submit.prevent="createRule">
      <input v-model="form.name" class="field md:col-span-2" placeholder="规则名称" required />
      <select v-model="form.metric" class="field" aria-label="指标">
        <option v-for="metric in metrics" :key="metric" :value="metric">{{ ALERT_METRIC_LABEL[metric] }}</option>
      </select>
      <input v-model.number="form.threshold" class="field" type="number" step="any" placeholder="阈值" aria-label="新建阈值" required />
      <select v-model="form.level" class="field" aria-label="等级">
        <option v-for="level in levels" :key="level" :value="level">{{ ALERT_LEVEL_LABEL[level] }}</option>
      </select>
      <input v-model.number="form.windowMinutes" class="field" type="number" min="1" step="1" placeholder="窗口分钟" aria-label="新建窗口分钟" required />
      <button class="btn-primary" type="submit">新建规则</button>
    </form>
    <p v-else class="text-sm text-mist">当前角色只能查看阈值规则。</p>
    <p v-if="error" class="text-sm text-danger">{{ error }}</p>
    <section class="panel overflow-x-auto">
      <h2 class="mb-3 text-lg">阈值规则</h2>
      <p v-if="loading && !rows.length" class="text-mist">加载中…</p>
      <p v-else-if="!loading && !error && !rows.length" class="text-mist">暂无阈值规则。</p>
      <table v-else-if="rows.length" class="data-table">
        <thead>
          <tr>
            <th>名称</th>
            <th>指标</th>
            <th>阈值</th>
            <th>等级</th>
            <th>窗口分钟</th>
            <th>启用</th>
            <th v-if="canWrite"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td>{{ row.name }}</td>
            <td>{{ ALERT_METRIC_LABEL[row.metric] }}</td>
            <td>
              <input
                v-if="canWrite"
                v-model.number="row.draftThreshold"
                class="field w-24"
                type="number"
                step="any"
                :aria-label="`${row.name} 阈值`"
              />
              <span v-else class="font-mono">{{ row.threshold }}</span>
            </td>
            <td>
              <select v-if="canWrite" v-model="row.draftLevel" class="field" :aria-label="`${row.name} 等级`">
                <option v-for="level in levels" :key="level" :value="level">{{ ALERT_LEVEL_LABEL[level] }}</option>
              </select>
              <span v-else>{{ ALERT_LEVEL_LABEL[row.level] }}</span>
            </td>
            <td>
              <input
                v-if="canWrite"
                v-model.number="row.draftWindow"
                class="field w-24"
                type="number"
                min="1"
                step="1"
                :aria-label="`${row.name} 窗口分钟`"
              />
              <span v-else>{{ row.windowMinutes }}</span>
            </td>
            <td>{{ row.enabled ? '是' : '否' }}</td>
            <td v-if="canWrite" class="space-x-2 whitespace-nowrap">
              <button class="btn-ghost" type="button" @click="toggleEnabled(row)">{{ row.enabled ? '停用' : '启用' }}</button>
              <button class="btn-ghost" type="button" @click="saveRow(row)">保存</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
