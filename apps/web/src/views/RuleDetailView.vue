<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  ALERT_LEVEL_LABEL,
  ALERT_METRIC_LABEL,
  type AlertLevel,
  type AlertMetric,
} from '@mushroom/contracts';
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

const route = useRoute();
const row = ref<Rule | null>(null);
const loading = ref(true);
const error = ref('');

const ruleId = computed(() => {
  const value = route.params.id;
  return typeof value === 'string' ? value : '';
});

const listReturn = computed(() => {
  if (!ruleId.value) return '/alert-rules';
  return { path: '/alert-rules', query: { ruleId: ruleId.value } };
});

function shedText(code: string | null | undefined) {
  return code?.trim() ? code : '全场';
}

async function load() {
  row.value = null;
  error.value = '';
  if (!ruleId.value) {
    error.value = '缺少阈值规则';
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const response = await http.get<Rule>(`/alert-rules/${ruleId.value}`);
    row.value = response.data;
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
}

watch(ruleId, () => {
  void load();
}, { immediate: true });
</script>

<template>
  <section class="ops-page space-y-4">
    <p class="text-sm">
      <router-link class="text-accent" :to="listReturn" data-testid="rule-back">返回阈值规则</router-link>
    </p>
    <h2 class="text-lg text-ink">阈值规则详情</h2>
    <p v-if="loading" class="text-mist">加载中…</p>
    <p v-else-if="error" class="text-danger" data-testid="rule-detail-error">{{ error }}</p>
    <dl v-else-if="row" class="panel space-y-2 text-sm" data-testid="rule-detail">
      <div>
        <span class="text-mist">名称</span>
        <span class="ml-2" data-field="name">{{ row.name }}</span>
      </div>
      <div>
        <span class="text-mist">指标</span>
        <span class="ml-2" data-field="metric">{{ ALERT_METRIC_LABEL[row.metric] }}</span>
      </div>
      <div>
        <span class="text-mist">棚区</span>
        <span class="ml-2 font-mono" data-field="shed">{{ shedText(row.shedCode) }}</span>
      </div>
      <div>
        <span class="text-mist">阈值</span>
        <span class="ml-2 font-mono" data-field="threshold">{{ row.threshold }}</span>
      </div>
      <div>
        <span class="text-mist">等级</span>
        <span class="ml-2" data-field="level">{{ ALERT_LEVEL_LABEL[row.level] }}</span>
      </div>
      <div>
        <span class="text-mist">窗口分钟</span>
        <span class="ml-2" data-field="window">{{ row.windowMinutes }}</span>
      </div>
      <div>
        <span class="text-mist">启用</span>
        <span class="ml-2" data-field="enabled">{{ row.enabled ? '是' : '否' }}</span>
      </div>
    </dl>
  </section>
</template>
