<script setup lang="ts">
import * as echarts from 'echarts';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  ALERT_LEVEL_LABEL,
  ALERT_METRIC_LABEL,
  ALERT_STATUS_LABEL,
  type AlertLevel,
  type AlertMetric,
  type AlertStatus,
} from '@mushroom/contracts';
import { errorText, http } from '../api';
import { farmOpsTokens as tokens } from '../farm-ops-tokens';

interface TrendPoint {
  day: string;
  mushroom: number;
  mature: number;
  disease: number;
}

interface AlertItem {
  id: string;
  shedCode: string;
  cameraCode: string | null;
  level: AlertLevel;
  status: AlertStatus;
  title: string;
  createdAt: string;
}

interface RecordItem {
  id: string;
  shedCode: string;
  cameraCode: string;
  recognizedAt: string;
  mushroomCount: number;
  matureCount: number;
  diseaseCount: number;
}

interface Overview {
  shedCount?: number;
  deviceTotal?: number;
  deviceOnline?: number;
  todayMushroom?: number;
  todayMature?: number;
  harvestableCameras?: number;
  openAlerts?: number;
  severeAlerts?: number;
  env?: {
    avgTemp: number | null;
    avgHumidity: number | null;
    avgCo2: number | null;
    avgSubstrateMoisture: number | null;
  };
  trend?: TrendPoint[];
  recentAlerts?: AlertItem[];
  recentRecords?: RecordItem[];
}

interface ShedItem {
  id: string;
  code: string;
  name: string;
  location: string | null;
  mapX: number | null;
  mapY: number | null;
}

interface DeviceItem {
  shedCode: string;
  onlineStatus: string;
}

interface HarvestItem {
  shedCode: string;
  matureCount: number;
  mushroomCount: number;
}

interface EnvItem {
  shedCode: string;
  sensorCode: string;
  observedAt: string;
  temperature: number | null;
  humidity: number | null;
}

interface RuleItem {
  metric: AlertMetric;
  threshold: number;
  level: AlertLevel;
  enabled: boolean;
  name: string;
  shedCode: string | null;
}

const SERIES = ['#3B6EA5', '#2F9E44', '#C48A16', '#7A6BB5', '#3D8B8B', '#C44536'];
const MATURE_COLOR = tokens.accent;
const TOTAL_COLOR = '#3B6EA5';
const DISEASE_COLOR = tokens.critical;

const loading = ref(true);
const error = ref('');
const data = ref<Overview | null>(null);
const sheds = ref<ShedItem[]>([]);
const devices = ref<DeviceItem[]>([]);
const harvestItems = ref<HarvestItem[]>([]);
const envReadings = ref<EnvItem[]>([]);
const rules = ref<RuleItem[]>([]);
const shedsError = ref('');
const devicesError = ref('');
const harvestError = ref('');
const envError = ref('');
const chartEl = ref<HTMLDivElement | null>(null);
const tempEl = ref<HTMLDivElement | null>(null);
const charts: echarts.ECharts[] = [];

const trend = computed(() => data.value?.trend ?? []);
const alerts = computed(() => data.value?.recentAlerts ?? []);
const records = computed(() => data.value?.recentRecords ?? []);

type FloorTone = 'severe' | 'warning' | 'online' | 'idle';

interface FloorShed {
  id: string;
  code: string;
  name: string;
  x: number;
  y: number;
  placed: boolean;
  tone: FloorTone;
  online: number | null;
  total: number | null;
  temperature: number | null;
  humidity: number | null;
  mature: number | null;
}

const shedRows = computed(() =>
  sheds.value.map((shed) => {
    const ownDevices = devices.value.filter((item) => item.shedCode === shed.code);
    const ownHarvest = harvestItems.value.filter((item) => item.shedCode === shed.code);
    const latest = [...envReadings.value]
      .filter((item) => item.shedCode === shed.code)
      .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0];
    return {
      code: shed.code,
      name: shed.name,
      online: devicesError.value ? null : ownDevices.filter((item) => item.onlineStatus === 'online').length,
      total: devicesError.value ? null : ownDevices.length,
      mature: harvestError.value ? null : ownHarvest.reduce((sum, item) => sum + item.matureCount, 0),
      mushroom: harvestError.value ? null : ownHarvest.reduce((sum, item) => sum + item.mushroomCount, 0),
      temperature: envError.value ? null : (latest?.temperature ?? null),
      humidity: envError.value ? null : (latest?.humidity ?? null),
    };
  }),
);

