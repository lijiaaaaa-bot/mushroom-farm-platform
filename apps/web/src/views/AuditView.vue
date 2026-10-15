<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { errorText, http } from '../api';

interface CountChange {
  old?: number;
  new?: number;
}

interface LogRow {
  id: string;
  username: string | null;
  action: string;
  resource: string;
  createdAt: string;
  detail?: {
    username?: string;
    shedCode?: string;
    cameraCode?: string;
    changes?: Record<string, CountChange>;
  } | null;
}

interface LoginRow {
  id: string;
  username: string | null;
  result: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

const FIELD_LABEL: Record<string, string> = {
  matureCount: '成熟数',
  mushroomCount: '蘑菇数',
};

const ACTION_LABEL: Record<string, string> = {
  'auth.login': '登录成功',
  'auth.login_failed': '登录失败',
};

const PAGE_SIZE = '100';

function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

function detailText(detail: LogRow['detail']): string {
  if (!detail) return '—';
  const parts: string[] = [];
  if (detail.username) parts.push(detail.username);
  if (detail.shedCode) parts.push(detail.shedCode);
  if (detail.cameraCode) parts.push(detail.cameraCode);
  for (const [key, value] of Object.entries(detail.changes ?? {})) {
    if (value && typeof value.old === 'number' && typeof value.new === 'number') {
      parts.push(`${FIELD_LABEL[key] ?? key} ${value.old}→${value.new}`);
    }
  }
  return parts.length ? parts.join(' ') : '—';
}

function resultLabel(result: string): string {
  if (result === 'success') return '成功';
  if (result === 'failure') return '失败';
  return result;
}

const route = useRoute();
const router = useRouter();
const rows = ref<LogRow[]>([]);
const auditTotal = ref(0);
const error = ref('');
const loading = ref(true);
const auditTimeInvalid = ref(false);
const loginRows = ref<LoginRow[]>([]);
const loginTotal = ref(0);
const loginError = ref('');
const loginLoading = ref(true);
const timeInvalid = ref(false);
const usernameDraft = ref('');
const fromDraft = ref('');
const toDraft = ref('');
const auditUsernameDraft = ref('');
const auditFromDraft = ref('');
const auditToDraft = ref('');

const LOGIN_KEYS = ['username', 'from', 'to'];
const AUDIT_KEYS = ['auditUsername', 'auditFrom', 'auditTo'];

function queryValue(key: string) {
  const value = route.query[key];
  return typeof value === 'string' ? value : '';
}

function invalidBound(value: string) {
  return value !== '' && Number.isNaN(new Date(value).getTime());
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function toLocalInput(value: string) {
  if (!value || invalidBound(value)) return value;
  const date = new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseTime(fromRaw: string, toRaw: string) {
  const from = fromRaw.trim();
  const to = toRaw.trim();
  if (invalidBound(from) || invalidBound(to)) return { from: '', to: '', invalid: true };
  if (from && to && new Date(from).getTime() > new Date(to).getTime()) {
    return { from: '', to: '', invalid: true };
  }
  return {
    from: from ? new Date(from).toISOString() : '',
    to: to ? new Date(to).toISOString() : '',
    invalid: false,
  };
}

const usernameFilter = computed(() => queryValue('username').trim());
const timeState = computed(() => parseTime(queryValue('from'), queryValue('to')));
const filterActive = computed(
  () => Boolean(usernameFilter.value || timeState.value.from || timeState.value.to) && !timeState.value.invalid,
);
const auditUsernameFilter = computed(() => queryValue('auditUsername').trim());
const auditTimeState = computed(() => parseTime(queryValue('auditFrom'), queryValue('auditTo')));
const auditFilterActive = computed(
  () =>
    Boolean(auditUsernameFilter.value || auditTimeState.value.from || auditTimeState.value.to) &&
    !auditTimeState.value.invalid,
);

function boundLabel(value: string) {
  return new Date(value).toLocaleString('zh-CN');
}

function scopeLabel(from: string, to: string) {
  const parts: string[] = [];
  if (from) parts.push(boundLabel(from));
  if (to) parts.push(boundLabel(to));
  return parts.join(' 至 ');
}

const timeScopeLabel = computed(() => scopeLabel(timeState.value.from, timeState.value.to));
const auditTimeScopeLabel = computed(() => scopeLabel(auditTimeState.value.from, auditTimeState.value.to));

function syncBoundDrafts(
  usernameKey: string,
  fromKey: string,
  toKey: string,
  username: { value: string },
  from: { value: string },
  to: { value: string },
) {
  username.value = queryValue(usernameKey).trim();
  const time = parseTime(queryValue(fromKey), queryValue(toKey));
  if (time.invalid) {
    from.value = queryValue(fromKey);
    to.value = queryValue(toKey);
    return;
  }
  from.value = toLocalInput(queryValue(fromKey));
  to.value = toLocalInput(queryValue(toKey));
}

function syncDrafts() {
  syncBoundDrafts('username', 'from', 'to', usernameDraft, fromDraft, toDraft);
}

function syncAuditDrafts() {
  syncBoundDrafts('auditUsername', 'auditFrom', 'auditTo', auditUsernameDraft, auditFromDraft, auditToDraft);
}

function loginParams() {
  const params: Record<string, string> = { pageSize: PAGE_SIZE };
  if (usernameFilter.value) params.username = usernameFilter.value;
  if (timeState.value.from) params.from = timeState.value.from;
  if (timeState.value.to) params.to = timeState.value.to;
  return params;
}

async function loadLoginLogs() {
  loginError.value = '';
  const time = parseTime(queryValue('from'), queryValue('to'));
  if (time.invalid) {
    loginRows.value = [];
    loginTotal.value = 0;
    timeInvalid.value = true;
    loginLoading.value = false;
    return;
  }
  timeInvalid.value = false;
  loginLoading.value = true;
  try {
    const response = await http.get<{ items: LoginRow[]; total?: number }>('/login-logs', {
      params: loginParams(),
    });
    loginRows.value = Array.isArray(response.data.items) ? response.data.items : [];
    loginTotal.value = Number.isFinite(Number(response.data.total))
      ? Number(response.data.total)
      : loginRows.value.length;
  } catch (cause) {
    loginError.value = errorText(cause);
    loginRows.value = [];
    loginTotal.value = 0;
  } finally {
    loginLoading.value = false;
  }
}

function auditParams() {
  const params: Record<string, string> = { pageSize: PAGE_SIZE };
  if (auditUsernameFilter.value) params.username = auditUsernameFilter.value;
  if (auditTimeState.value.from) params.from = auditTimeState.value.from;
  if (auditTimeState.value.to) params.to = auditTimeState.value.to;
  return params;
}

async function loadAudit() {
  error.value = '';
  const time = parseTime(queryValue('auditFrom'), queryValue('auditTo'));
  if (time.invalid) {
    rows.value = [];
    auditTotal.value = 0;
    auditTimeInvalid.value = true;
    loading.value = false;
    return;
  }
  auditTimeInvalid.value = false;
  loading.value = true;
  try {
    const response = await http.get<{ items: LogRow[]; total?: number }>('/audit-logs', {
      params: auditParams(),
    });
    rows.value = Array.isArray(response.data.items) ? response.data.items : [];
    auditTotal.value = Number.isFinite(Number(response.data.total))
      ? Number(response.data.total)
      : rows.value.length;
  } catch (cause) {
    error.value = errorText(cause);
    rows.value = [];
    auditTotal.value = 0;
  } finally {
    loading.value = false;
  }
}

function queryWithout(keys: string[]) {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(route.query)) {
    if (keys.includes(key) || typeof value !== 'string' || value === '') continue;
    query[key] = value;
  }
  return query;
}

function withBounds(
  query: Record<string, string>,
  usernameKey: string,
  fromKey: string,
  toKey: string,
  username: string,
  fromRaw: string,
  toRaw: string,
) {
  if (username) query[usernameKey] = username;
  if (fromRaw) query[fromKey] = invalidBound(fromRaw) ? fromRaw : new Date(fromRaw).toISOString();
  if (toRaw) query[toKey] = invalidBound(toRaw) ? toRaw : new Date(toRaw).toISOString();
  return query;
}

async function applyFilters() {
  const query = withBounds(
    queryWithout(LOGIN_KEYS),
    'username',
    'from',
    'to',
    usernameDraft.value.trim(),
    fromDraft.value.trim(),
    toDraft.value.trim(),
  );
  await router.replace({ path: route.path, query });
}

async function clearFilters() {
  usernameDraft.value = '';
  fromDraft.value = '';
  toDraft.value = '';
  await router.replace({ path: route.path, query: queryWithout(LOGIN_KEYS) });
}

async function applyAuditFilters() {
  const query = withBounds(
    queryWithout(AUDIT_KEYS),
    'auditUsername',
    'auditFrom',
    'auditTo',
    auditUsernameDraft.value.trim(),
    auditFromDraft.value.trim(),
    auditToDraft.value.trim(),
  );
  await router.replace({ path: route.path, query });
}

async function clearAuditFilters() {
  auditUsernameDraft.value = '';
  auditFromDraft.value = '';
  auditToDraft.value = '';
  await router.replace({ path: route.path, query: queryWithout(AUDIT_KEYS) });
}

watch(
  () => [route.query.username, route.query.from, route.query.to],
  () => {
    syncDrafts();
    void loadLoginLogs();
  },
  { immediate: true },
);

watch(
  () => [route.query.auditUsername, route.query.auditFrom, route.query.auditTo],
  () => {
    syncAuditDrafts();
    void loadAudit();
  },
  { immediate: true },
);
</script>

<template>
  <section class="panel mb-4 overflow-x-auto">
    <h2 class="mb-3 text-lg">登录日志</h2>
    <p class="mb-3 text-sm text-mist">按用户名和起止时间查询。成功与失败。仅超管与生产管理员可查看。</p>
    <form class="mb-3 grid gap-3 sm:grid-cols-4" data-testid="login-log-filters" @submit.prevent="applyFilters">
      <label class="text-sm">用户
        <input v-model="usernameDraft" class="field mt-1" data-testid="login-log-username" />
      </label>
      <label class="text-sm">开始时间
        <input v-model="fromDraft" class="field mt-1" type="datetime-local" data-testid="login-log-from" />
      </label>
      <label class="text-sm">结束时间
        <input v-model="toDraft" class="field mt-1" type="datetime-local" data-testid="login-log-to" />
      </label>
      <div class="flex items-end gap-2">
        <button class="btn-primary" type="submit" data-testid="login-log-apply">查询</button>
        <button class="btn-ghost" type="button" data-testid="login-log-clear" @click="clearFilters">清除</button>
      </div>
    </form>
    <p
      v-if="filterActive && !loginError && !timeInvalid"
      class="mb-3 text-sm text-mist"
      data-testid="login-log-scope"
    >
      <template v-if="usernameFilter">用户 {{ usernameFilter }}</template>
      <template v-if="timeScopeLabel">{{ usernameFilter ? ' · ' : '' }}时间 {{ timeScopeLabel }}</template>
      · 共 <span data-testid="login-log-count">{{ loginTotal }}</span> 条
    </p>
    <p v-if="loginLoading" class="text-mist">加载中…</p>
    <p v-else-if="loginError" class="text-danger">{{ loginError }}</p>
    <p v-else-if="timeInvalid" class="text-sm text-danger" data-testid="login-log-time-error">时间筛选无效</p>
    <p v-else-if="!loginRows.length" class="text-mist" data-testid="login-log-empty">
      {{ filterActive ? '没有符合条件的登录日志。' : '暂无登录日志。' }}
    </p>
    <table v-else class="data-table" data-testid="login-log-table">
      <thead><tr><th>时间</th><th>用户</th><th>结果</th><th>IP</th><th>User-Agent</th></tr></thead>
      <tbody>
        <tr
          v-for="row in loginRows"
          :key="row.id"
          :data-login-username="row.username || ''"
          :data-login-result="row.result"
        >
          <td class="font-mono text-xs">{{ new Date(row.createdAt).toLocaleString('zh-CN') }}</td>
          <td>{{ row.username || '—' }}</td>
          <td>{{ resultLabel(row.result) }}</td>
          <td class="font-mono text-xs">{{ row.ip || '—' }}</td>
          <td class="max-w-xs truncate font-mono text-xs">{{ row.userAgent || '—' }}</td>
        </tr>
      </tbody>
    </table>
  </section>
  <section class="panel overflow-x-auto">
    <h2 class="mb-3 text-lg">操作审计</h2>
    <p class="mb-3 text-sm text-mist">按用户名和起止时间查询。仅超管与生产管理员可查看。</p>
    <form class="mb-3 grid gap-3 sm:grid-cols-4" data-testid="audit-log-filters" @submit.prevent="applyAuditFilters">
      <label class="text-sm">用户
        <input v-model="auditUsernameDraft" class="field mt-1" data-testid="audit-log-username" />
      </label>
      <label class="text-sm">开始时间
        <input v-model="auditFromDraft" class="field mt-1" type="datetime-local" data-testid="audit-log-from" />
      </label>
      <label class="text-sm">结束时间
        <input v-model="auditToDraft" class="field mt-1" type="datetime-local" data-testid="audit-log-to" />
      </label>
      <div class="flex items-end gap-2">
        <button class="btn-primary" type="submit" data-testid="audit-log-apply">查询</button>
        <button class="btn-ghost" type="button" data-testid="audit-log-clear" @click="clearAuditFilters">清除</button>
      </div>
    </form>
    <p
      v-if="auditFilterActive && !error && !auditTimeInvalid"
      class="mb-3 text-sm text-mist"
      data-testid="audit-log-scope"
    >
      <template v-if="auditUsernameFilter">用户 {{ auditUsernameFilter }}</template>
      <template v-if="auditTimeScopeLabel">{{ auditUsernameFilter ? ' · ' : '' }}时间 {{ auditTimeScopeLabel }}</template>
      · 共 <span data-testid="audit-log-count">{{ auditTotal }}</span> 条
    </p>
    <p v-if="loading" class="text-mist">加载中…</p>
    <p v-else-if="error" class="text-danger">{{ error }}</p>
    <p v-else-if="auditTimeInvalid" class="text-sm text-danger" data-testid="audit-log-time-error">时间筛选无效</p>
    <p v-else-if="!rows.length" class="text-mist" data-testid="audit-log-empty">
      {{ auditFilterActive ? '没有符合条件的操作审计。' : '暂无操作审计。' }}
    </p>
    <table v-else class="data-table" data-testid="audit-log-table">
      <thead><tr><th>时间</th><th>用户</th><th>动作</th><th>资源</th><th>明细</th></tr></thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.id"
          :data-audit-username="row.username || ''"
          :data-audit-action="row.action"
        >
          <td class="font-mono text-xs">{{ new Date(row.createdAt).toLocaleString('zh-CN') }}</td>
          <td>{{ row.username || '—' }}</td>
          <td>{{ actionLabel(row.action) }}</td>
          <td class="font-mono text-xs">{{ row.resource }}</td>
          <td>{{ detailText(row.detail) }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
