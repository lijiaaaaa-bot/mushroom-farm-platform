<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  SYSTEM_PARAM_BOUNDS,
  SYSTEM_PARAM_KEYS,
  SYSTEM_PARAM_LABEL,
  formatSystemParamChange,
  formatSystemParamValue,
  type SystemParamKey,
  type SystemParams,
  type SystemParamsPatchResult,
} from '@mushroom/contracts';
import { errorText, http } from '../api';

const loading = ref(true);
const saving = ref(false);
const loadError = ref('');
const actionError = ref('');
const notice = ref('');
const current = ref<SystemParams | null>(null);
const highlighted = ref<SystemParamKey[]>([]);
const draft = ref<Record<SystemParamKey, number>>({
  imageRetentionDays: 30,
  timeseriesRetentionDays: 90,
  alertUnreadPollSeconds: 15,
});

const fields: { key: SystemParamKey; hint: string }[] = [
  { key: 'imageRetentionDays', hint: '超过这么多天的识别抓拍会清掉对象。' },
  { key: 'timeseriesRetentionDays', hint: '超过这么多天的识别和环境明细会删除。' },
  { key: 'alertUnreadPollSeconds', hint: '超管顶栏隔这么多秒再问一次未读告警。' },
];

function apply(row: SystemParams) {
  current.value = row;
  draft.value = {
    imageRetentionDays: row.imageRetentionDays,
    timeseriesRetentionDays: row.timeseriesRetentionDays,
    alertUnreadPollSeconds: row.alertUnreadPollSeconds,
  };
}

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    const response = await http.get<SystemParams>('/system-params');
    apply(response.data);
    notice.value = '';
    highlighted.value = [];
  } catch (cause) {
    current.value = null;
    loadError.value = errorText(cause);
  } finally {
    loading.value = false;
  }
}

function changedBody(): { body: Partial<Record<SystemParamKey, number>> } | { error: string } {
  if (!current.value) return { error: '系统参数无效' };
  const body: Partial<Record<SystemParamKey, number>> = {};
  for (const key of SYSTEM_PARAM_KEYS) {
    const value = draft.value[key];
    const bounds = SYSTEM_PARAM_BOUNDS[key];
    if (!Number.isInteger(value) || value < bounds.min || value > bounds.max) {
      return { error: `${SYSTEM_PARAM_LABEL[key]}超出 ${bounds.min}–${bounds.max}` };
    }
    if (value !== current.value[key]) body[key] = value;
  }
  return { body };
}

async function save() {
  actionError.value = '';
  const next = changedBody();
  if ('error' in next) {
    actionError.value = next.error;
    notice.value = '';
    return;
  }
  if (!Object.keys(next.body).length) {
    actionError.value = '没有改动';
    notice.value = '';
    return;
  }
  saving.value = true;
  try {
    const response = await http.patch<SystemParamsPatchResult>('/system-params', next.body);
    apply(response.data);
    highlighted.value = response.data.changes.map((change) => change.key);
    notice.value = response.data.changes.map((change) => formatSystemParamChange(change)).join('；');
  } catch (cause) {
    actionError.value = errorText(cause);
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section class="panel space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg">系统参数</h2>
      <button
        class="btn-primary"
        type="button"
        data-testid="sys-params-save"
        :disabled="saving || loading || !current"
        @click="save"
      >
        {{ saving ? '保存中…' : '保存' }}
      </button>
    </div>
    <p class="text-sm text-mist">
      图片保留和时序保留在每天 03:00 的清理里生效。告警未读轮询只改超管顶栏的间隔。补传窗口仍是 90 天。
    </p>
    <p v-if="notice" class="text-sm font-medium" data-testid="sys-params-notice">{{ notice }}</p>
    <p v-if="actionError" class="text-sm text-danger" data-testid="sys-params-error">{{ actionError }}</p>
    <p v-if="loading" class="text-mist">加载中…</p>
    <p v-else-if="loadError" class="text-danger">{{ loadError }}</p>
    <div v-else-if="current" class="space-y-4">
      <div
        v-for="field in fields"
        :key="field.key"
        class="grid gap-2 text-sm md:grid-cols-[12rem_1fr]"
        :data-field="field.key"
        :data-current="current[field.key]"
        :data-highlight="highlighted.includes(field.key) ? 'true' : undefined"
      >
        <div>
          <div class="font-medium">{{ SYSTEM_PARAM_LABEL[field.key] }}</div>
          <p
            class="font-mono"
            :class="highlighted.includes(field.key) ? 'text-accent' : 'text-mist'"
          >
            当前 {{ formatSystemParamValue(field.key, current[field.key]) }}
          </p>
        </div>
        <label class="block">
          <span class="text-mist">{{ field.hint }}</span>
          <input
            v-model.number="draft[field.key]"
            class="field mt-1 w-40"
            type="number"
            :min="SYSTEM_PARAM_BOUNDS[field.key].min"
            :max="SYSTEM_PARAM_BOUNDS[field.key].max"
            step="1"
            :aria-label="SYSTEM_PARAM_LABEL[field.key]"
          />
        </label>
      </div>
    </div>
  </section>
</template>

<style scoped>
div[data-highlight='true'] {
  background: #fff7e6;
  outline: 2px solid #f59e0b;
  outline-offset: 6px;
}
</style>