function gridSpot(count: number, index: number) {
  if (count <= 1) return { x: 50, y: 46 };
  const cols = count <= 3 ? count : Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: 18 + ((col + 0.5) / cols) * 64,
    y: 24 + ((row + 0.5) / rows) * 52,
  };
}

function clampSpot(value: number) {
  return Math.min(88, Math.max(12, value));
}

const unplacedCodes = computed(() =>
  sheds.value
    .filter((shed) => typeof shed.mapX !== 'number' || typeof shed.mapY !== 'number')
    .map((shed) => shed.code),
);

const floorSheds = computed<FloorShed[]>(() => {
  const placedCount = sheds.value.filter(
    (shed) => typeof shed.mapX === 'number' && typeof shed.mapY === 'number',
  ).length;
  const looseCount = sheds.value.length - placedCount;
  const dock = placedCount > 0 && looseCount > 0;
  let loose = 0;
  return sheds.value.map((shed, index) => {
    const stats = shedRows.value.find((row) => row.code === shed.code);
    const open = alerts.value.filter((row) => row.shedCode === shed.code);
    let tone: FloorTone = 'idle';
    if (open.some((row) => row.level === 'severe')) tone = 'severe';
    else if (open.some((row) => row.level === 'warning')) tone = 'warning';
    else if ((stats?.online ?? 0) > 0) tone = 'online';
    const placed = typeof shed.mapX === 'number' && typeof shed.mapY === 'number';
    let x = 50;
    let y = 46;
    if (placed) {
      x = clampSpot(shed.mapX as number);
      y = clampSpot(shed.mapY as number);
    } else if (dock) {
      x = ((loose + 0.5) / looseCount) * 70 + 15;
      y = 82;
      loose += 1;
    } else {
      const spot = gridSpot(sheds.value.length, index);
      x = spot.x;
      y = spot.y;
      loose += 1;
    }
    return {
      id: shed.id,
      code: shed.code,
      name: shed.name,
      x,
      y,
      placed,
      tone,
      online: stats?.online ?? null,
      total: stats?.total ?? null,
      temperature: stats?.temperature ?? null,
      humidity: stats?.humidity ?? null,
      mature: stats?.mature ?? null,
    };
  });
});

const tempAverages = computed(() =>
  tempSeries.value.map((item) => {
    const sum = item.points.reduce((total, point) => total + point.v, 0);
    return {
      name: item.name,
      avg: Math.round((sum / item.points.length) * 10) / 10,
    };
  }),
);

const trendAverages = computed(() => {
  if (!trend.value.length) return null;
  const mean = (pick: (point: TrendPoint) => number) =>
    Math.round((trend.value.reduce((sum, point) => sum + pick(point), 0) / trend.value.length) * 10) / 10;
  return {
    mature: mean((point) => point.mature),
    mushroom: mean((point) => point.mushroom),
    disease: mean((point) => point.disease),
  };
});

const tempThresholds = computed(() =>
  rules.value.filter(
    (rule) =>
      rule.enabled &&
      (rule.metric === 'temperature_high' || rule.metric === 'temperature_low') &&
      Number.isFinite(rule.threshold),
  ),
);

const tempSeries = computed(() => {
  const buckets = new Map<string, { shed: string; sensor: string; points: { t: number; v: number }[] }>();
  for (const row of envReadings.value) {
    if (typeof row.temperature !== 'number' || Number.isNaN(row.temperature)) continue;
    const key = `${row.shedCode}\n${row.sensorCode}`;
    const bucket = buckets.get(key) ?? { shed: row.shedCode, sensor: row.sensorCode, points: [] };
    bucket.points.push({ t: Date.parse(row.observedAt), v: row.temperature });
    buckets.set(key, bucket);
  }
  const perShed = new Map<string, number>();
  for (const bucket of buckets.values()) perShed.set(bucket.shed, (perShed.get(bucket.shed) ?? 0) + 1);
  return [...buckets.values()]
    .map((bucket) => ({
      name: (perShed.get(bucket.shed) ?? 0) > 1 ? `${bucket.shed} · ${bucket.sensor}` : bucket.shed,
      points: bucket.points.sort((a, b) => a.t - b.t),
    }))
    .sort((a, b) => {
      const left = a.points[a.points.length - 1]?.t ?? 0;
      const right = b.points[b.points.length - 1]?.t ?? 0;
      return right - left;
    })
    .slice(0, 6);
});

