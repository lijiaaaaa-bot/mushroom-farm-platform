<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ALERT_CLOSE_REASON_LABEL,
  ALERT_LEVEL_LABEL,
  ALERT_STATUS_LABEL,
  alertLevelSchema,
  alertStatusSchema,
  type AlertCloseReason,
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
  sensorCode?: string | null;
  level: AlertLevel;
  status: AlertStatus;
  title: string;
  message: string;
  createdAt: string;
  claimedBy: string | null;
  claimNote: string | null;
  closeReason: AlertCloseReason | null;
  closeNote: string | null;
  snapshotObjectKey?: string | null;
}

interface DeviceOption {
  id: string;
  code: string;
  name: string;
}

const rows = ref<AlertRow[]>([]);
const devices = ref<DeviceOption[]>([]);
let devicesRequested = false;
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
const route = useRoute();
const router = useRouter();
const levels = alertLevelSchema.options;
const statuses = alertStatusSchema.options;
const rowEls = new Map<string, HTMLElement>();

function plainQuery(key: string): string {
  const value = route.query[key];
  return typeof value === 'string' ? value : '';
}

function allowedQuery(key: string, options: readonly string[]): string {
  const value = plainQuery(key);
  return options.includes(value) ? value : '';
}

const statusFilter = ref(allowedQuery('status', statuses));
const levelFilter = ref(allowedQuery('level', levels));
const deviceFilter = ref(plainQuery('deviceId').trim());
const shedCodeFilter = ref(plainQuery('shedCode'));
const cameraDraft = ref(plainQuery('cameraCode').trim());
const cameraCodeFilter = ref(cameraDraft.value);
const titleDraft = ref(plainQuery('q').trim());
const titleFilter = ref(titleDraft.value);
const highlightId = ref(plainQuery('alertId'));

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

function readTimeQuery() {
  const from = plainQuery('from').trim();
  const to = plainQuery('to').trim();
  const fromBad = invalidBound(from);
  const toBad = invalidBound(to);
  const orderBad = !fromBad && !toBad && Boolean(from) && Boolean(to) && new Date(from).getTime() > new Date(to).getTime();
  if (fromBad || toBad || orderBad) {
    return { from: '', to: '', invalid: true, draftFrom: from, draftTo: to };
  }
  return {
    from: from ? new Date(from).toISOString() : '',
    to: to ? new Date(to).toISOString() : '',
    invalid: false,
    draftFrom: from ? toLocalInput(from) : '',
    draftTo: to ? toLocalInput(to) : '',
  };
}

const initialTime = readTimeQuery();
const fromDraft = ref(initialTime.draftFrom);
const toDraft = ref(initialTime.draftTo);
const fromFilter = ref(initialTime.from);
const toFilter = ref(initialTime.to);
const timeInvalid = ref(initialTime.invalid);

const addressKeys = ['status', 'level', 'shedCode', 'cameraCode', 'deviceId', 'q', 'from', 'to', 'alertId'] as const;

function listParams() {
  return {
    pageSize: 50,
    status: statusFilter.value || undefined,
    level: levelFilter.value || undefined,
    ...(shedCodeFilter.value ? { shedCode: shedCodeFilter.value } : {}),
    ...(cameraCodeFilter.value ? { cameraCode: cameraCodeFilter.value } : {}),
    ...(deviceFilter.value ? { deviceId: deviceFilter.value } : {}),
    ...(titleFilter.value ? { q: titleFilter.value } : {}),
    ...(fromFilter.value ? { from: fromFilter.value } : {}),
    ...(toFilter.value ? { to: toFilter.value } : {}),
  };
}

function addressQuery(cameraCode: string, titleKeyword: string) {
  const query: Record<string, string> = {};
  if (statusFilter.value) query.status = statusFilter.value;
  if (levelFilter.value) query.level = levelFilter.value;
  if (shedCodeFilter.value) query.shedCode = shedCodeFilter.value;
  if (highlightId.value) query.alertId = highlightId.value;
  if (cameraCode) query.cameraCode = cameraCode;
  if (deviceFilter.value) query.deviceId = deviceFilter.value;
  if (titleKeyword) query.q = titleKeyword;
  if (fromFilter.value) query.from = fromFilter.value;
  if (toFilter.value) query.to = toFilter.value;
  return query;
}

