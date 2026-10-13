<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ALERT_LEVEL_LABEL,
  ALERT_STATUS_LABEL,
  type AlertLevel,
  type AlertStatus,
  type DeviceType,
} from '@mushroom/contracts';
import { errorText, http } from '../api';
import { logout } from '../auth';

interface ShedRow {
  id: string;
  code: string;
  name: string;
}

interface AlertRow {
  id: string;
  shedCode: string;
  level: AlertLevel;
  status: AlertStatus;
  title: string;
  createdAt: string;
}

interface DeviceRow {
  id: string;
  code: string;
  name: string;
  type: DeviceType;
  shedCode: string;
  onlineStatus: string;
  lastHeartbeatAt?: string | null;
}

interface Page<T> {
  items: T[];
  total: number;
}

type DutyStatus = 'ok' | 'alert' | 'offline' | 'unknown';

const REFRESH_MS = 30_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const STATUS_LABEL: Record<DutyStatus, string> = {
  ok: '正常',
  alert: '告警',
  offline: '离线',
  unknown: '未知',
};

const route = useRoute();
const router = useRouter();
const loading = ref(true);
const sheds = ref<ShedRow[]>([]);
const devices = ref<DeviceRow[]>([]);
const alerts = ref<AlertRow[]>([]);
const devicesTruncated = ref(false);
const alertsTruncated = ref(false);
const zoneError = reactive({
  sheds: '',
  devices: '',
  alerts: '',
});

let pollTimer = 0;
let loadSeq = 0;

const shedCode = computed(() => {
  const value = route.params.shedCode;
  return typeof value === 'string' ? value : '';
});
const shedsOk = computed(() => zoneError.sheds === '');
const devicesOk = computed(() => zoneError.devices === '');
const alertsOk = computed(() => zoneError.alerts === '');
const shed = computed(() => sheds.value.find((row) => row.code === shedCode.value) ?? null);
const title = computed(() => {
  if (shed.value) return shedTitle(shed.value);
  if (shedCode.value) return `棚 ${shedCode.value}`;
  return '棚';
});
const cameras = computed(() =>
  devices.value
    .filter((row) => row.type === 'camera' && row.shedCode === shedCode.value)
    .slice()
    .sort((a, b) => a.code.localeCompare(b.code, 'en')),
);
const openAlerts = computed(() =>
  alerts.value
    .filter(
      (row) =>
        row.shedCode === shedCode.value && (row.status === 'open' || row.status === 'acked'),
    )
    .slice()
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)),
);
const onlineCount = computed(
  () => cameras.value.filter((row) => row.onlineStatus === 'online').length,
);
const status = computed(() => {
  if (!loading.value && shedsOk.value && shedCode.value && !shed.value) return 'unknown';
  return dutyStatus({
    devicesOk: devicesOk.value,
    alertsOk: alertsOk.value,
    cameraOnline: onlineCount.value,
    openCount: openAlerts.value.length,
  });
});
const statusLabel = computed(() => STATUS_LABEL[status.value]);
const summary = computed(() => {
  const onlineText = devicesOk.value ? `${onlineCount.value}/${cameras.value.length}` : '—/—';
  const alertText = alertsOk.value ? `未闭合 ${openAlerts.value.length}` : '告警未返回';
  return `在线摄像头 ${onlineText} · ${alertText}`;
});

function dutyStatus(input: {
  devicesOk: boolean;
  alertsOk: boolean;
  cameraOnline: number;
  openCount: number;
}): DutyStatus {
  if (input.devicesOk && input.cameraOnline === 0) return 'offline';
  if (input.alertsOk && input.openCount > 0) return 'alert';
  if (input.devicesOk && input.alertsOk) return 'ok';
  return 'unknown';
}

function shedTitle(row: ShedRow): string {
  if (row.name && row.name !== row.code) return `棚 ${row.code} · ${row.name}`;
  return `棚 ${row.code}`;
}

function onlineLabel(value: string): string {
  if (value === 'online') return '在线';
  if (value === 'offline') return '离线';
  return value || '—';
}

function shanghaiParts(value: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(value);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const hour = pick('hour') === '24' ? '00' : pick('hour');
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour,
    minute: pick('minute'),
  };
}

