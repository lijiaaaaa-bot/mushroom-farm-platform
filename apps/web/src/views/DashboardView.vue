<script setup lang="ts">
import * as echarts from 'echarts';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  ALERT_LEVEL_LABEL,
  ALERT_METRIC_LABEL,
  ALERT_STATUS_LABEL,
  DEVICE_ONLINE_BY_TYPE_LABEL,
  DISEASE_RATIO_METRIC,
  DISEASE_RATIO_THRESHOLD_ERROR,
  DISEASE_SEVERE_METRIC,
  DISEASE_SEVERE_THRESHOLD_ERROR,
  DISEASE_WARN_LABEL,
  ENV_ANOMALY_POINT_LABEL,
  ENV_MEAN_LABEL,
  GROWTH_STALL_LABEL,
  GROWTH_STALL_METRIC,
  GROWTH_STALL_THRESHOLD_ERROR,
  LIVE_MUSHROOM_TOTAL_LABEL,
  MATURE_PICK_LABEL,
  MATURE_PICK_METRIC,
  MATURE_PICK_THRESHOLD_ERROR,
  formatDeviceOnlineByTypeNote,
  formatDeviceOnlineRatio,
  formatEnvAnomalyPointNote,
  formatDiseaseWarnConfig,
  formatMaturePickConfig,
  parseDeviceOnlineByType,
  formatEnvMeanNote,
  formatEnvMeanValue,
  formatGrowthStallConfig,
  formatLiveMushroomTotalsNote,
  growthStallFromOverview,
  growthStallThresholdInteger,
  maturePickReminderFromOverview,
  maturePickThresholdInteger,
  diseaseWarnFromOverview,
  diseaseWarnThresholdInteger,
  parseDiseaseWarning,
  parseGrowthStallWarning,
  parseMaturePickReminder,
  type FarmEnvMeans,
  type AlertLevel,
  type AlertMetric,
  type AlertStatus,
} from '@mushroom/contracts';
import { errorText, http } from '../api';
import { canWriteRules, currentUser } from '../auth';
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
  todayRecognitionCount?: number;
  todayCaptureCount?: number;
  todayDiseaseCount?: number;
  liveMushroomTotal?: number;
  liveMatureTotal?: number;
  liveImmatureTotal?: number;
  maturePickRuleId?: string | null;
  maturePickShedCode?: string | null;
  maturePickThreshold?: number | null;
  maturePickMatureCount?: number;
  maturePickActive?: boolean;
  maturePickNote?: string;
  diseaseWarnRatioRuleId?: string | null;
  diseaseWarnRatioShedCode?: string | null;
  diseaseWarnRatioThreshold?: number | null;
  diseaseWarnRatioPercent?: number;
  diseaseWarnRatioActive?: boolean;
  diseaseWarnRatioNote?: string;
  diseaseWarnSevereRuleId?: string | null;
  diseaseWarnSevereShedCode?: string | null;
  diseaseWarnSevereThreshold?: number | null;
  diseaseWarnSevereCount?: number;
  diseaseWarnSevereActive?: boolean;
  diseaseWarnSevereNote?: string;
  growthStallRuleId?: string | null;
  growthStallShedCode?: string | null;
  growthStallThreshold?: number | null;
  growthStallCurrent?: number;
  growthStallActive?: boolean;
  growthStallNote?: string;
  envMeanTemperature?: number | null;
  envMeanHumidity?: number | null;
  envMeanCo2?: number | null;
  envMeanSubstrateMoisture?: number | null;
  envAnomalyPointCount?: number;
  cameraOnline?: number;
  cameraTotal?: number;
  aiBoxOnline?: number;
  aiBoxTotal?: number;
  sensorOnline?: number;
  sensorTotal?: number;
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
const todayNote = computed(() => {
  const recognition = formatCount(data.value?.todayRecognitionCount);
  const capture = formatCount(data.value?.todayCaptureCount);
  return `今日识别次数 ${recognition} · 今日抓拍总量 ${capture}`;
});
const todayDiseaseNote = computed(
  () => `当日病害总数 ${formatCount(data.value?.todayDiseaseCount)}`,
);
const liveMushroomNote = computed(() =>
  formatLiveMushroomTotalsNote({
    liveMushroomTotal: Number(formatCount(data.value?.liveMushroomTotal)),
    liveMatureTotal: Number(formatCount(data.value?.liveMatureTotal)),
    liveImmatureTotal: Number(formatCount(data.value?.liveImmatureTotal)),
  }),
);
const envMeans = computed((): FarmEnvMeans => ({
  envMeanTemperature: finiteOrNull(data.value?.envMeanTemperature),
  envMeanHumidity: finiteOrNull(data.value?.envMeanHumidity),
  envMeanCo2: finiteOrNull(data.value?.envMeanCo2),
  envMeanSubstrateMoisture: finiteOrNull(data.value?.envMeanSubstrateMoisture),
}));
const envMeanNote = computed(() => formatEnvMeanNote(envMeans.value));
const envAnomalyPointCount = computed(() => {
  const value = data.value?.envAnomalyPointCount;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.trunc(value);
});
const envAnomalyNote = computed(() => formatEnvAnomalyPointNote(envAnomalyPointCount.value));
const deviceOnlineByType = computed(() => {
  const parsed = parseDeviceOnlineByType(data.value ?? {});
  return parsed.ok
    ? parsed.value
    : {
        cameraOnline: 0,
        cameraTotal: 0,
        aiBoxOnline: 0,
        aiBoxTotal: 0,
        sensorOnline: 0,
        sensorTotal: 0,
      };
});
const deviceOnlineNote = computed(() => formatDeviceOnlineByTypeNote(deviceOnlineByType.value));
const emptyMaturePick = {
  ruleId: null,
  shedCode: null,
  threshold: null,
  matureCount: 0,
  active: false,
  note: '',
};
const maturePick = computed(() => {
  const parsed = parseMaturePickReminder(data.value ?? {});
  return parsed.ok ? maturePickReminderFromOverview(parsed.value) : emptyMaturePick;
});
const maturePickConfig = computed(() => formatMaturePickConfig(maturePick.value));
const maturePickDraft = ref('');
const savingPick = ref(false);
const pickError = ref('');
const canEditPick = computed(() => canWriteRules(currentUser.value?.role));

