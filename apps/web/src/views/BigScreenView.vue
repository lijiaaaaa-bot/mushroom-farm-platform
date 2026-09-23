<script setup lang="ts">
import * as echarts from 'echarts';
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  ALERT_LEVEL_LABEL,
  ALERT_STATUS_LABEL,
  DEVICE_OFFLINE_AFTER_MS,
  DEVICE_TYPE_LABEL,
  ROLE_LABEL,
  shanghaiDate,
  shanghaiDayRange,
  type AlertLevel,
  type AlertStatus,
  type DeviceType,
  type Role,
} from '@mushroom/contracts';
import { errorText, http } from '../api';
import { currentUser, logout } from '../auth';
import ResultCard from '../components/ResultCard.vue';

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
  mapX?: number | null;
  mapY?: number | null;
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
  snapshotObjectKey: string | null;
  snapshotUrl: string | null;
}

interface Page<T> {
  items: T[];
  total: number;
}

interface TrendPoint {
  day: string;
  mushroomCount: number;
  capDiameterMean: number | null;
  sampleCount: number;
}

interface TrendShed {
  shedCode: string;
  points: TrendPoint[];
  cameras: { cameraCode: string; points: TrendPoint[] }[];
}

interface TrendResponse {
  days: number;
  from: string;
  to: string;
  sheds: TrendShed[];
}

type LayoutMode = 'command' | 'wall' | 'panels';
type SkinMode = 'light' | 'dark';

type PointTone = 'severe' | 'warning' | 'info' | 'online' | 'idle';

const REFRESH_MS = 30_000;
const SKIN_KEY = 'big-screen-skin';
const offlineMinutes = DEVICE_OFFLINE_AFTER_MS / 60_000;
const timelinePalette = ['#2F9E44', '#1B7A4E', '#F59E0B', '#6B8F71', '#E03131', '#8C6A43'];

const router = useRouter();
const now = ref(new Date());
const loading = ref(true);
const overview = ref<Overview | null>(null);
const sheds = ref<ShedRow[]>([]);
const alerts = ref<AlertRow[]>([]);
const devices = ref<DeviceRow[]>([]);
const recognitions = ref<RecognitionRow[]>([]);
const trend = ref<TrendResponse | null>(null);
const deviceTotal = ref(0);
const alertTotal = ref(0);
const recognitionTotal = ref(0);
const selectedCode = ref<string | null>(null);
const layout = ref<LayoutMode>('command');
const skin = ref<SkinMode>('light');
const pinnedId = ref<string | null>(null);
const focusedDay = ref<string | null>(null);
const timelineEl = ref<HTMLDivElement | null>(null);
const syncedAt = ref<Date | null>(null);
const zoneError = reactive({
  overview: '',
  sheds: '',
  alerts: '',
  devices: '',
  recognitions: '',
  trends: '',
});
let timelineChart: echarts.ECharts | null = null;

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
    const spot = resolvePoint(shed, sheds.value.length, index);
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

