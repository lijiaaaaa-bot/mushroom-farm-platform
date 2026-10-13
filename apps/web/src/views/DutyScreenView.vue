<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  ALERT_LEVEL_LABEL,
  type AlertLevel,
  type AlertStatus,
  type DeviceType,
} from '@mushroom/contracts';
import { errorText, http } from '../api';
import { logout } from '../auth';

interface Overview {
  shedCount: number;
  deviceTotal: number;
  deviceOnline: number;
  todayMushroom: number;
  todayMature: number;
  openAlerts: number;
  severeAlerts: number;
  env: {
    avgTemp: number | null;
    avgHumidity: number | null;
    avgCo2: number | null;
    avgSubstrateMoisture: number | null;
  };
}

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
  message: string;
  createdAt: string;
}

interface DeviceRow {
  id: string;
  code: string;
  name: string;
  type: DeviceType;
  shedCode: string;
  onlineStatus: string;
  lastSeenAt?: string | null;
  lastHeartbeatAt?: string | null;
}

interface Page<T> {
  items: T[];
  total: number;
}

interface TrendPoint {
  day: string;
  mushroomCount: number;
  sampleCount: number;
}

interface TrendShed {
  shedCode: string;
  points: TrendPoint[];
  cameras: Array<{ cameraCode: string; points: TrendPoint[] }>;
}

interface TrendResponse {
  to: string;
  sheds: TrendShed[];
}

interface ChannelRow {
  channel: 'recognition' | 'environment' | 'heartbeat';
  transport: 'http' | 'mqtt';
  accepted: number;
  rejected: number;
  latencyP50Ms: number | null;
  latencyLatestMs: number | null;
}

interface ObservabilityError {
  id: string;
  channel: ChannelRow['channel'];
  transport: ChannelRow['transport'];
  shedCode: string | null;
  code: string | null;
  errors: string[];
  createdAt: string;
}

interface Observability {
  windowMinutes: number;
  accepted: number;
  rejected: number;
  latencyP50Ms: number | null;
  latencyLatestMs: number | null;
  channels: ChannelRow[];
  recentErrors: ObservabilityError[];
}

type DutyStatus = 'ok' | 'alert' | 'offline' | 'unknown';

const REFRESH_MS = 30_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const LEVEL_RANK: Record<AlertLevel, number> = { severe: 0, warning: 1, info: 2 };
const STATUS_LABEL: Record<DutyStatus, string> = {
  ok: '正常',
  alert: '告警',
  offline: '离线',
  unknown: '未知',
};
const CHANNEL_LABEL: Record<string, string> = {
  'recognition:http': '识别 HTTP',
  'recognition:mqtt': '识别 MQTT',
  'environment:http': '环境 HTTP',
  'environment:mqtt': '环境 MQTT',
  'heartbeat:http': '心跳 HTTP',
  'heartbeat:mqtt': '心跳 MQTT',
};
const CHANNEL_ORDER = [
  'recognition:http',
  'recognition:mqtt',
  'environment:http',
  'environment:mqtt',
  'heartbeat:http',
  'heartbeat:mqtt',
];

const router = useRouter();
const now = ref(new Date());
const loading = ref(true);
const syncedAt = ref<Date | null>(null);
const sheds = ref<ShedRow[]>([]);
const devices = ref<DeviceRow[]>([]);
const alerts = ref<AlertRow[]>([]);
const trend = ref<TrendResponse | null>(null);
const overview = ref<Overview | null>(null);
const observability = ref<Observability | null>(null);
const devicesTruncated = ref(false);
const alertsTruncated = ref(false);
const zoneError = reactive({
  sheds: '',
  devices: '',
  alerts: '',
  trends: '',
  overview: '',
  observability: '',
});

let clockTimer = 0;
let pollTimer = 0;
let loadSeq = 0;