function metric(value: number | null | undefined, suffix = '') {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value}${suffix}`;
}

function clock(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function dayLabel(day: string) {
  return day.length >= 10 ? day.slice(5) : day;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asItems<T>(value: unknown): T[] {
  if (value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items)) {
    return (value as { items: T[] }).items;
  }
  return [];
}

function axisLook() {
  return {
    axisLabel: { color: tokens.mist },
    axisLine: { lineStyle: { color: tokens.line } },
    splitLine: { lineStyle: { color: tokens.grid } },
  };
}

function releaseCharts() {
  while (charts.length) {
    try {
      charts.pop()?.dispose();
    } catch {
      /* jsdom has no canvas */
    }
  }
}

function render() {
  releaseCharts();
  if (!data.value) return;
  if (tempEl.value && tempSeries.value.length) {
    const markLine = tempThresholds.value.length
      ? {
          symbol: 'none',
          silent: true,
          data: tempThresholds.value.map((rule) => {
            const color = rule.level === 'severe' ? '#C92A2A' : rule.level === 'warning' ? '#B45309' : '#3D4450';
            return {
              yAxis: rule.threshold,
              label: {
                formatter: `${ALERT_METRIC_LABEL[rule.metric]}${rule.shedCode ? ` ${rule.shedCode}` : ''} ${rule.threshold}`,
                color,
                fontWeight: 600,
              },
              lineStyle: {
                color,
                type: rule.level === 'severe' ? ('solid' as const) : ('dashed' as const),
                width: 2,
              },
            };
          }),
        }
      : undefined;
    const chart = echarts.init(tempEl.value);
    chart.setOption({
      backgroundColor: 'transparent',
      textStyle: { color: tokens.mist },
      tooltip: { trigger: 'axis' },
      legend: { textStyle: { color: tokens.ink }, bottom: 0 },
      grid: { left: 44, right: 16, top: 16, bottom: 48 },
      xAxis: { type: 'time', ...axisLook() },
      yAxis: { type: 'value', name: '℃', ...axisLook() },
      series: tempSeries.value.map((item, index) => ({
        name: item.name,
        type: 'line',
        showSymbol: false,
        data: item.points.map((point) => [point.t, point.v]),
        itemStyle: { color: SERIES[index % SERIES.length] },
        lineStyle: { width: 1.5, color: SERIES[index % SERIES.length] },
        markLine: index === 0 ? markLine : undefined,
      })),
    });
    charts.push(chart);
  }
  if (chartEl.value && trend.value.length) {
    const chart = echarts.init(chartEl.value);
    chart.setOption({
      backgroundColor: 'transparent',
      textStyle: { color: tokens.mist },
      tooltip: { trigger: 'axis' },
      legend: { textStyle: { color: tokens.ink }, bottom: 0 },
      grid: { left: 40, right: 16, top: 16, bottom: 48 },
      xAxis: {
        type: 'category',
        data: trend.value.map((item) => dayLabel(item.day)),
        ...axisLook(),
      },
      yAxis: { type: 'value', ...axisLook() },
      series: [
        {
          name: '成熟',
          type: 'line',
          smooth: true,
          showSymbol: true,
          data: trend.value.map((item) => item.mature),
          itemStyle: { color: MATURE_COLOR },
          lineStyle: { color: MATURE_COLOR, width: 2 },
          areaStyle: { color: 'rgba(47, 158, 68, 0.08)' },
        },
        {
          name: '总数',
          type: 'line',
          smooth: true,
          showSymbol: true,
          data: trend.value.map((item) => item.mushroom),
          itemStyle: { color: TOTAL_COLOR },
          lineStyle: { color: TOTAL_COLOR, width: 2 },
          areaStyle: { color: 'rgba(59, 110, 165, 0.08)' },
        },
        {
          name: '病害',
          type: 'line',
          smooth: true,
          showSymbol: true,
          data: trend.value.map((item) => item.disease),
          itemStyle: { color: DISEASE_COLOR },
          lineStyle: { color: DISEASE_COLOR, width: 2 },
        },
      ],
    });
    charts.push(chart);
  }
}

function onResize() {
  for (const chart of charts) chart.resize();
}

onMounted(async () => {
  window.addEventListener('resize', onResize);
  const jobs = [
    ['overview', http.get<Overview>('/dashboard/overview')],
    ['sheds', http.get<ShedItem[]>('/sheds')],
    ['devices', http.get<{ items: DeviceItem[] }>('/devices?pageSize=100')],
    ['harvest', http.get<{ items: HarvestItem[] }>('/harvest/daily')],
    ['env', http.get<{ items: EnvItem[] }>('/ingest/environment-readings?pageSize=100')],
    ['rules', http.get<RuleItem[]>('/alert-rules')],
  ] as const;
  const settled = await Promise.all(
    jobs.map(async ([key, request]) => {
      try {
        const response = await request;
        return [key, response.data, ''] as const;
      } catch (cause) {
        return [key, null, errorText(cause)] as const;
      }
    }),
  );
  const byKey = Object.fromEntries(settled.map(([key, value, message]) => [key, { value, message }]));
  if (byKey.overview.message || !byKey.overview.value) {
    error.value = byKey.overview.message || '请求失败';
  } else {
    data.value = byKey.overview.value as Overview;
    shedsError.value = byKey.sheds.message;
    devicesError.value = byKey.devices.message;
    harvestError.value = byKey.harvest.message;
    envError.value = byKey.env.message;
    sheds.value = asArray<ShedItem>(byKey.sheds.value);
    devices.value = asItems<DeviceItem>(byKey.devices.value);
    harvestItems.value = asItems<HarvestItem>(byKey.harvest.value);
    envReadings.value = asItems<EnvItem>(byKey.env.value);
    rules.value = asArray<RuleItem>(byKey.rules.value);
  }
  loading.value = false;
});

watch(
  [data, sheds, envReadings, rules],
  async () => {
    await nextTick();
    render();
  },
  { flush: 'post' },
);

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
  releaseCharts();
});
</script>

<template>
  <p v-if="loading" class="text-mist">加载中…</p>
  <p v-else-if="error" class="text-danger">{{ error }}</p>
  <div v-else-if="data" class="ops-page tb-board" data-layout="tb-ops">
    <section class="tb-top">
      <article class="tb-card">
        <header class="tb-card-head">
          <h2>棚区平面</h2>
        </header>
        <p v-if="shedsError" class="text-danger">{{ shedsError }}</p>
        <div v-else class="tb-floor" aria-label="棚区平面">
          <p v-if="!floorSheds.length" class="tb-floor-empty">暂无棚区。</p>
          <div
            v-for="shed in floorSheds"
            :key="shed.id"
            class="tb-pin"
            :data-tone="shed.tone"
            :style="{ left: `${shed.x}%`, top: `${shed.y}%` }"
          >
            <span class="tb-pin-mark" aria-hidden="true"></span>
            <span class="tb-pin-label">{{ shed.code }}</span>
          </div>
        </div>
        <p v-if="!shedsError && unplacedCodes.length" class="tb-note">未标坐标：{{ unplacedCodes.join('、') }}</p>
        <p v-if="!shedsError" class="tb-legend">
          <span><i data-tone="online"></i>在线</span>
          <span><i data-tone="warning"></i>一般</span>
          <span><i data-tone="severe"></i>严重</span>
        </p>
      </article>
      <article class="tb-card">
        <header class="tb-card-head">
          <h2>棚区</h2>
        </header>
        <p v-if="shedsError" class="text-danger">{{ shedsError }}</p>
        <p v-else-if="!shedRows.length" class="text-sm text-mist">暂无棚区。</p>
        <div v-else class="tb-table-wrap">
          <table class="data-table tb-entities">
            <thead>
              <tr>
                <th>名称</th>
                <th>在线</th>
                <th>成熟</th>
                <th>菇数</th>
                <th>温度</th>
                <th>湿度</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in shedRows" :key="row.code">
                <td>
                  <span class="tb-dot" :data-on="row.online !== null && row.online > 0"></span>
                  <span class="font-medium">{{ row.code }}</span>
                  <span class="text-mist"> {{ row.name }}</span>
                </td>
                <td class="font-mono">
                  <template v-if="row.online === null">—</template>
                  <template v-else>
                    <span class="tb-state" :data-state="row.online > 0 ? 'online' : 'offline'">{{ row.online > 0 ? '在线' : '离线' }}</span>
                    {{ row.online }}/{{ row.total }}
                  </template>
                </td>
                <td class="font-mono">{{ metric(row.mature) }}</td>
                <td class="font-mono">{{ metric(row.mushroom) }}</td>
                <td class="font-mono">{{ metric(row.temperature, '℃') }}</td>
                <td class="font-mono">{{ metric(row.humidity, '%') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </section>

    <section class="tb-bottom">
      <article class="tb-card">
        <header class="tb-card-head">
          <h2>温度</h2>
        </header>
        <p v-if="envError" class="text-danger">{{ envError }}</p>
        <template v-else-if="tempSeries.length">
          <div ref="tempEl" class="overview-temp tb-chart"></div>
          <p class="tb-avg">
            <span v-for="item in tempAverages" :key="item.name">{{ item.name }} <b>{{ item.avg }}℃</b></span>
          </p>
          <p v-if="tempThresholds.length" class="tb-note">
            已启用阈值：
            <span v-for="rule in tempThresholds" :key="`${rule.metric}-${rule.threshold}-${rule.shedCode ?? ''}`">
              {{ ALERT_METRIC_LABEL[rule.metric] }} {{ rule.threshold }}℃
            </span>
          </p>
        </template>
        <p v-else class="overview-temp-empty text-sm text-mist">暂无环境读数。</p>
      </article>
      <article class="tb-card">
        <header class="tb-card-head">
          <h2>近 7 日</h2>
        </header>
        <div v-if="trend.length" ref="chartEl" class="overview-chart tb-chart"></div>
        <p v-else class="overview-chart-empty text-sm text-mist">这一窗没有识别汇总。</p>
        <p v-if="trendAverages" class="tb-avg">
          <span>成熟 <b>{{ trendAverages.mature }}</b></span>
          <span>总数 <b>{{ trendAverages.mushroom }}</b></span>
          <span>病害 <b>{{ trendAverages.disease }}</b></span>
        </p>
      </article>
      <article class="tb-card tb-alarms">
        <header class="tb-card-head">
          <h2>告警</h2>
        </header>
        <p v-if="!alerts.length" class="text-sm text-mist">暂无未关闭告警。</p>
        <div v-else class="tb-table-wrap">
          <table class="data-table overview-alarms">
            <thead>
              <tr>
                <th>时间</th>
                <th>来源</th>
                <th>类型</th>
                <th>程度</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in alerts" :key="row.id">
                <td class="font-mono text-xs">{{ clock(row.createdAt) }}</td>
                <td>{{ row.shedCode }}<span v-if="row.cameraCode"> · {{ row.cameraCode }}</span></td>
                <td>{{ row.title }}</td>
                <td><span class="tb-sev" :data-level="row.level">{{ ALERT_LEVEL_LABEL[row.level] }}</span></td>
                <td>{{ ALERT_STATUS_LABEL[row.status] }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </section>

    <article class="tb-card">
      <header class="tb-card-head">
        <h2>最近识别</h2>
      </header>
      <p v-if="!records.length" class="text-sm text-mist">暂无识别记录。</p>
      <div v-else class="overflow-x-auto">
        <table class="data-table overview-results">
          <thead>
            <tr>
              <th>时间</th>
              <th>棚区</th>
              <th>摄像头</th>
              <th>成熟</th>
              <th>总数</th>
              <th>病害</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in records" :key="row.id">
              <td class="font-mono text-xs">{{ clock(row.recognizedAt) }}</td>
              <td>{{ row.shedCode }}</td>
              <td class="font-mono">{{ row.cameraCode }}</td>
              <td>{{ row.matureCount }}</td>
              <td>{{ row.mushroomCount }}</td>
              <td :class="row.diseaseCount > 0 ? 'text-danger' : ''">{{ row.diseaseCount }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  </div>
</template>