function minuteStamp(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return '—';
  const parts = shanghaiParts(new Date(parsed));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

async function listAll<T>(
  path: string,
  params: Record<string, string | number>,
): Promise<{ items: T[]; total: number; truncated: boolean }> {
  const first = await http.get<Page<T>>(path, {
    params: { ...params, page: 1, pageSize: PAGE_SIZE },
  });
  const items = [...(first.data.items ?? [])];
  const parsedTotal = Number(first.data.total);
  const total = Number.isFinite(parsedTotal) ? parsedTotal : items.length;
  const pages = Math.min(MAX_PAGES, Math.max(1, Math.ceil(total / PAGE_SIZE) || 1));
  for (let page = 2; page <= pages; page += 1) {
    const next = await http.get<Page<T>>(path, {
      params: { ...params, page, pageSize: PAGE_SIZE },
    });
    items.push(...(next.data.items ?? []));
  }
  return { items, total, truncated: items.length < total };
}

function dedupeAlerts(rows: AlertRow[]): AlertRow[] {
  const seen = new Set<string>();
  const out: AlertRow[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

function resetForShed() {
  sheds.value = [];
  devices.value = [];
  alerts.value = [];
  devicesTruncated.value = false;
  alertsTruncated.value = false;
  zoneError.sheds = '';
  zoneError.devices = '';
  zoneError.alerts = '';
  loading.value = true;
}

async function load() {
  const seq = ++loadSeq;
  const code = shedCode.value;
  if (!code) {
    if (seq === loadSeq) loading.value = false;
    return;
  }
  const [shedsResult, devicesResult, alertsResult] = await Promise.allSettled([
    http.get<ShedRow[]>('/sheds'),
    listAll<DeviceRow>('/devices', { type: 'camera', shedCode: code }),
    Promise.all([
      listAll<AlertRow>('/alerts', { status: 'open', shedCode: code }),
      listAll<AlertRow>('/alerts', { status: 'acked', shedCode: code }),
    ]),
  ]);
  if (seq !== loadSeq) return;

  if (shedsResult.status === 'fulfilled') {
    sheds.value = Array.isArray(shedsResult.value.data) ? shedsResult.value.data : [];
    zoneError.sheds = '';
  } else {
    zoneError.sheds = errorText(shedsResult.reason);
  }

  if (devicesResult.status === 'fulfilled') {
    devices.value = devicesResult.value.items;
    devicesTruncated.value = devicesResult.value.truncated;
    zoneError.devices = '';
  } else {
    zoneError.devices = errorText(devicesResult.reason);
  }

  if (alertsResult.status === 'fulfilled') {
    const [open, acked] = alertsResult.value;
    alerts.value = dedupeAlerts([...open.items, ...acked.items]);
    alertsTruncated.value = open.truncated || acked.truncated;
    zoneError.alerts = '';
  } else {
    zoneError.alerts = errorText(alertsResult.reason);
  }

  loading.value = false;
}

function leave() {
  logout();
  void router.push('/login');
}

function alertTo(row: AlertRow) {
  return {
    path: '/alerts',
    query: {
      shedCode: row.shedCode,
      status: row.status,
      alertId: row.id,
    },
  };
}

function openAlert(row: AlertRow) {
  void router.push(alertTo(row));
}

watch(shedCode, () => {
  resetForShed();
  void load();
});

onMounted(() => {
  void load();
  pollTimer = window.setInterval(() => {
    void load();
  }, REFRESH_MS);
});

onBeforeUnmount(() => {
  window.clearInterval(pollTimer);
  loadSeq += 1;
});
</script>

<template>
  <div class="duty" data-screen="duty-shed" aria-label="值班棚详情">
    <header class="top">
      <div class="top-left">
        <router-link data-test="back" class="back" to="/duty-screen">返回值班看板</router-link>
        <h1>{{ title }}</h1>
        <span
          v-if="!loading"
          class="badge-status"
          :data-status="status"
          data-field="status"
        >{{ statusLabel }}</span>
      </div>
      <p v-if="!loading" class="summary" data-field="summary">{{ summary }}</p>
      <div class="top-actions">
        <router-link to="/">管理端</router-link>
        <router-link to="/big-screen">基地大屏</router-link>
        <button type="button" @click="leave">退出</button>
      </div>
    </header>

    <div class="body">
      <p v-if="loading" class="zone-error">加载中…</p>
      <p v-if="zoneError.sheds" class="zone-error">{{ zoneError.sheds }}</p>
      <p v-else-if="!loading && shedsOk && !shed" class="zone-error" data-test="missing-shed">没有这个棚</p>

      <div class="columns">
        <section class="panel" aria-label="摄像头">
          <h2>摄像头</h2>
          <p v-if="zoneError.devices" class="zone-error">{{ zoneError.devices }}</p>
          <p v-if="devicesTruncated" class="zone-error">摄像头列表未取全</p>
          <table v-if="devicesOk && cameras.length" data-test="cameras">
            <thead>
              <tr>
                <th>名称</th>
                <th>编码</th>
                <th>状态</th>
                <th>最近心跳</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in cameras" :key="row.id" :data-camera="row.code">
                <td data-field="name">{{ row.name || '—' }}</td>
                <td data-field="code">{{ row.code }}</td>
                <td data-field="online">{{ onlineLabel(row.onlineStatus) }}</td>
                <td data-field="heartbeat">{{ minuteStamp(row.lastHeartbeatAt) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else-if="!loading && devicesOk" class="empty">没有摄像头</p>
        </section>

        <section class="panel" aria-label="未闭合告警">
          <h2>未闭合告警</h2>
          <p v-if="zoneError.alerts" class="zone-error">{{ zoneError.alerts }}</p>
          <p v-if="alertsTruncated" class="zone-error">未闭合告警未取全</p>
          <table v-if="alertsOk && openAlerts.length" data-test="alerts">
            <thead>
              <tr>
                <th>标题</th>
                <th>级别</th>
                <th>状态</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in openAlerts"
                :key="row.id"
                class="alert-row"
                :data-alert="row.id"
                @click="openAlert(row)"
              >
                <td data-field="title">
                  <router-link data-test="alert-link" :to="alertTo(row)" @click.stop>{{ row.title }}</router-link>
                </td>
                <td data-field="level">{{ ALERT_LEVEL_LABEL[row.level] }}</td>
                <td data-field="status">{{ ALERT_STATUS_LABEL[row.status] }}</td>
                <td data-field="time">{{ minuteStamp(row.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else-if="!loading && alertsOk" class="empty">没有未闭合告警</p>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.duty {
  box-sizing: border-box;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(ellipse 80% 50% at 40% 35%, rgba(0, 100, 180, 0.07), transparent 55%),
    #0a0e17;
  color: #e8eef8;
  font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif;
}
.duty * { box-sizing: border-box; }
.top, .top-left, .top-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.top {
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid #1a2336;
  background: rgba(10, 14, 23, 0.92);
}
.top-left { min-width: 0; flex-wrap: wrap; }
.top h1, .panel h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.back, .top-actions a, .top-actions button {
  color: #00e5ff;
  background: transparent;
  border: 0;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  text-decoration: none;
}
.summary {
  margin: 0;
  color: #7a8ba3;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.badge-status {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 3px;
  border: 1px solid #1a2336;
  color: #7a8ba3;
  background: transparent;
}
.badge-status[data-status="ok"] {
  color: #22c55e;
  border-color: rgba(34, 197, 94, 0.35);
  background: rgba(34, 197, 94, 0.12);
}
.badge-status[data-status="alert"] {
  color: #ff8c00;
  border-color: rgba(255, 140, 0, 0.4);
  background: rgba(255, 140, 0, 0.12);
}
.body { padding: 12px 16px 24px; }
.columns {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
  gap: 12px;
  margin-top: 12px;
}
.panel {
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid #1a2336;
  border-radius: 4px;
  background: #0f1524;
}
table { width: 100%; margin-top: 10px; border-collapse: collapse; }
th, td {
  padding: 8px 6px;
  border-bottom: 1px solid #1a2336;
  text-align: left;
  font-size: 13px;
  font-weight: 400;
  vertical-align: top;
}
th { color: #7a8ba3; font-size: 11px; letter-spacing: 0.06em; }
td[data-field="online"], td[data-field="heartbeat"], td[data-field="time"], td[data-field="code"] {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.alert-row { cursor: pointer; }
.alert-row:hover td { background: rgba(0, 229, 255, 0.06); }
.alert-row a {
  color: #00e5ff;
  text-decoration: none;
}
.alert-row a:hover { text-decoration: underline; }
.zone-error, .empty { margin: 8px 0 0; font-size: 13px; }
.zone-error { color: #fca5a5; }
.empty { color: #7a8ba3; }
@media (max-width: 960px) {
  .top { align-items: flex-start; flex-wrap: wrap; }
  .columns { grid-template-columns: 1fr; }
}
</style>
