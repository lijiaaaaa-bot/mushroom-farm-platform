<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  ALERT_LEVEL_LABEL,
  ALERT_STATUS_LABEL,
  DEVICE_OFFLINE_AFTER_MS,
  DEVICE_TYPE_LABEL,
  ROLE_LABEL,
  type AlertLevel,
  type AlertStatus,
  type DeviceType,
  type Role,
} from '@mushroom/contracts';
import { errorText, http } from '../api';
import { currentUser, logout } from '../auth';

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
  location: string | null;
}

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

interface DeviceRow {
  id: string;
  code: string;
  name: string;
  type: DeviceType;
  shedCode: string;
  onlineStatus: string;
  lastSeenAt: string | null;
}

interface RecognitionRow {
  id: string;
  shedCode: string;
  cameraCode: string;
  recognizedAt: string;
  mushroomCount: number;
  matureCount: number;
  diseaseCount: number;
  temperature: number | null;
  humidity: number | null;
  co2: number | null;
  substrateMoisture: number | null;
}

interface Page<T> {
  items: T[];
  total: number;
}

type PointTone = 'severe' | 'warning' | 'info' | 'online' | 'idle';

const REFRESH_MS = 30_000;
const offlineMinutes = DEVICE_OFFLINE_AFTER_MS / 60_000;

const router = useRouter();
const now = ref(new Date());
const loading = ref(true);
const overview = ref<Overview | null>(null);
const sheds = ref<ShedRow[]>([]);
const alerts = ref<AlertRow[]>([]);
const devices = ref<DeviceRow[]>([]);
const recognitions = ref<RecognitionRow[]>([]);
const deviceTotal = ref(0);
const alertTotal = ref(0);
const recognitionTotal = ref(0);
const selectedCode = ref<string | null>(null);
const syncedAt = ref<Date | null>(null);
const zoneError = reactive({
  overview: '',
  sheds: '',
  alerts: '',
  devices: '',
  recognitions: '',
});

let clockTimer = 0;
let pollTimer = 0;
let loadSeq = 0;

const roleLabel = computed(() => {
  const role = currentUser.value?.role;
  return role ? ROLE_LABEL[role as Role] : '';
});

const clockText = computed(() => formatClock(now.value));

const syncLabel = computed(() => {
  const failed = Object.values(zoneError).filter(Boolean).length;
  if (loading.value && !syncedAt.value) return '同步中';
  const time = syncedAt.value ? formatClock(syncedAt.value, true) : '';
  if (failed && time) return `${time} · ${failed} 项失败`;
  if (failed) return `${failed} 项失败`;
  if (time) return `更新 ${time}`;
  return '未同步';
});

const metricTiles = computed(() => {
  const summary = overview.value;
  const open = alerts.value.filter((row) => row.status !== 'closed');
  const online = devices.value.filter((row) => row.onlineStatus === 'online').length;
  const severe = open.filter((row) => row.level === 'severe').length;
  return [
    {
      key: 'sheds',
      label: '棚区',
      value: String(summary?.shedCount ?? sheds.value.length),
      hint: '当前账号可见',
      hot: false,
    },
    {
      key: 'devices',
      label: '设备在线',
      value: `${summary?.deviceOnline ?? online}/${summary?.deviceTotal ?? devices.value.length}`,
      hint: `离线判定 ${offlineMinutes} 分钟`,
      hot: false,
    },
    {
      key: 'mature',
      label: '今日成熟',
      value: summary ? String(summary.todayMature) : '—',
      hint: summary ? `菇数 ${summary.todayMushroom}` : '汇总未返回',
      hot: false,
    },
    {
      key: 'alerts',
      label: '未关闭告警',
      value: String(summary?.openAlerts ?? open.length),
      hint: `严重 ${summary?.severeAlerts ?? severe}`,
      hot: (summary?.openAlerts ?? open.length) > 0,
    },
  ];
});

const points = computed(() =>
  sheds.value.map((shed, index) => {
    const open = alerts.value.filter((row) => row.shedCode === shed.code && row.status !== 'closed');
    const shedDevices = devices.value.filter((row) => row.shedCode === shed.code);
    const online = shedDevices.filter((row) => row.onlineStatus === 'online').length;
    const spot = placePoint(sheds.value.length, index);
    return {
      shed,
      x: spot.x,
      y: spot.y,
      tone: pointTone(open, online),
      openAlerts: open.length,
      online,
      totalDevices: shedDevices.length,
    };
  }),
);