const shedsOk = computed(() => zoneError.sheds === '');
const devicesOk = computed(() => zoneError.devices === '');
const alertsOk = computed(() => zoneError.alerts === '');
const trendsOk = computed(() => zoneError.trends === '');
const overviewOk = computed(() => zoneError.overview === '');
const observabilityOk = computed(() => zoneError.observability === '');

const trendDay = computed(() => trend.value?.to ?? '');
const trendByShed = computed(() => {
  const map = new Map<string, TrendShed>();
  for (const row of trend.value?.sheds ?? []) map.set(row.shedCode, row);
  return map;
});

const cards = computed(() =>
  sheds.value.map((shed) => {
    const cameras = devices.value.filter(
      (row) => row.shedCode === shed.code && row.type === 'camera',
    );
    const online = cameras.filter((row) => row.onlineStatus === 'online').length;
    const open = alerts.value.filter(
      (row) => row.shedCode === shed.code && row.status !== 'closed',
    );
    const chosen = pickAlert(open);
    const point = todayPoint(trendByShed.value.get(shed.code), trendDay.value);
    const status = dutyStatus({
      devicesOk: devicesOk.value,
      alertsOk: alertsOk.value,
      cameraOnline: online,
      openCount: open.length,
    });
    const recognitions = point?.sampleCount ?? 0;
    const mushroom = point?.mushroomCount ?? 0;
    return {
      id: shed.id,
      code: shed.code,
      title: shedTitle(shed),
      status,
      statusLabel: STATUS_LABEL[status],
      onlineText: devicesOk.value ? `${online}/${cameras.length}` : '—/—',
      recognitions,
      recognitionsText: trendsOk.value ? String(recognitions) : '—',
      mushroom,
      mushroomText: trendsOk.value ? String(mushroom) : '—',
      alertLine: alertLine({
        alertsOk: alertsOk.value,
        alertsError: zoneError.alerts,
        status,
        chosen,
        cameras,
      }),
      alertKind: !alertsOk.value ? 'error' : chosen ? 'alert' : status === 'offline' ? 'offline' : 'none',
    };
  }),
);

const maxRecognitions = computed(() =>
  Math.max(1, ...cards.value.map((card) => (trendsOk.value ? card.recognitions : 0))),
);

const openAlertCount = computed(
  () => alerts.value.filter((row) => row.status !== 'closed').length,
);

const pipeline = computed(() => {
  const byKey = new Map(
    (observability.value?.channels ?? []).map((row) => [
      `${row.channel}:${row.transport}`,
      row,
    ]),
  );
  return CHANNEL_ORDER.map((key) => {
    const row = byKey.get(key);
    const accepted = row?.accepted ?? 0;
    const rejected = row?.rejected ?? 0;
    const tone = rejected > 0 ? 'warn' : accepted > 0 ? 'on' : 'dim';
    const text =
      rejected > 0
        ? `${CHANNEL_LABEL[key]} ${accepted}·拒${rejected}`
        : `${CHANNEL_LABEL[key]} ${accepted}`;
    return { key, tone, text };
  });
});

const feed = computed(() => {
  const rows: Array<{ id: string; at: number; tone: string; text: string }> = [];
  if (alertsOk.value) {
    for (const row of alerts.value) {
      if (row.status === 'closed') continue;
      rows.push({
        id: `alert-${row.id}`,
        at: Date.parse(row.createdAt) || 0,
        tone: row.level === 'info' ? 'info' : 'warn',
        text: `${row.shedCode} · ${ALERT_LEVEL_LABEL[row.level]} · ${row.title}`,
      });
    }
  }
  if (observabilityOk.value) {
    for (const row of observability.value?.recentErrors ?? []) {
      const label = CHANNEL_LABEL[`${row.channel}:${row.transport}`] ?? row.channel;
      const detail = [row.code, ...row.errors].filter(Boolean).join(' ');
      rows.push({
        id: `reject-${row.id}`,
        at: Date.parse(row.createdAt) || 0,
        tone: 'warn',
        text: `拒收 · ${label} · ${row.shedCode || '—'} · ${detail}`,
      });
    }
  }
  rows.sort((a, b) => b.at - a.at);
  return rows.slice(0, 16).map((row) => ({
    ...row,
    time: row.at ? shanghaiClock(new Date(row.at)) : '—',
  }));
});