function currentAddressQuery() {
  const query: Record<string, string> = {};
  for (const key of addressKeys) {
    const value = route.query[key];
    if (typeof value !== 'string' || !value) continue;
    query[key] = key === 'cameraCode' || key === 'q' || key === 'deviceId' ? value.trim() : value;
  }
  return query;
}

function sameAddress(left: Record<string, string>, right: Record<string, string>) {
  return addressKeys.every((key) => (left[key] || '') === (right[key] || ''));
}

function detailTo(row: AlertRow) {
  const query: Record<string, string> = {};
  if (statusFilter.value) query.status = statusFilter.value;
  if (levelFilter.value) query.level = levelFilter.value;
  if (shedCodeFilter.value) query.shedCode = shedCodeFilter.value;
  if (cameraCodeFilter.value) query.cameraCode = cameraCodeFilter.value;
  if (deviceFilter.value) query.deviceId = deviceFilter.value;
  if (titleFilter.value) query.q = titleFilter.value;
  if (fromFilter.value) query.from = fromFilter.value;
  if (toFilter.value) query.to = toFilter.value;
  if (!Object.keys(query).length) return `/alerts/${row.id}`;
  return { path: `/alerts/${row.id}`, query };
}

async function applyCamera() {
  const next = cameraDraft.value.trim();
  cameraDraft.value = next;
  if (next === cameraCodeFilter.value && next === plainQuery('cameraCode').trim()) return;
  await router.replace({ path: route.path, query: addressQuery(next, titleFilter.value) });
}

async function applyTitle() {
  const next = titleDraft.value.trim();
  titleDraft.value = next;
  if (next === titleFilter.value && next === plainQuery('q').trim()) return;
  await router.replace({ path: route.path, query: addressQuery(cameraCodeFilter.value, next) });
}

function clearTitle() {
  titleDraft.value = '';
  return applyTitle();
}

function clearCamera() {
  cameraDraft.value = '';
  return applyCamera();
}

function timeActive() {
  return Boolean(fromFilter.value || toFilter.value);
}

function boundLabel(value: string) {
  return new Date(value).toLocaleString('zh-CN');
}

function timeScopeLabel() {
  const parts: string[] = [];
  if (fromFilter.value) parts.push(boundLabel(fromFilter.value));
  if (toFilter.value) parts.push(boundLabel(toFilter.value));
  return parts.join(' 至 ');
}

async function applyTime() {
  const from = fromDraft.value.trim();
  const to = toDraft.value.trim();
  const fromBad = invalidBound(from);
  const toBad = invalidBound(to);
  const orderBad = !fromBad && !toBad && Boolean(from) && Boolean(to) && new Date(from).getTime() > new Date(to).getTime();
  if (fromBad || toBad || orderBad) {
    timeInvalid.value = true;
    rows.value = [];
    loading.value = false;
    error.value = '';
    return;
  }
  const nextFrom = from ? new Date(from).toISOString() : '';
  const nextTo = to ? new Date(to).toISOString() : '';
  fromDraft.value = from ? toLocalInput(from) : '';
  toDraft.value = to ? toLocalInput(to) : '';
  if (nextFrom === fromFilter.value && nextTo === toFilter.value && !timeInvalid.value) return;
  timeInvalid.value = false;
  fromFilter.value = nextFrom;
  toFilter.value = nextTo;
  await router.replace({ path: route.path, query: addressQuery(cameraCodeFilter.value, titleFilter.value) });
}

function clearTime() {
  fromDraft.value = '';
  toDraft.value = '';
  const wasInvalid = timeInvalid.value;
  timeInvalid.value = false;
  if (!fromFilter.value && !toFilter.value) {
    if (wasInvalid) void load();
    return;
  }
  fromFilter.value = '';
  toFilter.value = '';
  return router.replace({ path: route.path, query: addressQuery(cameraCodeFilter.value, titleFilter.value) });
}