const aisle = computed(() => {
  if (points.value.length < 2) return '';
  return points.value
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
});

const selectedPoint = computed(
  () => points.value.find((point) => point.shed.code === selectedCode.value) ?? null,
);

const visibleAlerts = computed(() =>
  selectedCode.value
    ? alerts.value.filter((row) => row.shedCode === selectedCode.value)
    : alerts.value,
);

const visibleDevices = computed(() => {
  const rows = selectedCode.value
    ? devices.value.filter((row) => row.shedCode === selectedCode.value)
    : devices.value;
  return rows;
});

const envReadout = computed(() => {
  if (selectedCode.value) {
    const latest = recognitions.value.find((row) => row.shedCode === selectedCode.value);
    if (latest) {
      return {
        caption: `${latest.shedCode} · ${latest.cameraCode} 最近一条`,
        temp: latest.temperature,
        humidity: latest.humidity,
        co2: latest.co2,
        moisture: latest.substrateMoisture,
      };
    }
    return {
      caption: `${selectedCode.value} 暂无识别记录`,
      temp: null,
      humidity: null,
      co2: null,
      moisture: null,
    };
  }
  const env = overview.value?.env;
  return {
    caption: overview.value ? '可见棚最近记录均值' : '环境汇总未返回',
    temp: env?.avgTemp ?? null,
    humidity: env?.avgHumidity ?? null,
    co2: env?.avgCo2 ?? null,
    moisture: env?.avgSubstrateMoisture ?? null,
  };
});

const envTiles = computed(() => [
  { key: 'temp', label: '温度', value: formatNumber(envReadout.value.temp, 1), unit: '°C' },
  { key: 'humidity', label: '湿度', value: formatNumber(envReadout.value.humidity, 1), unit: '%' },
  { key: 'co2', label: 'CO₂', value: formatNumber(envReadout.value.co2, 0), unit: 'ppm' },
  { key: 'moisture', label: '基质含水', value: formatNumber(envReadout.value.moisture, 1), unit: '%' },
]);

const tickerItems = computed(() => {
  const fromAlerts = alerts.value
    .filter((row) => row.status !== 'closed')
    .slice(0, 12)
    .map((row) => ({
      id: `alert-${row.id}`,
      tone: row.level,
      text: `${ALERT_LEVEL_LABEL[row.level]} · ${row.shedCode}${row.cameraCode ? `/${row.cameraCode}` : ''} · ${row.title}`,
    }));
  const fromRecords = recognitions.value.slice(0, 12).map((row) => ({
    id: `rec-${row.id}`,
    tone: row.diseaseCount > 0 ? ('warning' as const) : ('info' as const),
    text: `${row.shedCode} · ${row.cameraCode} · 成熟 ${row.matureCount}/${row.mushroomCount} · 病害 ${row.diseaseCount} · ${shortTime(row.recognizedAt)}`,
  }));
  return [...fromAlerts, ...fromRecords];
});

const tickerSeconds = computed(() => `${Math.max(28, tickerItems.value.length * 5)}s`);

const selectedLatest = computed(() =>
  recognitions.value.find((row) => row.shedCode === selectedCode.value) ?? null,
);

function placePoint(count: number, index: number) {
  if (count <= 1) return { x: 50, y: 46 };
  const cols = count <= 4 ? count : Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: 14 + ((col + 0.5) / cols) * 72,
    y: 16 + ((row + 0.5) / rows) * 68,
  };
}

function pointTone(open: AlertRow[], online: number): PointTone {
  if (open.some((row) => row.level === 'severe')) return 'severe';
  if (open.some((row) => row.level === 'warning')) return 'warning';
  if (open.length) return 'info';
  if (online > 0) return 'online';
  return 'idle';
}

function formatNumber(value: number | null, digits: number) {
  if (value === null || Number.isNaN(value)) return '—';
  return digits === 0 ? String(Math.round(value)) : value.toFixed(digits);
}

function formatClock(date: Date, timeOnly = false) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    year: timeOnly ? undefined : 'numeric',
    month: timeOnly ? undefined : '2-digit',
    day: timeOnly ? undefined : '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