const wallCells = computed(() => {
  const seen = new Set<string>();
  const cells: RecognitionRow[] = [];
  for (const row of recognitions.value) {
    if (selectedCode.value && row.shedCode !== selectedCode.value) continue;
    const key = `${row.shedCode}\0${row.cameraCode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cells.push(row);
    if (cells.length >= 12) break;
  }
  return cells;
});

const chartSheds = computed(() => {
  const rows = trend.value?.sheds ?? [];
  const picked = selectedCode.value ? rows.filter((item) => item.shedCode === selectedCode.value) : rows;
  return picked.filter((item) => item.points.length > 0).slice(0, 6);
});

const axisDays = computed(() =>
  [...new Set(chartSheds.value.flatMap((item) => item.points.map((point) => point.day)))].sort(),
);

const pinned = computed(() => recognitions.value.find((row) => row.id === pinnedId.value) ?? null);

const linkDay = computed(() => {
  if (pinned.value) return shanghaiDate(new Date(pinned.value.recognizedAt));
  if (focusedDay.value) return focusedDay.value;
  const latest = recognitions.value[0];
  return latest ? shanghaiDate(new Date(latest.recognizedAt)) : '';
});

const linkShed = computed(
  () =>
    pinned.value?.shedCode ||
    selectedCode.value ||
    chartSheds.value[0]?.shedCode ||
    recognitions.value[0]?.shedCode ||
    '',
);

const trendsTo = computed(() => {
  const query: Record<string, string> = { days: '7' };
  if (linkShed.value) query.shedCode = linkShed.value;
  if (pinned.value) query.cameraCode = pinned.value.cameraCode;
  return { path: '/growth-trends', query };
});

const filterTo = computed(() => {
  if (!linkDay.value) return null;
  const { start, end } = shanghaiDayRange(linkDay.value);
  const query: Record<string, string> = {
    from: start.toISOString(),
    to: new Date(end.getTime() - 1).toISOString(),
  };
  if (linkShed.value) query.shedCode = linkShed.value;
  if (pinned.value) query.cameraCode = pinned.value.cameraCode;
  return { path: '/recognitions', query };
});

function readCoord(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

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

function resolvePoint(shed: ShedRow, count: number, index: number) {
  const x = readCoord(shed.mapX);
  const y = readCoord(shed.mapY);
  if (x !== null && y !== null) return { x, y };
  return placePoint(count, index);
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

function pinRecognition(id: string) {
  pinnedId.value = pinnedId.value === id ? null : id;
}

function applyStoredSkin() {
  skin.value = sessionStorage.getItem(SKIN_KEY) === 'dark' ? 'dark' : 'light';
}

function toggleSkin() {
  skin.value = skin.value === 'dark' ? 'light' : 'dark';
  sessionStorage.setItem(SKIN_KEY, skin.value);
}

function onTimelineClick(params: { dataIndex?: number | number[] }) {
  const index = Array.isArray(params.dataIndex) ? params.dataIndex[0] : params.dataIndex;
  const day = axisDays.value[index ?? -1];
  if (!day) return;
  focusedDay.value = day;
  pinnedId.value = null;
}

function timelineOption() {
  const dark = skin.value === 'dark';
  const ink = dark ? '#e7eee9' : '#1F2329';
  const mist = dark ? '#a8b5ac' : '#646A73';
  const split = dark ? '#3e4d44' : '#E5E6EB';
  const days = axisDays.value;
  return {
    backgroundColor: 'transparent',
    animation: false,
    textStyle: { color: mist },
    tooltip: { trigger: 'axis' },
    legend: { textStyle: { color: ink }, top: 0 },
    grid: { left: 48, right: 16, top: 28, bottom: 24 },
    xAxis: {
      type: 'category',
      data: days.map((day) => day.slice(5)),
      axisLabel: { color: mist },
      axisLine: { lineStyle: { color: split } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: mist },
      splitLine: { lineStyle: { color: split } },
    },
    series: chartSheds.value.map((item, index) => ({
      name: item.shedCode,
      type: 'line',
      connectNulls: false,
      showSymbol: true,
      itemStyle: { color: timelinePalette[index % timelinePalette.length] },
      data: days.map((day) => item.points.find((point) => point.day === day)?.mushroomCount ?? null),
    })),
  };
}

function renderTimeline() {
  if (layout.value !== 'panels' || !timelineEl.value || !axisDays.value.length) {
    timelineChart?.dispose();
    timelineChart = null;
    return;
  }
  timelineChart ??= echarts.init(timelineEl.value);
  timelineChart.off('click');
  timelineChart.on('click', onTimelineClick);
  timelineChart.setOption(timelineOption(), true);
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
  const [overviewResult, shedsResult, alertsResult, devicesResult, recognitionsResult, trendsResult] =
    await Promise.allSettled([
      http.get<Overview>('/dashboard/overview'),
      http.get<ShedRow[]>('/sheds'),
      http.get<Page<AlertRow>>('/alerts', { params: { pageSize: 50 } }),
      http.get<Page<DeviceRow>>('/devices', { params: { pageSize: 100 } }),
      http.get<Page<RecognitionRow>>('/ingest/recognitions', { params: { pageSize: 100 } }),
      http.get<TrendResponse>('/growth-trends', { params: { days: 7 } }),
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
    if (pinnedId.value && !recognitions.value.some((row) => row.id === pinnedId.value)) {
      pinnedId.value = null;
    }
  } else {
    zoneError.recognitions = errorText(recognitionsResult.reason);
  }

  if (trendsResult.status === 'fulfilled') {
    trend.value = trendsResult.value.data;
    zoneError.trends = '';
  } else {
    trend.value = null;
    zoneError.trends = errorText(trendsResult.reason);
  }

  const anyOk = [overviewResult, shedsResult, alertsResult, devicesResult, recognitionsResult, trendsResult].some(
    (result) => result.status === 'fulfilled',
  );
  if (anyOk) syncedAt.value = new Date();
  loading.value = false;
  await nextTick();
  renderTimeline();
}

watch(axisDays, (days) => {
  if (!focusedDay.value || !days.includes(focusedDay.value)) {
    focusedDay.value = days[days.length - 1] ?? null;
  }
});

watch([layout, skin, chartSheds, axisDays], () => {
  void nextTick().then(renderTimeline);
});

onMounted(() => {
  applyStoredSkin();
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
  timelineChart?.dispose();
  timelineChart = null;
});
</script>

<template>
  <div class="screen" :data-layout="layout" data-skin="tb-night" :class="{ 'skin-dark': skin === 'dark' }">
    <header class="zone top">
      <div class="brand">
        <span class="mark" aria-hidden="true"></span>
        <div>
          <p class="eyebrow">食用菌基地</p>
          <h1>基地大屏</h1>
        </div>
      </div>
      <p class="clock">{{ clockText }}</p>
      <div class="top-side">
        <p class="sync">{{ syncLabel }} · {{ REFRESH_MS / 1000 }}s</p>
        <p v-if="currentUser" class="who">{{ currentUser.displayName }} · {{ roleLabel }}</p>
        <div class="top-actions">
          <div class="layout-switch" role="group" aria-label="布局">
            <button type="button" class="text-btn" data-layout-choice="command" :aria-pressed="layout === 'command'" @click="layout = 'command'">指挥</button>
            <button type="button" class="text-btn" data-layout-choice="wall" :aria-pressed="layout === 'wall'" @click="layout = 'wall'">抓拍墙</button>
            <button type="button" class="text-btn" data-layout-choice="panels" :aria-pressed="layout === 'panels'" @click="layout = 'panels'">多区</button>
          </div>
          <button class="text-btn skin-toggle" type="button" :aria-pressed="skin === 'dark'" @click="toggleSkin">
            {{ skin === 'dark' ? '浅色' : '暗色' }}
          </button>
          <router-link class="text-btn" to="/">管理端</router-link>
          <button class="text-btn" type="button" @click="leave">退出</button>
        </div>
      </div>
    </header>

    <section class="zone metrics" aria-label="指标">
      <article v-for="tile in metricTiles" :key="tile.key" class="tile" :class="{ hot: tile.hot }">
        <p class="tile-label">{{ tile.label }}</p>
        <p class="tile-value">{{ tile.value }}</p>
        <p class="tile-hint">{{ tile.hint }}</p>
      </article>
      <p v-if="zoneError.overview" class="zone-error metric-error">{{ zoneError.overview }}</p>
    </section>

    <aside v-show="layout !== 'wall'" class="zone left">
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
    </aside>

    <main class="zone center wall">
      <div class="zone-head split">
        <h2>抓拍墙</h2>
        <span>
          各摄像头最近一张 · 最近 {{ recognitions.length }} 条
          <template v-if="recognitionTotal > recognitions.length"> / 共 {{ recognitionTotal }}</template>
        </span>
      </div>
      <p v-if="zoneError.recognitions" class="zone-error">{{ zoneError.recognitions }}</p>
      <p v-else-if="loading && !wallCells.length" class="muted">加载中…</p>
      <p v-else-if="!wallCells.length" class="muted">暂无识别记录，抓拍墙没有画面。</p>
      <div v-else class="wall-grid">
        <article v-for="cell in wallCells" :key="cell.id" class="wall-cell" :class="{ on: pinnedId === cell.id }">
          <ResultCard
            :id="cell.id"
            :snapshot-object-key="cell.snapshotObjectKey"
            :snapshot-url="cell.snapshotUrl"
          >
            <p class="wall-title">{{ cell.cameraCode }}</p>
            <p class="wall-meta">{{ cell.shedCode }} · {{ shortTime(cell.recognizedAt) }}</p>
            <p class="wall-counts">成熟 {{ cell.matureCount }}/{{ cell.mushroomCount }} · 病害 {{ cell.diseaseCount }}</p>
          </ResultCard>
          <button type="button" class="text-btn" @click="pinRecognition(cell.id)">对比此时段</button>
        </article>
      </div>
    </main>

    <aside v-show="layout !== 'wall'" class="zone right">
      <div class="zone-head split">
        <h2>告警</h2>
        <span>{{ visibleAlerts.length }}<template v-if="!selectedCode && alertTotal > alerts.length"> / {{ alertTotal }}</template></span>
      </div>
      <div class="scroll alert-scroll">
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
      <div v-if="layout === 'panels'" class="timeline-chart-wrap">
        <p v-if="zoneError.trends" class="zone-error">{{ zoneError.trends }}</p>
        <p v-else-if="loading && !trend" class="muted">加载中…</p>
        <p v-else-if="!axisDays.length" class="muted">近 7 日没有日聚合，时间轴没有点。</p>
        <div v-else ref="timelineEl" class="timeline-chart"></div>
      </div>
      <nav class="timeline-entry" aria-label="对比时间轴">
        <p class="ticker-label">时间轴</p>
        <router-link class="text-btn timeline-trends" :to="trendsTo">生长趋势</router-link>
        <router-link v-if="filterTo" class="text-btn timeline-filter" :to="filterTo">识别时段</router-link>
        <p v-else class="muted">暂无识别时间，不能按抓拍时段筛选。</p>
        <p v-if="layout !== 'panels' && zoneError.trends" class="zone-error">{{ zoneError.trends }}</p>
      </nav>
      <div class="bottom-row">
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
      </div>
    </footer>
  </div>
</template>

<style scoped>
.screen {
  --warn-ink: #9a6700;
  --idle: #94a3b8;
  box-sizing: border-box;
  height: 100vh;
  min-height: 640px;
  display: grid;
  grid-template-columns: minmax(240px, 20vw) minmax(0, 1.45fr) minmax(280px, 24vw);
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  gap: 8px;
  padding: 10px;
  color: var(--text-primary);
  color-scheme: light;
  background: var(--bg-app);
}

.screen.skin-dark {
  --bg-app: #141c18;
  --bg-app-alt: #1b2420;
  --bg-card: #24312b;
  --text-primary: #f3f7f4;
  --text-secondary: #b7c4bb;
  --line: #3a4a42;
  --accent: #3d9a62;
  --bg-sidebar: #1b7a4e;
  --warn: #f59e0b;
  --critical: #e03131;
  --warn-ink: #f59e0b;
  --idle: #6d7b72;
  color-scheme: dark;
}

.screen.skin-dark .top h1 {
  font-size: 28px;
}

.screen.skin-dark .wall-title {
  font-size: 16px;
}

.zone {
  min-width: 0;
  min-height: 0;
  position: relative;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg-card);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
}

.top {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: minmax(180px, 1fr) auto minmax(180px, 1fr);
  align-items: center;
  gap: 16px;
  padding: 10px 16px;
  border-top: 3px solid var(--bg-sidebar);
}

.metrics {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
}

.metrics .tile-value {
  font-size: 22px;
}

.metric-error {
  grid-column: 1 / -1;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.mark {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: var(--bg-sidebar);
  border: 1px solid var(--bg-sidebar);
}

.eyebrow {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.top h1,
.zone-head h2,
.detail h3 {
  margin: 0;
  font-weight: 600;
}

.top h1 {
  font-size: 22px;
  color: var(--text-primary);
}

.clock {
  margin: 0;
  font-variant-numeric: tabular-nums;
  font-size: 20px;
  color: var(--text-primary);
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
  color: var(--text-secondary);
  font-size: 12px;
}

.top-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 6px;
}

.text-btn {
  border: 1px solid var(--line);
  background: var(--bg-card);
  color: var(--text-primary);
  border-radius: 6px;
  padding: 2px 10px;
  font: inherit;
  font-size: 12px;
  text-decoration: none;
  cursor: pointer;
}

.text-btn:hover {
  border-color: var(--bg-sidebar);
  background: var(--bg-app);
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
  color: var(--text-primary);
}

.zone-head span,
.legend {
  color: var(--text-secondary);
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
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg-card);
  padding: 8px 10px;
}

.tile-label {
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px;
}

.tile-value,
.env-value,
.detail-code {
  margin: 2px 0 0;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
}

.tile-value {
  font-size: 28px;
  line-height: 1.1;
}

.tile.hot .tile-value {
  color: var(--critical);
}

.env-value {
  font-size: 22px;
}

.env-value small {
  margin-left: 4px;
  font-size: 11px;
  color: var(--text-secondary);
}

.scroll {
  min-height: 0;
  overflow: auto;
  flex: 1;
}

.alert-scroll {
  flex: none;
  max-height: 34%;
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
  border: 1px solid var(--line);
  border-left: 3px solid var(--bg-sidebar);
  border-radius: 6px;
  padding: 6px 8px;
  background: var(--bg-card);
}

.row[data-level='warning'] {
  border-left-color: var(--warn);
}

.row[data-level='severe'] {
  border-left-color: var(--critical);
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
  background: var(--bg-sidebar);
}

.row[data-level='warning'] .pip,
.swatch.warning {
  background: var(--warn);
}

.row[data-level='severe'] .pip,
.swatch.severe,
.tone-severe .dot {
  background: var(--critical);
}

.swatch.info,
.tone-info .dot {
  background: var(--text-secondary);
}

.swatch.online,
.status-dot.on,
.tone-online .dot {
  background: var(--bg-sidebar);
}

.status-dot.off,
.tone-idle .dot {
  background: var(--idle);
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
  min-height: 160px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 8px;
  background:
    linear-gradient(var(--line) 1px, transparent 1px),
    linear-gradient(90deg, var(--line) 1px, transparent 1px),
    var(--bg-app-alt);
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
  stroke: var(--line);
  stroke-width: 0.6;
}

.floor-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  margin: 0;
  color: var(--text-secondary);
}

.point {
  position: absolute;
  transform: translate(-50%, -50%);
  width: 132px;
  padding: 8px 10px 8px 22px;
  text-align: left;
  color: var(--text-primary);
  cursor: pointer;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg-card);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
}

.point.on,
.point:hover {
  border-color: var(--bg-sidebar);
  background: var(--bg-app);
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
  background: var(--warn);
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
  color: var(--text-primary);
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
  color: var(--text-secondary);
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
  color: var(--text-secondary);
  font-size: 12px;
}

.detail dd {
  margin: 2px 0 0;
  font-size: 13px;
}

.zone-error {
  margin: 0;
  color: var(--critical);
  font-size: 12px;
}

.bottom {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  min-height: 46px;
  padding: 8px 12px;
}

.bottom-row,
.timeline-entry {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.bottom-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
}

.timeline-chart {
  height: 140px;
  width: 100%;
}

.timeline-chart-wrap {
  min-width: 0;
}

.ticker-label {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--bg-sidebar);
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
  color: var(--critical);
}

.tick[data-tone='warning'] {
  color: var(--warn-ink);
}

.tick[data-tone='info'] {
  color: var(--text-primary);
}

@keyframes ticker {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(-50%);
  }
}

.screen[data-layout='wall'] {
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto auto minmax(0, 1fr) auto;
}

.screen[data-layout='panels'] {
  grid-template-columns: minmax(220px, 18vw) minmax(0, 1.45fr) minmax(260px, 22vw);
  grid-template-rows: auto auto minmax(0, 1fr) auto;
}

.screen[data-layout='panels'] .top,
.screen[data-layout='panels'] .metrics,
.screen[data-layout='panels'] .bottom {
  grid-column: 1 / -1;
}

.screen[data-layout='panels'] .top {
  grid-row: 1;
}

.screen[data-layout='panels'] .metrics {
  grid-row: 2;
}

.screen[data-layout='panels'] .left {
  grid-column: 1;
  grid-row: 3;
}

.screen[data-layout='panels'] .center {
  grid-column: 2;
  grid-row: 3;
}

.screen[data-layout='panels'] .right {
  grid-column: 3;
  grid-row: 3;
}

.screen[data-layout='panels'] .bottom {
  grid-row: 4;
}

.layout-switch {
  display: inline-flex;
  gap: 4px;
}

.layout-switch button[aria-pressed='true'] {
  border-color: var(--bg-sidebar);
  color: var(--bg-sidebar);
  background: var(--bg-app);
}

.wall {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow: auto;
  padding: 12px;
}

.wall-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 8px;
  align-content: start;
}

.wall-title,
.wall-meta,
.wall-counts {
  margin: 0;
}

.wall-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.wall-meta,
.wall-counts {
  font-size: 12px;
  color: var(--text-secondary);
}

.wall-cell.on {
  outline: 2px solid var(--accent);
  border-radius: var(--radius-card);
}

.wall-cell .text-btn {
  margin-top: 8px;
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

  .metrics,
  .screen[data-layout='panels'] .left,
  .screen[data-layout='panels'] .center,
  .screen[data-layout='panels'] .right,
  .screen[data-layout='panels'] .metrics,
  .screen[data-layout='panels'] .bottom {
    grid-column: 1;
    grid-row: auto;
  }

  .metrics {
    grid-template-columns: 1fr 1fr;
  }
}

.screen[data-skin='tb-night'] {
  background: #0b1e33;
  color: #e7eef6;
  color-scheme: dark;
}

.screen[data-skin='tb-night'] .zone,
.screen[data-skin='tb-night'] .tile,
.screen[data-skin='tb-night'] .env-tile,
.screen[data-skin='tb-night'] .detail,
.screen[data-skin='tb-night'] .row,
.screen[data-skin='tb-night'] .point,
.screen[data-skin='tb-night'] .text-btn {
  background: #12304a;
  border-color: #1e4a6e;
  color: #e7eef6;
}

.screen[data-skin='tb-night'] .top h1,
.screen[data-skin='tb-night'] .zone-head h2,
.screen[data-skin='tb-night'] .detail h3,
.screen[data-skin='tb-night'] .clock,
.screen[data-skin='tb-night'] .point-code,
.screen[data-skin='tb-night'] .row-title,
.screen[data-skin='tb-night'] .detail dd {
  color: #e7eef6;
}

.screen[data-skin='tb-night'] .muted,
.screen[data-skin='tb-night'] .eyebrow,
.screen[data-skin='tb-night'] .tile-label,
.screen[data-skin='tb-night'] .caption,
.screen[data-skin='tb-night'] .sync,
.screen[data-skin='tb-night'] .who,
.screen[data-skin='tb-night'] .row-sub,
.screen[data-skin='tb-night'] .row-meta,
.screen[data-skin='tb-night'] .point-meta,
.screen[data-skin='tb-night'] .zone-head span,
.screen[data-skin='tb-night'] .legend,
.screen[data-skin='tb-night'] .detail dt,
.screen[data-skin='tb-night'] .floor-empty,
.screen[data-skin='tb-night'] .ticker-count {
  color: #9fb3c8;
}

.screen[data-skin='tb-night'] .floor {
  border-color: #1e4a6e;
  background:
    linear-gradient(#1e4666 1px, transparent 1px),
    linear-gradient(90deg, #1e4666 1px, transparent 1px),
    #0e2942;
  background-size: 40px 40px, 40px 40px, auto;
}

.screen[data-skin='tb-night'] .mark {
  background: #1f6b4a;
  border-color: #1f6b4a;
}

.screen[data-skin='tb-night'] .tile-value,
.screen[data-skin='tb-night'] .env-value,
.screen[data-skin='tb-night'] .detail-code,
.screen[data-skin='tb-night'] .ticker-label {
  color: #6fce8a;
}

.screen[data-skin='tb-night'] .point.on,
.screen[data-skin='tb-night'] .point:hover,
.screen[data-skin='tb-night'] .text-btn:hover {
  background: #184060;
  border-color: #6fce8a;
}

.screen[data-skin='tb-night'] .aisle path {
  stroke: #2a5a80;
}
</style>