function bindRow(id: string, el: unknown) {
  if (el instanceof HTMLElement) rowEls.set(id, el);
  else rowEls.delete(id);
}

async function scrollHighlight() {
  await nextTick();
  const id = highlightId.value;
  const node = id ? rowEls.get(id) : undefined;
  if (node && typeof node.scrollIntoView === 'function') {
    node.scrollIntoView({ block: 'center' });
  }
}

function deviceScopeLabel() {
  const found = devices.value.find((row) => row.id === deviceFilter.value);
  if (!found) return deviceFilter.value;
  return `${found.name}（${found.code}）`;
}

async function loadDevices() {
  if (devicesRequested) return;
  devicesRequested = true;
  const collected: DeviceOption[] = [];
  try {
    for (let page = 1; page <= 5; page += 1) {
      const response = await http.get<{ items?: DeviceOption[]; total?: number }>('/devices', {
        params: { pageSize: 100, page },
      });
      const batch = Array.isArray(response.data?.items) ? response.data.items : [];
      const total = Number(response.data?.total);
      for (const row of batch) {
        if (row?.id && row?.code) collected.push({ id: row.id, code: row.code, name: row.name || row.code });
      }
      const seen = page * 100;
      if (batch.length < 100 || (Number.isFinite(total) && seen >= total)) break;
    }
  } catch {
    devices.value = collected;
    return;
  }
  devices.value = collected;
}

function applyRouteQuery() {
  statusFilter.value = allowedQuery('status', statuses);
  levelFilter.value = allowedQuery('level', levels);
  shedCodeFilter.value = plainQuery('shedCode');
  const deviceId = plainQuery('deviceId').trim();
  if (deviceId !== deviceFilter.value) deviceFilter.value = deviceId;
  const camera = plainQuery('cameraCode').trim();
  if (camera !== cameraCodeFilter.value) {
    cameraDraft.value = camera;
    cameraCodeFilter.value = camera;
  }
  const title = plainQuery('q').trim();
  if (title !== titleFilter.value) {
    titleDraft.value = title;
    titleFilter.value = title;
  }
  const time = readTimeQuery();
  fromDraft.value = time.draftFrom;
  toDraft.value = time.draftTo;
  timeInvalid.value = time.invalid;
  if (time.from !== fromFilter.value) fromFilter.value = time.from;
  if (time.to !== toFilter.value) toFilter.value = time.to;
  if (time.invalid) {
    fromFilter.value = '';
    toFilter.value = '';
    rows.value = [];
  }
  highlightId.value = plainQuery('alertId');
}