function shortTime(iso: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function selectShed(code: string) {
  selectedCode.value = selectedCode.value === code ? null : code;
}

function clearShed() {
  selectedCode.value = null;
}

function leave() {
  logout();
  void router.push('/login');
}

async function load() {
  const seq = ++loadSeq;
  const [overviewResult, shedsResult, alertsResult, devicesResult, recognitionsResult] =
    await Promise.allSettled([
      http.get<Overview>('/dashboard/overview'),
      http.get<ShedRow[]>('/sheds'),
      http.get<Page<AlertRow>>('/alerts', { params: { pageSize: 50 } }),
      http.get<Page<DeviceRow>>('/devices', { params: { pageSize: 100 } }),
      http.get<Page<RecognitionRow>>('/ingest/recognitions', { params: { pageSize: 30 } }),
    ]);
  if (seq !== loadSeq) return;

  if (overviewResult.status === 'fulfilled') {
    overview.value = overviewResult.value.data;
    zoneError.overview = '';
  } else {
    zoneError.overview = errorText(overviewResult.reason);
  }

  if (shedsResult.status === 'fulfilled') {
    sheds.value = shedsResult.value.data;
    zoneError.sheds = '';
    if (selectedCode.value && !sheds.value.some((row) => row.code === selectedCode.value)) {
      selectedCode.value = null;
    }
  } else {
    zoneError.sheds = errorText(shedsResult.reason);
  }

  if (alertsResult.status === 'fulfilled') {
    alerts.value = alertsResult.value.data.items;
    alertTotal.value = alertsResult.value.data.total;
    zoneError.alerts = '';
  } else {
    zoneError.alerts = errorText(alertsResult.reason);
  }

  if (devicesResult.status === 'fulfilled') {
    devices.value = devicesResult.value.data.items;
    deviceTotal.value = devicesResult.value.data.total;
    zoneError.devices = '';
  } else {
    zoneError.devices = errorText(devicesResult.reason);
  }

  if (recognitionsResult.status === 'fulfilled') {
    recognitions.value = recognitionsResult.value.data.items;
    recognitionTotal.value = recognitionsResult.value.data.total;
    zoneError.recognitions = '';
  } else {
    zoneError.recognitions = errorText(recognitionsResult.reason);
  }

  const anyOk = [overviewResult, shedsResult, alertsResult, devicesResult, recognitionsResult].some(
    (result) => result.status === 'fulfilled',
  );
  if (anyOk) syncedAt.value = new Date();
  loading.value = false;
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
  <div class="screen">
    <header class="zone top">
      <div class="brand">
        <span class="mark" aria-hidden="true"></span>
        <div>
          <p class="eyebrow">食用菌基地</p>
          <h1>菇棚监测</h1>
        </div>
      </div>
      <p class="clock">{{ clockText }}</p>
      <div class="top-side">
        <p class="sync">{{ syncLabel }} · {{ REFRESH_MS / 1000 }}s</p>
        <p v-if="currentUser" class="who">{{ currentUser.displayName }} · {{ roleLabel }}</p>
        <div class="top-actions">
          <router-link class="text-btn" to="/">管理端</router-link>
          <button class="text-btn" type="button" @click="leave">退出</button>
        </div>
      </div>
    </header>

    <aside class="zone left">
      <div class="zone-head">
        <h2>指标</h2>
      </div>
      <div class="metric-grid">
        <article v-for="tile in metricTiles" :key="tile.key" class="tile" :class="{ hot: tile.hot }">
          <p class="tile-label">{{ tile.label }}</p>
          <p class="tile-value">{{ tile.value }}</p>
          <p class="tile-hint">{{ tile.hint }}</p>
        </article>
      </div>
      <p v-if="zoneError.overview" class="zone-error">{{ zoneError.overview }}</p>

      <div class="zone-head split">
        <h2>告警</h2>
        <span>{{ visibleAlerts.length }}<template v-if="!selectedCode && alertTotal > alerts.length"> / {{ alertTotal }}</template></span>
      </div>
      <div class="scroll">
        <p v-if="zoneError.alerts" class="zone-error">{{ zoneError.alerts }}</p>
        <p v-else-if="loading && !alerts.length" class="muted">加载中…</p>
        <p v-else-if="!visibleAlerts.length" class="muted">暂无告警。</p>
        <ul v-else class="rows">
          <li v-for="row in visibleAlerts" :key="row.id" class="row" :data-level="row.level">
            <div class="row-main">
              <span class="pip"></span>
              <div>
                <p class="row-title">
                  {{ ALERT_LEVEL_LABEL[row.level] }} · {{ row.shedCode }} · {{ row.title }}
                </p>
                <p class="row-sub">{{ row.message }}</p>
              </div>
            </div>
            <p class="row-meta">{{ ALERT_STATUS_LABEL[row.status] }} · {{ shortTime(row.createdAt) }}</p>
          </li>
        </ul>
      </div>
    </aside>

    <main class="zone center">
      <div class="zone-head split">
        <h2>棚区平面</h2>
        <div class="legend">
          <span><i class="swatch online"></i>在线</span>
          <span><i class="swatch info"></i>提示</span>
          <span><i class="swatch warning"></i>一般</span>
          <span><i class="swatch severe"></i>严重</span>
          <button v-if="selectedCode" class="text-btn" type="button" @click="clearShed">全部棚区</button>
        </div>
      </div>
      <div class="floor">
        <svg v-if="aisle" class="aisle" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path :d="aisle" />
        </svg>
        <p v-if="zoneError.sheds" class="floor-empty">{{ zoneError.sheds }}</p>
        <p v-else-if="loading && !points.length" class="floor-empty">加载中…</p>
        <p v-else-if="!points.length" class="floor-empty">当前账号没有可见棚区。</p>
        <button
          v-for="point in points"
          :key="point.shed.id"
          class="point"
          :class="[`tone-${point.tone}`, { on: selectedCode === point.shed.code }]"
          :style="{ left: `${point.x}%`, top: `${point.y}%` }"
          type="button"
          :aria-pressed="selectedCode === point.shed.code"
          @click="selectShed(point.shed.code)"
        >
          <span class="dot"></span>
          <span class="point-code">{{ point.shed.code }}</span>
          <span class="point-name">{{ point.shed.name }}</span>
          <span class="point-meta">设备 {{ point.online }}/{{ point.totalDevices }} · 告警 {{ point.openAlerts }}</span>
        </button>
      </div>
      <section v-if="selectedPoint" class="detail">
        <div>
          <p class="detail-code">{{ selectedPoint.shed.code }}</p>
          <h3>{{ selectedPoint.shed.name }}</h3>
          <p class="muted">{{ selectedPoint.shed.location || '未填位置' }}</p>
        </div>
        <dl>
          <div><dt>设备在线</dt><dd>{{ selectedPoint.online }}/{{ selectedPoint.totalDevices }}</dd></div>
          <div><dt>未关闭告警</dt><dd>{{ selectedPoint.openAlerts }}</dd></div>
          <div>
            <dt>最近识别</dt>
            <dd v-if="selectedLatest">
              成熟 {{ selectedLatest.matureCount }}/{{ selectedLatest.mushroomCount }} · 病害 {{ selectedLatest.diseaseCount }}
            </dd>
            <dd v-else>暂无识别记录</dd>
          </div>
        </dl>
      </section>
    </main>

    <aside class="zone right">
      <div class="zone-head split">
        <h2>环境</h2>
        <span class="caption">{{ envReadout.caption }}</span>
      </div>
      <div class="env-grid">
        <article v-for="tile in envTiles" :key="tile.key" class="env-tile">
          <p class="tile-label">{{ tile.label }}</p>
          <p class="env-value">{{ tile.value }}<small v-if="tile.value !== '—'">{{ tile.unit }}</small></p>
        </article>
      </div>
      <p v-if="zoneError.overview && !selectedCode" class="zone-error">{{ zoneError.overview }}</p>
      <p v-else-if="zoneError.recognitions && selectedCode" class="zone-error">{{ zoneError.recognitions }}</p>

      <div class="zone-head split">
        <h2>设备</h2>
        <span>
          {{ visibleDevices.length }}
          <template v-if="!selectedCode && deviceTotal > devices.length"> / {{ deviceTotal }}</template>
        </span>
      </div>
      <div class="scroll">
        <p v-if="zoneError.devices" class="zone-error">{{ zoneError.devices }}</p>
        <p v-else-if="loading && !devices.length" class="muted">加载中…</p>
        <p v-else-if="!visibleDevices.length" class="muted">暂无设备。识别上报会自动建档。</p>
        <ul v-else class="rows">
          <li v-for="row in visibleDevices" :key="row.id" class="row device">
            <div class="row-main">
              <span class="status-dot" :class="row.onlineStatus === 'online' ? 'on' : 'off'"></span>
              <div>
                <p class="row-title">{{ row.code }} · {{ row.name }}</p>
                <p class="row-sub">{{ DEVICE_TYPE_LABEL[row.type] }} · {{ row.shedCode }} · {{ row.onlineStatus === 'online' ? '在线' : '离线' }}</p>
              </div>
            </div>
            <p class="row-meta">{{ row.lastSeenAt ? shortTime(row.lastSeenAt) : '无心跳' }}</p>
          </li>
        </ul>
      </div>
    </aside>

    <footer class="zone bottom">
      <p class="ticker-label">滚动</p>
      <div class="ticker-window">
        <p v-if="zoneError.recognitions && !tickerItems.length" class="muted">{{ zoneError.recognitions }}</p>
        <p v-else-if="loading && !tickerItems.length" class="muted">加载中…</p>
        <p v-else-if="!tickerItems.length" class="muted">暂无告警与识别记录。</p>
        <div v-else class="ticker-track" :style="{ animationDuration: tickerSeconds }">
          <div class="ticker-group">
            <span v-for="item in tickerItems" :key="item.id" class="tick" :data-tone="item.tone">{{ item.text }}</span>
          </div>
          <div class="ticker-group" aria-hidden="true">
            <span v-for="item in tickerItems" :key="`${item.id}-dup`" class="tick" :data-tone="item.tone">{{ item.text }}</span>
          </div>
        </div>
      </div>
      <p v-if="recognitionTotal" class="ticker-count">记录 {{ recognitionTotal }}</p>
    </footer>
  </div>
</template>

<style scoped>
.screen {
  box-sizing: border-box;
  height: 100vh;
  min-height: 640px;
  display: grid;
  grid-template-columns: minmax(280px, 22vw) minmax(0, 1fr) minmax(300px, 24vw);
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 12px;
  padding: 12px;
  color: #24362b;
  color-scheme: light;
  background:
    radial-gradient(900px 420px at 80% -10%, rgba(255, 214, 140, 0.45), transparent 55%),
    linear-gradient(180deg, #f7fbf4 0%, #e7f2df 100%);
}

.zone {
  min-width: 0;
  min-height: 0;
  position: relative;
  border: 1px solid #d7e6cf;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 10px 28px rgba(47, 90, 48, 0.06);
}

.top {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: minmax(180px, 1fr) auto minmax(180px, 1fr);
  align-items: center;
  gap: 16px;
  padding: 10px 16px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.mark {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  background:
    radial-gradient(circle at 50% 62%, #2f7d46 0 7px, transparent 8px),
    linear-gradient(#e7f6ea, #d7efd4);
  border: 1px solid #b7d7b4;
}

.eyebrow {
  margin: 0;
  font-size: 12px;
  color: #5d7364;
}

.top h1,
.zone-head h2,
.detail h3 {
  margin: 0;
  font-weight: 600;
}

.top h1 {
  font-size: 22px;
  color: #1d3b28;
}

.clock {
  margin: 0;
  font-variant-numeric: tabular-nums;
  font-size: 20px;
  color: #1d3b28;
}

.top-side {
  justify-self: end;
  text-align: right;
}

.sync,
.who,
.caption,
.ticker-count,
.muted,
.tile-hint,
.row-sub,
.row-meta {
  margin: 0;
  color: #5d7364;
  font-size: 12px;
}

.top-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 6px;
}

.text-btn {
  border: 1px solid #b7d7b4;
  background: #fff;
  color: #1d3b28;
  border-radius: 999px;
  padding: 2px 10px;
  font: inherit;
  font-size: 12px;
  text-decoration: none;
  cursor: pointer;
}

.text-btn:hover {
  border-color: #2f7d46;
  background: #f3faf4;
}

.left,
.right,
.center {
  display: flex;
  flex-direction: column;
  padding: 12px 12px 10px;
  gap: 8px;
}

.zone-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.zone-head h2 {
  font-size: 15px;
  color: #1d3b28;
}

.zone-head span,
.legend {
  color: #5d7364;
  font-size: 12px;
}

.metric-grid,
.env-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.tile,
.env-tile,
.detail {
  border: 1px solid #e3eedf;
  border-radius: 12px;
  background: #f7fbf4;
  padding: 8px 10px;
}

.tile-label {
  margin: 0;
  color: #5d7364;
  font-size: 12px;
}

.tile-value,
.env-value,
.detail-code {
  margin: 2px 0 0;
  font-variant-numeric: tabular-nums;
  color: #2f7d46;
}

.tile-value {
  font-size: 28px;
  line-height: 1.1;
}

.tile.hot .tile-value {
  color: #c44536;
}

.env-value {
  font-size: 22px;
}

.env-value small {
  margin-left: 4px;
  font-size: 11px;
  color: #5d7364;
}

.scroll {
  min-height: 0;
  overflow: auto;
  flex: 1;
}

.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.row {
  border: 1px solid #e3eedf;
  border-left: 3px solid #2f7d46;
  border-radius: 10px;
  padding: 6px 8px;
  background: #fff;
}

.row[data-level='warning'] {
  border-left-color: #c48a16;
}

.row[data-level='severe'] {
  border-left-color: #c44536;
}

.row-main {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.row-title {
  margin: 0;
  font-size: 13px;
}

.pip,
.status-dot,
.swatch {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
  flex: none;
  margin-top: 5px;
  background: #2f7d46;
}

.row[data-level='warning'] .pip,
.swatch.warning {
  background: #c48a16;
}

.row[data-level='severe'] .pip,
.swatch.severe,
.tone-severe .dot {
  background: #c44536;
}

.swatch.info,
.tone-info .dot {
  background: #3b82b0;
}

.swatch.online,
.status-dot.on,
.tone-online .dot {
  background: #2f7d46;
}

.status-dot.off,
.tone-idle .dot {
  background: #9aafa0;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  font-family: "Noto Sans SC", sans-serif;
}

.legend .swatch {
  margin: 0 4px 0 0;
}

.floor {
  position: relative;
  flex: 1;
  min-height: 280px;
  overflow: hidden;
  border: 1px solid #d5e6cf;
  border-radius: 14px;
  background:
    linear-gradient(#d7e8cf 1px, transparent 1px),
    linear-gradient(90deg, #d7e8cf 1px, transparent 1px),
    linear-gradient(180deg, #f4faef, #e5f3dc);
  background-size: 40px 40px, 40px 40px, auto;
}

.aisle {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.aisle path {
  fill: none;
  stroke: #b7cda8;
  stroke-width: 0.6;
}

.floor-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  margin: 0;
  color: #5d7364;
}

.point {
  position: absolute;
  transform: translate(-50%, -50%);
  width: 148px;
  padding: 8px 10px 8px 22px;
  text-align: left;
  color: #24362b;
  cursor: pointer;
  border: 1px solid #d3e4cc;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 8px 18px rgba(47, 90, 48, 0.08);
}

.point.on,
.point:hover {
  border-color: #2f7d46;
  background: #f3faf4;
  z-index: 1;
}

.point .dot {
  position: absolute;
  left: 8px;
  top: 12px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.tone-warning .dot {
  background: #c48a16;
}

.point-code,
.point-name,
.point-meta,
.detail-code {
  display: block;
}

.point-code {
  font-size: 13px;
  font-weight: 600;
  color: #1d3b28;
}

.point-name,
.point-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.point-name {
  font-size: 12px;
}

.point-meta {
  color: #5d7364;
  font-size: 11px;
}

.detail {
  display: grid;
  grid-template-columns: minmax(140px, 0.8fr) 1.4fr;
  gap: 12px;
  align-items: center;
}

.detail dl {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}

.detail dt {
  color: #5d7364;
  font-size: 12px;
}

.detail dd {
  margin: 2px 0 0;
  font-size: 13px;
}

.zone-error {
  margin: 0;
  color: #a33b32;
  font-size: 12px;
}

.bottom {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-height: 46px;
  padding: 0 12px;
}

.ticker-label {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: #2f7d46;
}

.ticker-window {
  overflow: hidden;
  min-width: 0;
}

.ticker-track {
  display: flex;
  width: max-content;
  animation: ticker linear infinite;
}

.ticker-group {
  display: flex;
  gap: 28px;
  padding-right: 28px;
}

.tick {
  white-space: nowrap;
  font-size: 13px;
}

.tick[data-tone='severe'] {
  color: #c44536;
}

.tick[data-tone='warning'] {
  color: #9a6700;
}

.tick[data-tone='info'] {
  color: #245c48;
}

@keyframes ticker {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(-50%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ticker-track {
    animation: none;
    width: auto;
    flex-wrap: wrap;
  }

  .ticker-group[aria-hidden='true'] {
    display: none;
  }
}

@media (max-width: 1100px) {
  .screen {
    height: auto;
    min-height: 100vh;
    grid-template-columns: 1fr;
    grid-template-rows: auto;
  }

  .top {
    grid-template-columns: 1fr;
  }

  .top-side,
  .clock {
    justify-self: start;
    text-align: left;
  }

  .top-actions {
    justify-content: flex-start;
  }

  .floor {
    min-height: 420px;
  }

  .detail,
  .detail dl {
    grid-template-columns: 1fr;
  }
}
</style>