watch(
  () => maturePick.value.threshold,
  (value) => {
    if (savingPick.value) return;
    maturePickDraft.value = value === null ? '' : String(value);
  },
  { immediate: true },
);

const emptyDiseaseWarn = {
  ratio: {
    ruleId: null,
    shedCode: null,
    threshold: null as number | null,
    percent: 0,
    active: false,
    note: '',
  },
  severe: {
    ruleId: null,
    shedCode: null,
    threshold: null as number | null,
    severeCount: 0,
    active: false,
    note: '',
  },
};
const diseaseWarn = computed(() => {
  const parsed = parseDiseaseWarning(data.value ?? {});
  return parsed.ok ? diseaseWarnFromOverview(parsed.value) : emptyDiseaseWarn;
});
const diseaseWarnConfig = computed(() => formatDiseaseWarnConfig(diseaseWarn.value));
const diseaseRatioDraft = ref('');
const diseaseSevereDraft = ref('');
const savingDisease = ref(false);
const diseaseError = ref('');
const canEditDisease = computed(() => canWriteRules(currentUser.value?.role));

watch(
  () => diseaseWarn.value.ratio.threshold,
  (value) => {
    if (savingDisease.value) return;
    diseaseRatioDraft.value = value === null ? '' : String(value);
  },
  { immediate: true },
);
watch(
  () => diseaseWarn.value.severe.threshold,
  (value) => {
    if (savingDisease.value) return;
    diseaseSevereDraft.value = value === null ? '' : String(value);
  },
  { immediate: true },
);

const emptyGrowthStall = {
  ruleId: null,
  shedCode: null,
  threshold: null as number | null,
  current: 0,
  active: false,
  note: '',
};
const growthStall = computed(() => {
  const parsed = parseGrowthStallWarning(data.value ?? {});
  return parsed.ok ? growthStallFromOverview(parsed.value) : emptyGrowthStall;
});
const growthStallConfig = computed(() => formatGrowthStallConfig(growthStall.value));
const growthStallDraft = ref('');
const savingStall = ref(false);
const stallError = ref('');
const canEditStall = computed(() => canWriteRules(currentUser.value?.role));

watch(
  () => growthStall.value.threshold,
  (value) => {
    if (savingStall.value) return;
    growthStallDraft.value = value === null ? '' : String(value);
  },
  { immediate: true },
);

function formatCount(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0';
  return String(value);
}