async function load() {
  if (timeInvalid.value) {
    rows.value = [];
    loading.value = false;
    error.value = '';
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    const response = await http.get<{ items: AlertRow[] }>('/alerts', {
      params: listParams(),
    });
    rows.value = response.data.items;
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
  await scrollHighlight();
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

function reasonLabel(row: AlertRow) {
  if (!row.closeReason) return '—';
  return ALERT_CLOSE_REASON_LABEL[row.closeReason];
}

async function act(id: string, action: 'ack' | 'close' | 'claim' | 'false-positive') {
  const text = note.value.trim();
  if (action !== 'claim' && !text) return;
  error.value = '';
  try {
    await http.post(`/alerts/${id}/${action}`, {
      note: action === 'claim' ? note.value : text,
    });
    await load();
  } catch (cause) {
    error.value = errorText(cause);
  }
}

watch([statusFilter, levelFilter, shedCodeFilter, cameraCodeFilter, titleFilter, fromFilter, toFilter, deviceFilter], () => {
  void load();
});

watch([statusFilter, levelFilter, deviceFilter], () => {
  const next = addressQuery(cameraCodeFilter.value, titleFilter.value);
  if (sameAddress(next, currentAddressQuery())) return;
  void router.replace({ path: route.path, query: next });
});

watch(() => route.fullPath, () => {
  applyRouteQuery();
  if (!timeInvalid.value) void loadDevices();
});

watch(highlightId, () => {
  void scrollHighlight();
});

onMounted(async () => {
  if (timeInvalid.value) return;
  await load();
  await loadDevices();
});
</script>

<template>
  <div class="ops-page space-y-4">
    <p class="text-sm">
      <a class="text-accent" href="/phase2/wecom">企微/钉钉推送</a>
    </p>
    <form v-if="canOperate(currentUser?.role)" class="panel grid gap-3 md:grid-cols-6" @submit.prevent="createAlert">
      <input v-model="form.shedCode" class="field" placeholder="棚区" aria-label="棚区" />
      <input v-model="form.cameraCode" class="field" placeholder="摄像头" aria-label="摄像头" />
      <select v-model="form.level" class="field" aria-label="级别">
        <option v-for="level in levels" :key="level" :value="level">{{ ALERT_LEVEL_LABEL[level] }}</option>
      </select>
      <input v-model="form.title" class="field md:col-span-2" placeholder="标题" aria-label="标题" required />
      <button class="btn-primary" type="submit">新建告警</button>
      <textarea v-model="form.message" class="field md:col-span-5" placeholder="说明" aria-label="说明" required />
      <label class="text-sm">
        处理说明
        <input
          v-model="note"
          class="field mt-1"
          placeholder="处置备注（误报必填）"
          data-testid="alert-list-handle-note"
        />
      </label>
    </form>
    <p v-if="error" class="text-sm text-danger">{{ error }}</p>
    <section class="panel overflow-x-auto">
      <div class="mb-3 flex flex-wrap gap-3">
        <label class="text-sm">状态
          <select v-model="statusFilter" class="field mt-1" data-testid="alert-status-filter">
            <option value="">全部</option>
            <option v-for="value in statuses" :key="value" :value="value">{{ ALERT_STATUS_LABEL[value] }}</option>
          </select>
        </label>
        <label class="text-sm">级别
          <select v-model="levelFilter" class="field mt-1" data-testid="alert-level-filter">
            <option value="">全部</option>
            <option v-for="level in levels" :key="level" :value="level">{{ ALERT_LEVEL_LABEL[level] }}</option>
          </select>
        </label>
        <label class="text-sm">设备
          <select v-model="deviceFilter" class="field mt-1" data-testid="alert-device-filter">
            <option value="">全部</option>
            <option v-for="device in devices" :key="device.id" :value="device.id">{{ device.name }}（{{ device.code }}）</option>
          </select>
        </label>
        <label class="text-sm">摄像头
          <input
            v-model="cameraDraft"
            class="field mt-1"
            placeholder="摄像头编号"
            data-testid="alert-camera-filter"
            @keydown.enter.prevent="applyCamera"
          />
        </label>
        <button class="btn-ghost self-end" type="button" data-testid="alert-camera-apply" @click="applyCamera">筛选</button>
        <button class="btn-ghost self-end" type="button" data-testid="alert-camera-clear" @click="clearCamera">清除</button>
        <label class="text-sm">标题
          <input
            v-model="titleDraft"
            class="field mt-1"
            placeholder="标题关键词"
            data-testid="alert-title-filter"
            @keydown.enter.prevent="applyTitle"
          />
        </label>
        <button class="btn-ghost self-end" type="button" data-testid="alert-title-apply" @click="applyTitle">搜索</button>
        <button class="btn-ghost self-end" type="button" data-testid="alert-title-clear" @click="clearTitle">清除搜索</button>
        <label class="text-sm">开始时间
          <input
            v-model="fromDraft"
            class="field mt-1"
            type="datetime-local"
            aria-label="开始时间"
            data-testid="alert-time-from"
          />
        </label>
        <label class="text-sm">结束时间
          <input
            v-model="toDraft"
            class="field mt-1"
            type="datetime-local"
            aria-label="结束时间"
            data-testid="alert-time-to"
          />
        </label>
        <button class="btn-ghost self-end" type="button" data-testid="alert-time-apply" @click="applyTime">查询</button>
        <button class="btn-ghost self-end" type="button" data-testid="alert-time-clear" @click="clearTime">清除时间</button>
        <p v-if="shedCodeFilter" class="self-end text-sm text-mist" data-testid="alert-shed-scope">棚 {{ shedCodeFilter }}</p>
        <p v-if="cameraCodeFilter" class="self-end text-sm text-mist" data-testid="alert-camera-scope">摄像头 {{ cameraCodeFilter }}</p>
        <p v-if="deviceFilter" class="self-end text-sm text-mist" data-testid="alert-device-scope">设备 {{ deviceScopeLabel() }}</p>
        <p v-if="titleFilter" class="self-end text-sm text-mist" data-testid="alert-title-scope">标题 {{ titleFilter }}</p>
        <p v-if="timeActive() && !timeInvalid" class="self-end text-sm text-mist" data-testid="alert-time-scope">时间 {{ timeScopeLabel() }}</p>
      </div>
      <p v-if="timeInvalid" class="text-sm text-danger" data-testid="alert-time-error">时间筛选无效</p>
      <p v-else-if="loading" class="text-mist">加载中…</p>
      <p v-else-if="!error && !rows.length" class="text-mist" data-testid="alert-empty">{{ timeActive() ? '没有符合条件的告警。' : '暂无告警。' }}</p>
      <table v-else-if="rows.length" class="data-table">
        <thead>
          <tr><th>等级</th><th>状态</th><th>原因</th><th>认领人</th><th>棚区</th><th>摄像头</th><th>标题</th><th>时间</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.id"
            :ref="(el) => bindRow(row.id, el)"
            :data-alert-id="row.id"
            :data-highlight="row.id === highlightId ? 'true' : undefined"
          >
            <td>{{ ALERT_LEVEL_LABEL[row.level] }}</td>
            <td data-testid="alert-status">
              {{ ALERT_STATUS_LABEL[row.status] }}
              <span v-if="row.claimedBy && row.status !== 'closed'"> · 已认领</span>
            </td>
            <td>{{ reasonLabel(row) }}</td>
            <td>{{ row.claimedBy || '—' }}</td>
            <td>{{ row.shedCode }}</td>
            <td class="font-mono text-xs" data-testid="alert-camera">{{ row.cameraCode || '—' }}</td>
            <td>
              <router-link
                class="text-accent"
                :to="detailTo(row)"
                data-testid="alert-detail-link"
              >{{ row.title }}</router-link>
              <p v-if="row.sensorCode" class="font-mono text-xs" data-testid="alert-sensor">传感器 {{ row.sensorCode }}</p>
              <router-link
                v-if="row.snapshotObjectKey"
                class="ml-2 text-xs text-accent"
                :to="detailTo(row)"
                data-testid="alert-snapshot-link"
              >抓拍</router-link>
              <p class="text-xs text-mist">{{ row.message }}</p>
              <p v-if="row.claimNote" class="text-xs text-mist">认领备注 {{ row.claimNote }}</p>
              <p v-if="row.closeNote" class="text-xs text-mist">关闭备注 {{ row.closeNote }}</p>
            </td>
            <td class="font-mono text-xs">{{ new Date(row.createdAt).toLocaleString('zh-CN') }}</td>
            <td class="space-x-2 whitespace-nowrap" v-if="canOperate(currentUser?.role)">
              <button v-if="row.status === 'open'" class="btn-ghost" type="button" data-testid="alert-ack" :disabled="!note.trim()" @click="act(row.id, 'ack')">确认</button>
              <button v-if="row.status !== 'closed'" class="btn-ghost" type="button" @click="act(row.id, 'claim')">认领</button>
              <button v-if="row.status !== 'closed'" class="btn-ghost" type="button" data-testid="alert-close" :disabled="!note.trim()" @click="act(row.id, 'close')">关闭</button>
              <button
                v-if="row.status !== 'closed'"
                class="btn-ghost"
                type="button"
                :disabled="!note.trim()"
                @click="act(row.id, 'false-positive')"
              >误报关闭</button>
            </td>
            <td v-else></td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
tr[data-highlight='true'] {
  background: #fff7e6;
  outline: 2px solid #f59e0b;
  outline-offset: -2px;
}
</style>