const clockText = computed(() => shanghaiStamp(now.value));
const windowLabel = computed(() =>
  observability.value ? `近 ${observability.value.windowMinutes} 分钟` : '接入近窗',
);

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

function pickAlert(rows: AlertRow[]): AlertRow | null {
  const open = rows.filter((row) => row.status === 'open' || row.status === 'acked');
  open.sort((a, b) => {
    const rank = LEVEL_RANK[a.level] - LEVEL_RANK[b.level];
    if (rank !== 0) return rank;
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
  return open[0] ?? null;
}

function alertSummary(row: AlertRow): string {
  const detail = (row.message || row.title || '')
    .replace(/摄像头\s+\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const prefix = row.status === 'acked' ? '已确认 · ' : '';
  return `${prefix}${ALERT_LEVEL_LABEL[row.level]} · ${detail || row.title}`;
}

function alertLine(input: {
  alertsOk: boolean;
  alertsError: string;
  status: DutyStatus;
  chosen: AlertRow | null;
  cameras: DeviceRow[];
}): string {
  if (!input.alertsOk) return input.alertsError || '告警未返回';
  if (input.chosen) return alertSummary(input.chosen);
  if (input.status === 'offline') return offlineLine(input.cameras);
  return '无未闭合告警';
}

function offlineLine(cameras: DeviceRow[]): string {
  if (!cameras.length) return '无摄像头';
  const times = cameras
    .map((row) => row.lastHeartbeatAt || row.lastSeenAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));
  if (!times.length) return '整棚离线 · 无心跳';
  return `整棚离线 · 上次心跳 ${shanghaiClock(new Date(Math.max(...times)))}`;
}

function shedTitle(shed: ShedRow): string {
  if (shed.name && shed.name !== shed.code) return `棚 ${shed.code} · ${shed.name}`;
  return `棚 ${shed.code}`;
}

/** 棚级日桶点数。sampleCount 是当日识别条数，不是蘑菇数。 */
function todayPoint(shed: TrendShed | undefined, day: string): TrendPoint | null {
  if (!shed || !day) return null;
  const point = shed.points.find((row) => row.day === day);
  if (point) return point;
  const cameras = shed.cameras
    .map((camera) => camera.points.find((row) => row.day === day))
    .filter((row): row is TrendPoint => Boolean(row));
  if (!cameras.length) return null;
  return {
    day,
    sampleCount: cameras.reduce((sum, row) => sum + row.sampleCount, 0),
    mushroomCount: cameras.reduce((sum, row) => sum + row.mushroomCount, 0),
  };
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
  return { year: pick('year'), month: pick('month'), day: pick('day'), hour, minute: pick('minute'), second: pick('second') };
}

function shanghaiClock(value: Date): string {
  const parts = shanghaiParts(value);
  return `${parts.hour}:${parts.minute}`;
}

function shanghaiStamp(value: Date): string {
  const parts = shanghaiParts(value);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return String(value);
}

function formatEnv(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return String(value);
}

function latency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${value} ms`;
}

function barWidth(count: number): string {
  if (!trendsOk.value) return '0%';
  return `${Math.round((count / maxRecognitions.value) * 100)}%`;
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

async function load() {
  const seq = ++loadSeq;
  const [shedsResult, devicesResult, alertsResult, trendsResult, overviewResult, observabilityResult] =
    await Promise.allSettled([
      http.get<ShedRow[]>('/sheds'),
      listAll<DeviceRow>('/devices', { type: 'camera' }),
      Promise.all([
        listAll<AlertRow>('/alerts', { status: 'open' }),
        listAll<AlertRow>('/alerts', { status: 'acked' }),
      ]),
      http.get<TrendResponse>('/growth-trends', { params: { days: 7 } }),
      http.get<Overview>('/dashboard/overview'),
      http.get<Observability>('/ingest/observability'),
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

  if (trendsResult.status === 'fulfilled') {
    trend.value = trendsResult.value.data;
    zoneError.trends = '';
  } else {
    zoneError.trends = errorText(trendsResult.reason);
  }

  if (overviewResult.status === 'fulfilled') {
    overview.value = overviewResult.value.data;
    zoneError.overview = '';
  } else {
    zoneError.overview = errorText(overviewResult.reason);
  }

  if (observabilityResult.status === 'fulfilled') {
    observability.value = observabilityResult.value.data;
    zoneError.observability = '';
  } else {
    zoneError.observability = errorText(observabilityResult.reason);
  }

  if (
    [shedsResult, devicesResult, alertsResult, trendsResult, overviewResult, observabilityResult].some(
      (result) => result.status === 'fulfilled',
    )
  ) {
    syncedAt.value = new Date();
  }
  loading.value = false;
}

function leave() {
  logout();
  void router.push('/login');
}

onMounted(() => {
  void load();
  clockTimer = window.setInterval(() => {
    now.value = new Date();
  }, 1000);
  pollTimer = window.setInterval(() => {
    void load();
  }, REFRESH_MS);
});

onBeforeUnmount(() => {
  window.clearInterval(clockTimer);
  window.clearInterval(pollTimer);
  loadSeq += 1;
});
</script>

<template>
  <div class="duty" data-screen="duty" aria-label="值班看板">
    <header class="top">
      <div class="top-left">
        <h1>值班看板 <span>棚区</span></h1>
        <p v-if="observabilityOk && observability" class="badge">近窗接收 {{ observability.accepted }}</p>
        <p v-else-if="!loading" class="badge muted-badge">接入未返回</p>
      </div>
      <div class="chips" data-test="pipeline">
        <p v-if="zoneError.observability" class="zone-error">{{ zoneError.observability }}</p>
        <template v-else-if="observability">
          <span
            v-for="chip in pipeline"
            :key="chip.key"
            class="chip"
            :data-tone="chip.tone"
          >{{ chip.text }}</span>
        </template>
      </div>
      <div class="top-right">
        <p class="clock">{{ clockText }}</p>
        <p class="sync">刷新 {{ REFRESH_MS / 1000 }}s<span v-if="syncedAt"> · 已刷新 {{ shanghaiClock(syncedAt) }}</span></p>
        <div class="top-actions">
          <router-link to="/">管理端</router-link>
          <router-link to="/big-screen">基地大屏</router-link>
          <button type="button" @click="leave">退出</button>
        </div>
      </div>
    </header>

    <div class="main">
      <section class="center" aria-label="棚区值班">
        <div class="center-head">
          <h2>棚区值班</h2>
          <p class="legend">
            <span class="ok">正常</span>
            <span class="warn">告警</span>
            <span class="off">离线</span>
            <span v-if="alertsOk">未闭合 {{ openAlertCount }}</span>
          </p>
        </div>
        <p v-if="loading" class="zone-error">加载中…</p>
        <p v-else-if="zoneError.sheds" class="zone-error">{{ zoneError.sheds }}</p>
        <p v-else-if="shedsOk && !sheds.length" class="zone-error">没有可见棚区</p>
        <p v-if="zoneError.devices" class="zone-error">{{ zoneError.devices }}</p>
        <p v-if="zoneError.trends" class="zone-error">{{ zoneError.trends }}</p>
        <p v-if="devicesTruncated" class="zone-error">摄像头列表未取全，在线数可能偏少</p>
        <p v-if="alertsTruncated" class="zone-error">未闭合告警未取全</p>
        <div v-if="!loading && sheds.length" class="shed-grid">
          <router-link
            v-for="card in cards"
            :key="card.id"
            class="shed"
            :to="{ name: 'duty-shed', params: { shedCode: card.code } }"
            :data-status="card.status"
            :data-shed="card.code"
          >
            <div class="shed-top">
              <h3>{{ card.title }}</h3>
              <span class="badge-status">{{ card.statusLabel }}</span>
            </div>
            <div class="metrics">
              <div>
                <p class="k">在线摄像头</p>
                <p class="v" data-field="online">{{ card.onlineText }}</p>
              </div>
              <div>
                <p class="k">今日识别</p>
                <p class="v" data-field="recognitions">{{ card.recognitionsText }}</p>
              </div>
            </div>
            <p class="shed-alert" :data-kind="card.alertKind" data-field="alert" :title="card.alertLine">
              {{ card.alertLine }}
            </p>
          </router-link>
        </div>
      </section>

      <aside class="side" aria-label="接入与告警">
        <h2>接入近窗</h2>
        <p class="side-note">{{ windowLabel }}</p>
        <div v-if="observabilityOk && observability" class="stat-grid">
          <p><span>接收</span><b>{{ observability.accepted }}</b></p>
          <p><span>拒收</span><b>{{ observability.rejected }}</b></p>
          <p><span>延迟 p50</span><b>{{ latency(observability.latencyP50Ms) }}</b></p>
          <p><span>最近延迟</span><b>{{ latency(observability.latencyLatestMs) }}</b></p>
        </div>
        <p v-else-if="zoneError.observability" class="zone-error">{{ zoneError.observability }}</p>
        <div class="feed-head">
          <h2>告警与拒收</h2>
          <router-link to="/alerts">告警页</router-link>
        </div>
        <ul v-if="feed.length" class="feed" data-test="alert-feed">
          <li v-for="row in feed" :key="row.id" :data-tone="row.tone">
            <time>{{ row.time }}</time>
            <span>{{ row.text }}</span>
          </li>
        </ul>
        <p v-else-if="alertsOk && observabilityOk" class="side-note">没有未闭合告警，近窗也没有拒收。</p>
      </aside>
    </div>

    <footer class="bottom" aria-label="分棚数字">
      <section>
        <h2>全场</h2>
        <p v-if="zoneError.overview" class="zone-error">{{ zoneError.overview }}</p>
        <dl v-else-if="overviewOk && overview">
          <div><dt>棚区</dt><dd>{{ formatCount(overview.shedCount) }}</dd></div>
          <div><dt>设备在线</dt><dd>{{ overview.deviceOnline }}/{{ overview.deviceTotal }}</dd></div>
          <div><dt>今日蘑菇</dt><dd data-field="today-mushroom">{{ formatCount(overview.todayMushroom) }}</dd></div>
          <div><dt>今日成熟</dt><dd>{{ formatCount(overview.todayMature) }}</dd></div>
          <div><dt>未闭合告警</dt><dd>{{ formatCount(overview.openAlerts) }}</dd></div>
          <div><dt>严重</dt><dd>{{ formatCount(overview.severeAlerts) }}</dd></div>
        </dl>
      </section>
      <section data-test="shed-counts">
        <h2>分棚今日识别</h2>
        <p v-if="zoneError.trends" class="zone-error">{{ zoneError.trends }}</p>
        <ul v-else-if="cards.length">
          <li v-for="card in cards" :key="card.code">
            <span class="bar-name">{{ card.code }}</span>
            <span class="track"><span class="fill" :style="{ width: barWidth(card.recognitions) }"></span></span>
            <span class="bar-val">{{ card.recognitionsText }}</span>
            <span class="bar-sub">蘑菇 {{ card.mushroomText }}</span>
          </li>
        </ul>
      </section>
      <section>
        <h2>环境</h2>
        <p class="side-note">近端小时桶均值</p>
        <p v-if="zoneError.overview" class="zone-error">{{ zoneError.overview }}</p>
        <dl v-else-if="overviewOk && overview">
          <div><dt>温度</dt><dd>{{ formatEnv(overview.env.avgTemp) }}</dd></div>
          <div><dt>湿度</dt><dd>{{ formatEnv(overview.env.avgHumidity) }}</dd></div>
          <div><dt>CO₂</dt><dd>{{ formatEnv(overview.env.avgCo2) }}</dd></div>
          <div><dt>基质含水率</dt><dd>{{ formatEnv(overview.env.avgSubstrateMoisture) }}</dd></div>
        </dl>
      </section>
    </footer>
  </div>
</template>

<style scoped>
.duty {
  box-sizing: border-box;
  height: 100vh;
  min-height: 640px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background:
    radial-gradient(ellipse 80% 50% at 40% 35%, rgba(0, 100, 180, 0.07), transparent 55%),
    #0a0e17;
  color: #e8eef8;
  font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif;
}
.duty * { box-sizing: border-box; }
.top, .center-head, .feed-head, .top-actions {
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
.top h1, .center-head h2, .side h2, .feed-head h2, .bottom h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.top h1 span, .side-note, .legend, .sync, .k, .bottom dt {
  color: #7a8ba3;
  font-weight: 400;
}
.top h1 span { margin-left: 8px; font-size: 12px; letter-spacing: 0.12em; }
.badge, .chip, .badge-status {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 3px;
  border: 1px solid rgba(0, 229, 255, 0.35);
  color: #00e5ff;
  background: rgba(0, 229, 255, 0.08);
}
.muted-badge { color: #7a8ba3; border-color: #1a2336; background: transparent; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; flex: 1; }
.chip { color: #7a8ba3; border-color: #1a2336; background: #0f1524; }
.chip[data-tone="on"] { color: #00e5ff; border-color: rgba(0, 229, 255, 0.5); background: rgba(0, 229, 255, 0.1); }
.chip[data-tone="warn"] { color: #ff8c00; border-color: rgba(255, 140, 0, 0.5); background: rgba(255, 140, 0, 0.1); }
.top-right { text-align: right; }
.clock, .sync { margin: 0; font-size: 12px; font-variant-numeric: tabular-nums; }
.top-actions a, .top-actions button, .feed-head a {
  color: #00e5ff;
  background: transparent;
  border: 0;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  text-decoration: none;
}
.main {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
}
.center, .side { min-height: 0; overflow: auto; padding: 12px 14px; }
.side { border-left: 1px solid #1a2336; background: #0d1320; }
.legend { display: flex; gap: 12px; margin: 0; font-size: 12px; }
.legend .ok::before,
.legend .warn::before,
.legend .off::before {
  content: "";
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 5px;
  border-radius: 2px;
  vertical-align: middle;
}
.legend .ok::before { background: #22c55e; }
.legend .warn::before { background: #ff8c00; }
.legend .off::before { background: #4a5a70; }
.shed-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
  margin-top: 10px;
}
a.shed {
  color: inherit;
  text-decoration: none;
  cursor: pointer;
}
a.shed:hover { border-color: rgba(0, 229, 255, 0.45); }
a.shed:focus-visible {
  outline: 1px solid #00e5ff;
  outline-offset: 2px;
}
.shed {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 168px;
  padding: 12px 14px;
  border: 1px solid #1a2336;
  border-radius: 4px;
  background: #0f1524;
  overflow: hidden;
}
.shed::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: #4a5a70;
}
.shed[data-status="ok"] { border-color: rgba(34, 197, 94, 0.25); background: linear-gradient(135deg, rgba(34, 197, 94, 0.06), #0f1524 40%); }
.shed[data-status="ok"]::before { background: #22c55e; }
.shed[data-status="alert"] { border-color: rgba(255, 140, 0, 0.35); background: linear-gradient(135deg, rgba(255, 140, 0, 0.08), #0f1524 40%); }
.shed[data-status="alert"]::before { background: #ff8c00; }
.shed[data-status="offline"] { opacity: 0.78; }
.shed-top { justify-content: space-between; }
.shed h3 { margin: 0; font-size: 16px; }
.badge-status { color: #7a8ba3; border-color: #1a2336; background: transparent; }
.shed[data-status="ok"] .badge-status { color: #22c55e; border-color: rgba(34, 197, 94, 0.35); background: rgba(34, 197, 94, 0.12); }
.shed[data-status="alert"] .badge-status { color: #ff8c00; border-color: rgba(255, 140, 0, 0.4); background: rgba(255, 140, 0, 0.12); }
.metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.metrics > div { padding: 8px 10px; border: 1px solid #1a2336; border-radius: 3px; background: rgba(10, 14, 23, 0.55); }
.k { margin: 0 0 4px; font-size: 11px; letter-spacing: 0.08em; }
.v { margin: 0; color: #00e5ff; font-size: 26px; font-weight: 600; line-height: 1.1; font-variant-numeric: tabular-nums; }
.shed[data-status="alert"] .v { color: #ff8c00; }
.shed[data-status="offline"] .v, .shed[data-status="unknown"] .v { color: #7a8ba3; }
.shed-alert {
  margin: 0;
  min-height: 28px;
  padding: 6px 8px;
  border-radius: 3px;
  font-size: 12px;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.shed-alert[data-kind="none"] { color: #4a5a70; border: 1px dashed #1a2336; }
.shed-alert[data-kind="alert"], .shed-alert[data-kind="offline"] {
  color: #ff8c00;
  border: 1px solid rgba(255, 140, 0, 0.25);
  background: rgba(255, 140, 0, 0.08);
}
.shed-alert[data-kind="error"] { color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.35); }
.stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 8px 0 12px; }
.stat-grid p, .bottom div { margin: 0; padding: 6px 8px; border: 1px solid #1a2336; border-radius: 3px; background: #0f1524; }
.stat-grid span, .bottom dt { display: block; font-size: 11px; }
.stat-grid b, .bottom dd { font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; }
.feed { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.feed li { display: grid; grid-template-columns: 48px 1fr; gap: 8px; font-size: 12px; color: #7a8ba3; }
.feed time { color: #4a5a70; font-variant-numeric: tabular-nums; }
.feed [data-tone="warn"] span { color: #ff8c00; }
.feed [data-tone="info"] span { color: #00e5ff; }
.zone-error { margin: 8px 0 0; color: #fca5a5; font-size: 13px; }
.bottom {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr) 240px;
  gap: 0;
  border-top: 1px solid #1a2336;
  max-height: 220px;
}
.bottom section { min-width: 0; padding: 10px 14px; overflow: auto; border-right: 1px solid #1a2336; }
.bottom section:last-child { border-right: 0; }
.bottom dl, .bottom ul { display: grid; gap: 6px; margin: 8px 0 0; padding: 0; }
.bottom ul { list-style: none; }
.bottom li { display: grid; grid-template-columns: 52px minmax(40px, 1fr) 36px auto; gap: 8px; align-items: center; font-size: 12px; }
.track { height: 4px; border-radius: 2px; background: #1a2336; }
.fill { display: block; height: 100%; border-radius: 2px; background: linear-gradient(90deg, #3b82f6, #00e5ff); }
.bar-val, .bar-sub { font-variant-numeric: tabular-nums; color: #00e5ff; }
.bar-sub { color: #7a8ba3; }
.side-note { margin: 4px 0 0; font-size: 12px; }
@media (max-width: 960px) {
  .duty { height: auto; min-height: 100vh; overflow: auto; }
  .main, .bottom { grid-template-columns: 1fr; }
  .side, .bottom section { border-left: 0; border-right: 0; border-top: 1px solid #1a2336; }
}
</style>