function finiteOrNull(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
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

async function loadBoard() {
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
}

async function saveDiseaseRule(
  metric: typeof DISEASE_RATIO_METRIC | typeof DISEASE_SEVERE_METRIC,
  name: string,
  ruleId: string | null,
  threshold: number,
) {
  if (ruleId) {
    await http.patch(`/alert-rules/${ruleId}`, { threshold, enabled: true });
    return;
  }
  await http.post('/alert-rules', {
    name,
    metric,
    threshold,
    level: 'info',
  });
}

async function saveDiseaseWarn() {
  if (!canEditDisease.value || savingDisease.value) return;
  const ratioText = String(diseaseRatioDraft.value ?? '').trim();
  const severeText = String(diseaseSevereDraft.value ?? '').trim();
  if (!ratioText && !severeText) {
    diseaseError.value = '请填写病害比例或重度数量阈值';
    return;
  }
  const ratio = ratioText ? diseaseWarnThresholdInteger(ratioText) : null;
  if (ratioText && ratio === null) {
    diseaseError.value = DISEASE_RATIO_THRESHOLD_ERROR;
    return;
  }
  const severe = severeText ? diseaseWarnThresholdInteger(severeText) : null;
  if (severeText && severe === null) {
    diseaseError.value = DISEASE_SEVERE_THRESHOLD_ERROR;
    return;
  }
  savingDisease.value = true;
  diseaseError.value = '';
  try {
    if (ratio !== null) {
      await saveDiseaseRule(
        DISEASE_RATIO_METRIC,
        '病害比例预警',
        diseaseWarn.value.ratio.ruleId,
        ratio,
      );
    }
    if (severe !== null) {
      await saveDiseaseRule(
        DISEASE_SEVERE_METRIC,
        '重度病害预警',
        diseaseWarn.value.severe.ruleId,
        severe,
      );
    }
    await loadBoard();
  } catch (cause) {
    diseaseError.value = errorText(cause);
  } finally {
    savingDisease.value = false;
  }
}

async function saveGrowthStall() {
  if (!canEditStall.value || savingStall.value) return;
  const threshold = growthStallThresholdInteger(growthStallDraft.value);
  if (threshold === null) {
    stallError.value = GROWTH_STALL_THRESHOLD_ERROR;
    return;
  }
  savingStall.value = true;
  stallError.value = '';
  try {
    const ruleId = growthStall.value.ruleId;
    if (ruleId) {
      await http.patch(`/alert-rules/${ruleId}`, { threshold, enabled: true });
    } else {
      await http.post('/alert-rules', {
        name: GROWTH_STALL_LABEL.title,
        metric: GROWTH_STALL_METRIC,
        threshold,
        level: 'info',
      });
    }
    await loadBoard();
  } catch (cause) {
    stallError.value = errorText(cause);
  } finally {
    savingStall.value = false;
  }
}

async function saveMaturePick() {
  if (!canEditPick.value || savingPick.value) return;
  const threshold = maturePickThresholdInteger(maturePickDraft.value);
  if (threshold === null) {
    pickError.value = MATURE_PICK_THRESHOLD_ERROR;
    return;
  }
  savingPick.value = true;
  pickError.value = '';
  try {
    const ruleId = maturePick.value.ruleId;
    if (ruleId) {
      await http.patch(`/alert-rules/${ruleId}`, { threshold, enabled: true });
    } else {
      await http.post('/alert-rules', {
        name: MATURE_PICK_LABEL.title,
        metric: MATURE_PICK_METRIC,
        threshold,
        level: 'info',
      });
    }
    await loadBoard();
  } catch (cause) {
    pickError.value = errorText(cause);
  } finally {
    savingPick.value = false;
  }
}

onMounted(async () => {
  window.addEventListener('resize', onResize);
  await loadBoard();
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
    <section class="today-counts" aria-label="今日识别、抓拍与当日病害总数">
      <article class="tb-card">
        <h2>今日识别次数</h2>
        <p class="today-count" data-field="today-recognition">{{ formatCount(data.todayRecognitionCount) }}</p>
      </article>
      <article class="tb-card">
        <h2>今日抓拍总量</h2>
        <p class="today-count" data-field="today-capture">{{ formatCount(data.todayCaptureCount) }}</p>
      </article>
      <article class="tb-card">
        <h2>当日病害总数</h2>
        <p class="today-count" data-field="today-disease">{{ formatCount(data.todayDiseaseCount) }}</p>
      </article>
      <p class="today-counts-note" data-field="today-note">{{ todayNote }}</p>
      <p class="today-counts-note" data-field="today-disease-note">{{ todayDiseaseNote }}</p>
    </section>
    <section class="today-counts" aria-label="在养蘑菇总数、成熟可采摘总数、待成熟数量">
      <article class="tb-card">
        <h2>{{ LIVE_MUSHROOM_TOTAL_LABEL.liveMushroomTotal }}</h2>
        <p class="today-count" data-field="live-mushroom">{{ formatCount(data.liveMushroomTotal) }}</p>
      </article>
      <article class="tb-card">
        <h2>{{ LIVE_MUSHROOM_TOTAL_LABEL.liveMatureTotal }}</h2>
        <p class="today-count" data-field="live-mature">{{ formatCount(data.liveMatureTotal) }}</p>
      </article>
      <article class="tb-card">
        <h2>{{ LIVE_MUSHROOM_TOTAL_LABEL.liveImmatureTotal }}</h2>
        <p class="today-count" data-field="live-immature">{{ formatCount(data.liveImmatureTotal) }}</p>
      </article>
      <p class="today-counts-note" data-field="live-mushroom-note">{{ liveMushroomNote }}</p>
    </section>
    <section class="mature-pick-block" aria-label="采摘提醒" data-field="mature-pick">
      <h2 data-field="mature-pick-title">{{ MATURE_PICK_LABEL.title }}</h2>
      <form class="mature-pick-form" @submit.prevent="saveMaturePick">
        <label>
          {{ MATURE_PICK_LABEL.threshold }}
          <input
            v-model="maturePickDraft"
            data-field="mature-pick-threshold"
            type="number"
            min="0"
            step="1"
            inputmode="numeric"
            :disabled="!canEditPick || savingPick"
            :aria-label="MATURE_PICK_LABEL.threshold"
          />
        </label>
        <button v-if="canEditPick" type="submit" data-field="mature-pick-save" :disabled="savingPick">
          {{ savingPick ? '保存中…' : '保存' }}
        </button>
      </form>
      <p class="today-counts-note" data-field="mature-pick-config">{{ maturePickConfig }}</p>
      <p v-if="maturePick.active" class="mature-pick-banner" data-field="mature-pick-note">{{ maturePick.note }}</p>
      <p v-else-if="maturePick.threshold !== null" class="today-counts-note" data-field="mature-pick-idle">
        当前成熟 {{ maturePick.matureCount }}，未达到阈值 {{ maturePick.threshold }}
      </p>
      <p v-if="pickError" class="text-danger" data-field="mature-pick-error">{{ pickError }}</p>
    </section>
    <section class="disease-warn-block" aria-label="病害预警" data-field="disease-warn">
      <h2 data-field="disease-warn-title">{{ DISEASE_WARN_LABEL.title }}</h2>
      <form class="disease-warn-form" @submit.prevent="saveDiseaseWarn">
        <label>
          {{ DISEASE_WARN_LABEL.ratioThreshold }}
          <input
            v-model="diseaseRatioDraft"
            data-field="disease-warn-ratio"
            type="number"
            min="0"
            step="1"
            inputmode="numeric"
            :disabled="!canEditDisease || savingDisease"
            :aria-label="DISEASE_WARN_LABEL.ratioThreshold"
          />
        </label>
        <label>
          {{ DISEASE_WARN_LABEL.severeThreshold }}
          <input
            v-model="diseaseSevereDraft"
            data-field="disease-warn-severe"
            type="number"
            min="0"
            step="1"
            inputmode="numeric"
            :disabled="!canEditDisease || savingDisease"
            :aria-label="DISEASE_WARN_LABEL.severeThreshold"
          />
        </label>
        <button v-if="canEditDisease" type="submit" data-field="disease-warn-save" :disabled="savingDisease">
          {{ savingDisease ? '保存中…' : '保存' }}
        </button>
      </form>
      <p class="today-counts-note" data-field="disease-warn-config">{{ diseaseWarnConfig }}</p>
      <p v-if="diseaseWarn.ratio.active" class="disease-warn-banner" data-field="disease-warn-ratio-note">
        {{ diseaseWarn.ratio.note }}
      </p>
      <p
        v-else-if="diseaseWarn.ratio.threshold !== null"
        class="today-counts-note"
        data-field="disease-warn-ratio-idle"
      >
        当前比例 {{ diseaseWarn.ratio.percent }}%，未达到阈值 {{ diseaseWarn.ratio.threshold }}%
      </p>
      <p v-if="diseaseWarn.severe.active" class="disease-warn-banner" data-field="disease-warn-severe-note">
        {{ diseaseWarn.severe.note }}
      </p>
      <p
        v-else-if="diseaseWarn.severe.threshold !== null"
        class="today-counts-note"
        data-field="disease-warn-severe-idle"
      >
        当前重度 {{ diseaseWarn.severe.severeCount }}，未达到阈值 {{ diseaseWarn.severe.threshold }}
      </p>
      <p v-if="diseaseError" class="text-danger" data-field="disease-warn-error">{{ diseaseError }}</p>
    </section>
    <section class="growth-stall-block" aria-label="生长异常预警" data-field="growth-stall">
      <h2 data-field="growth-stall-title">{{ GROWTH_STALL_LABEL.title }}</h2>
      <form class="growth-stall-form" @submit.prevent="saveGrowthStall">
        <label>
          {{ GROWTH_STALL_LABEL.threshold }}
          <input
            v-model="growthStallDraft"
            data-field="growth-stall-threshold"
            type="number"
            min="0"
            step="1"
            inputmode="numeric"
            :disabled="!canEditStall || savingStall"
            :aria-label="GROWTH_STALL_LABEL.threshold"
          />
        </label>
        <button v-if="canEditStall" type="submit" data-field="growth-stall-save" :disabled="savingStall">
          {{ savingStall ? '保存中…' : '保存' }}
        </button>
      </form>
      <p class="today-counts-note" data-field="growth-stall-config">{{ growthStallConfig }}</p>
      <p v-if="growthStall.active" class="growth-stall-banner" data-field="growth-stall-note">
        {{ growthStall.note }}
      </p>
      <p v-else-if="growthStall.threshold !== null" class="today-counts-note" data-field="growth-stall-idle">
        当前停滞 {{ growthStall.current }}，未达到阈值 {{ growthStall.threshold }}
      </p>
      <p v-if="stallError" class="text-danger" data-field="growth-stall-error">{{ stallError }}</p>
    </section>
    <section class="env-mean-block" aria-label="全园环境参数均值">
      <h2 class="env-mean-title" data-field="env-mean-title">{{ ENV_MEAN_LABEL.title }}</h2>
      <article class="tb-card">
        <h2>{{ ENV_MEAN_LABEL.envMeanTemperature }}</h2>
        <p class="today-count" data-field="env-mean-temperature">{{ formatEnvMeanValue(envMeans.envMeanTemperature, '℃') }}</p>
      </article>
      <article class="tb-card">
        <h2>{{ ENV_MEAN_LABEL.envMeanHumidity }}</h2>
        <p class="today-count" data-field="env-mean-humidity">{{ formatEnvMeanValue(envMeans.envMeanHumidity, '%') }}</p>
      </article>
      <article class="tb-card">
        <h2>{{ ENV_MEAN_LABEL.envMeanCo2 }}</h2>
        <p class="today-count" data-field="env-mean-co2">{{ formatEnvMeanValue(envMeans.envMeanCo2, 'ppm') }}</p>
      </article>
      <article class="tb-card">
        <h2>{{ ENV_MEAN_LABEL.envMeanSubstrateMoisture }}</h2>
        <p class="today-count" data-field="env-mean-moisture">{{ formatEnvMeanValue(envMeans.envMeanSubstrateMoisture, '%') }}</p>
      </article>
      <p class="today-counts-note" data-field="env-mean-note">{{ envMeanNote }}</p>
    </section>
    <section class="today-counts env-anomaly-block" aria-label="异常环境点位数">
      <article class="tb-card">
        <h2 data-field="env-anomaly-title">{{ ENV_ANOMALY_POINT_LABEL }}</h2>
        <p class="today-count" data-field="env-anomaly-count">{{ formatCount(envAnomalyPointCount) }}</p>
      </article>
      <p class="today-counts-note" data-field="env-anomaly-note">{{ envAnomalyNote }}</p>
    </section>
    <section class="today-counts device-online-block" aria-label="全局设备在线">
      <h2 class="device-online-title" data-field="device-online-title">{{ DEVICE_ONLINE_BY_TYPE_LABEL.title }}</h2>
      <article class="tb-card">
        <h2 data-field="device-online-camera-title">{{ DEVICE_ONLINE_BY_TYPE_LABEL.camera }}</h2>
        <p class="today-count" data-field="device-online-camera">{{ formatDeviceOnlineRatio(deviceOnlineByType.cameraOnline, deviceOnlineByType.cameraTotal) }}</p>
      </article>
      <article class="tb-card">
        <h2 data-field="device-online-aibox-title">{{ DEVICE_ONLINE_BY_TYPE_LABEL.aiBox }}</h2>
        <p class="today-count" data-field="device-online-aibox">{{ formatDeviceOnlineRatio(deviceOnlineByType.aiBoxOnline, deviceOnlineByType.aiBoxTotal) }}</p>
      </article>
      <article class="tb-card">
        <h2 data-field="device-online-sensor-title">{{ DEVICE_ONLINE_BY_TYPE_LABEL.sensor }}</h2>
        <p class="today-count" data-field="device-online-sensor">{{ formatDeviceOnlineRatio(deviceOnlineByType.sensorOnline, deviceOnlineByType.sensorTotal) }}</p>
      </article>
      <p class="today-counts-note" data-field="device-online-note">{{ deviceOnlineNote }}</p>
    </section>
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
