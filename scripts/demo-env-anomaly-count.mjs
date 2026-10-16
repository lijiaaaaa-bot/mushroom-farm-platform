#!/usr/bin/env node
/**
 * 写入两台超阈传感器、一台正常传感器，以及昨天一台超阈对照。
 * 总览和基地大屏读出异常环境点位数。
 * 样例仍是 environment.demo-history.json，只改本次请求。
 * 阈值用已启用的告警规则，不新建规则，不改种子阈值。
 * 对照传感器 SENSOR-EAC-NONE 不写入。
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  apiBase,
  ingestToken,
  postJson,
  readFixture,
  repoRoot,
  withPg,
} from './lib/ingest-wire.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';
import {
  assertContrastEmpty,
  assertSensorReading,
  placeReading,
  syncSensorDayBucket,
} from './demo-env-mean.mjs';

const require = createRequire(import.meta.url);

export const DEMO_FIXTURE = 'environment.demo-history.json';
export const CONTRAST_SENSOR = 'SENSOR-EAC-NONE';
export const YDAY_SENSOR = 'SENSOR-EAC-YDAY';
export const CLOSE_NOTE = '异常环境点位演示后关闭';
export const EXPECTED_CLEAN_COUNT = 2;

export const SEED_ENV_RULES = [
  { name: '温度过高', metric: 'temperature_high', threshold: 28 },
  { name: '温度过低', metric: 'temperature_low', threshold: 12 },
  { name: '湿度过低', metric: 'humidity_low', threshold: 70 },
  { name: '湿度过高', metric: 'humidity_high', threshold: 98 },
  { name: '二氧化碳过高', metric: 'co2_high', threshold: 2000 },
  { name: '基质偏干', metric: 'substrate_moisture_low', threshold: 50 },
];

export const ANOMALY_POINTS = [
  {
    shedCode: 'S01',
    sensorCode: 'SENSOR-EAC-01',
    temperature: 32,
    humidity: 55,
    co2: 800,
    substrateMoisture: 65,
  },
  {
    shedCode: 'S02',
    sensorCode: 'SENSOR-EAC-02',
    temperature: 22,
    humidity: 80,
    co2: 900,
    substrateMoisture: 40,
  },
];

export const NORMAL_POINT = {
  shedCode: 'S01',
  sensorCode: 'SENSOR-EAC-OK',
  temperature: 22,
  humidity: 80,
  co2: 800,
  substrateMoisture: 65,
};

export const YDAY_POINT = {
  shedCode: 'S01',
  sensorCode: YDAY_SENSOR,
  temperature: 40,
  humidity: 80,
  co2: 800,
  substrateMoisture: 65,
};

export const TODAY_POINTS = [...ANOMALY_POINTS, NORMAL_POINT];

const DEMO_SENSORS = [...TODAY_POINTS.map((point) => point.sensorCode), YDAY_SENSOR];

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function seedRulesForCount() {
  return SEED_ENV_RULES.map((rule) => ({
    metric: rule.metric,
    threshold: rule.threshold,
    enabled: true,
    shedCode: null,
  }));
}

export function shanghaiDayOf(now = new Date()) {
  const { shanghaiDate, shanghaiDayRange, shiftShanghaiDate } = contracts();
  const day = shanghaiDate(now);
  const range = shanghaiDayRange(day);
  const yesterday = shiftShanghaiDate(day, -1);
  const yRange = shanghaiDayRange(yesterday);
  return {
    day,
    yesterday,
    start: range.start,
    end: range.end,
    yStart: yRange.start,
    yEnd: yRange.end,
  };
}

function clampToday(now, start, end) {
  let at = now.getTime() - 60 * 1000;
  if (at < start.getTime()) at = start.getTime() + 1000;
  if (at >= end.getTime()) at = end.getTime() - 1000;
  return new Date(at).toISOString();
}

function withBody(fixture, point, observedAt, key) {
  return {
    ...point,
    observedAt,
    key,
    body: {
      ...fixture.body,
      idempotencyKey: key,
      shedCode: point.shedCode,
      sensorCode: point.sensorCode,
      observedAt,
      temperature: point.temperature,
      humidity: point.humidity,
      co2: point.co2,
      substrateMoisture: point.substrateMoisture,
    },
  };
}

export function buildEnvAnomalyPayloads(now = new Date()) {
  const fixture = readFixture(DEMO_FIXTURE);
  const { day, yesterday, start, end, yStart } = shanghaiDayOf(now);
  const observedAt = clampToday(now, start, end);
  const points = TODAY_POINTS.map((point) =>
    withBody(fixture, point, observedAt, `demo-env-anomaly-count-${point.sensorCode}-${day}`),
  );
  const yObserved = new Date(yStart.getTime() + 2 * 60 * 60 * 1000).toISOString();
  const yesterdayPoint = withBody(
    fixture,
    YDAY_POINT,
    yObserved,
    `demo-env-anomaly-count-${YDAY_SENSOR}-${yesterday}`,
  );
  yesterdayPoint.day = yesterday;
  yesterdayPoint.bucketStart = yStart;
  for (const point of points) {
    point.day = day;
    point.bucketStart = start;
  }
  return {
    points,
    yesterdayPoint,
    day,
    yesterday,
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

export function validateEnvAnomalyPayloads(sample, now = new Date()) {
  if (!Array.isArray(sample.points) || sample.points.length !== TODAY_POINTS.length) {
    throw new Error(`异常环境点位要正好 ${TODAY_POINTS.length} 台当天传感器`);
  }
  const { start, end, yStart, yEnd } = shanghaiDayOf(now);
  const lib = contracts();
  for (const point of sample.points) {
    const parsed = lib.parseEnvironmentIngress(point.body, now);
    if (!parsed.ok) throw new Error(`样例未通过契约：${parsed.errors.join('；')}`);
    const value = parsed.value;
    if (value.shedCode !== point.shedCode || value.sensorCode !== point.sensorCode) {
      throw new Error(`${point.sensorCode} 的棚区或传感器被改掉了`);
    }
    if (
      value.temperature !== point.temperature ||
      value.humidity !== point.humidity ||
      value.co2 !== point.co2 ||
      value.substrateMoisture !== point.substrateMoisture
    ) {
      throw new Error(`${point.sensorCode} 的环境数与样例不一致`);
    }
    const at = new Date(value.observedAt).getTime();
    if (at < start.getTime() || at >= end.getTime()) throw new Error('观测时间不在今天的上海日里');
  }
  const yParsed = lib.parseEnvironmentIngress(sample.yesterdayPoint.body, now);
  if (!yParsed.ok) throw new Error(`昨天样例未通过契约：${yParsed.errors.join('；')}`);
  const yAt = new Date(yParsed.value.observedAt).getTime();
  if (yAt < yStart.getTime() || yAt >= yEnd.getTime()) throw new Error('对照传感器不在昨天');
  if (yAt >= start.getTime()) throw new Error('昨天的读数进了今天');
  const rules = seedRulesForCount();
  const rows = TODAY_POINTS.map((point) => ({ ...point }));
  if (lib.countEnvAnomalyPoints(rows, rules) !== EXPECTED_CLEAN_COUNT) {
    throw new Error(`干净当天应为 ${EXPECTED_CLEAN_COUNT} 个异常点位`);
  }
  if (lib.sensorIsEnvAnomaly(NORMAL_POINT, rules)) throw new Error('正常传感器被种子规则判成异常');
  if (lib.countEnvAnomalyPoints([ANOMALY_POINTS[0]], rules) !== 1) {
    throw new Error('同一台传感器两项超限仍应只计 1');
  }
  const fixture = readFixture(DEMO_FIXTURE);
  if (fixture.body.sensorCode !== 'SENSOR-HIST-01') throw new Error('样例文件里的传感器被改掉了');
  if (fixture.body.temperature !== 23.1) throw new Error('样例文件里的温度被改掉了');
  return sample;
}

export function assertSeedEnvRules(rules) {
  const list = Array.isArray(rules) ? rules : [];
  for (const expected of SEED_ENV_RULES) {
    const row = list.find((item) => item?.name === expected.name);
    if (!row) throw new Error(`缺少种子规则「${expected.name}」`);
    if (row.metric !== expected.metric) {
      throw new Error(`「${expected.name}」指标是 ${row.metric}，应为 ${expected.metric}`);
    }
    if (Number(row.threshold) !== expected.threshold) {
      throw new Error(`「${expected.name}」阈值是 ${row.threshold}，应为 ${expected.threshold}。演示不改这条规则。`);
    }
    if (row.enabled === false) throw new Error(`「${expected.name}」被停用了。演示不改这条规则。`);
    if (row.shedCode) throw new Error(`「${expected.name}」不应限制棚区`);
  }
  return list;
}

export function rulesForCount(rules) {
  return assertSeedEnvRules(rules)
    .filter((rule) => rule.enabled !== false && rule.metric)
    .map((rule) => ({
      metric: rule.metric,
      threshold: Number(rule.threshold),
      enabled: true,
      shedCode: rule.shedCode || null,
    }));
}

export function sensorRowsFromBuckets(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const code = row.camera_code ?? row.cameraCode ?? '';
    if (!code) continue;
    const shed = row.shed_code ?? row.shedCode ?? '';
    const key = `${shed}\0${code}`;
    const slot = byKey.get(key) ?? { shedCode: shed, sensorCode: code };
    const value = row.value === null || row.value === undefined ? null : Number(row.value);
    if (row.metric === 'env_temperature') slot.temperature = value;
    if (row.metric === 'env_humidity') slot.humidity = value;
    if (row.metric === 'env_co2') slot.co2 = value;
    if (row.metric === 'env_substrate_moisture') slot.substrateMoisture = value;
    byKey.set(key, slot);
  }
  return [...byKey.values()];
}

export function assertOverviewAnomaly(overview, bucketRows, rules) {
  const lib = contracts();
  const parsed = lib.parseEnvAnomalyPointCount(overview);
  if (!parsed.ok) throw new Error(`总览异常点位未通过契约：${parsed.errors.join('；')}`);
  const readings = sensorRowsFromBuckets(bucketRows);
  if (readings.some((row) => row.sensorCode === YDAY_SENSOR)) {
    throw new Error('昨天的传感器进了今天的日桶');
  }
  const active = rulesForCount(rules);
  const fromBuckets = lib.countEnvAnomalyPoints(readings, active);
  const count = parsed.value.envAnomalyPointCount;
  if (count !== fromBuckets) {
    throw new Error(`总览 envAnomalyPointCount 是 ${count}，日桶算出 ${fromBuckets}`);
  }
  for (const point of TODAY_POINTS) {
    const row = readings.find((item) => item.sensorCode === point.sensorCode);
    if (!row) throw new Error(`${point.sensorCode} 的当天日桶不在`);
    if (
      row.temperature !== point.temperature ||
      row.humidity !== point.humidity ||
      row.co2 !== point.co2 ||
      row.substrateMoisture !== point.substrateMoisture
    ) {
      throw new Error(`${point.sensorCode} 的日桶读数被改过`);
    }
  }
  if (lib.sensorIsEnvAnomaly(NORMAL_POINT, active)) {
    throw new Error('正常传感器 SENSOR-EAC-OK 被已启用规则判成异常');
  }
  for (const point of ANOMALY_POINTS) {
    if (!lib.sensorIsEnvAnomaly(point, active)) {
      throw new Error(`${point.sensorCode} 没有被判成异常点位`);
    }
  }
  const anomalous = readings.filter((row) => lib.sensorIsEnvAnomaly(row, active));
  const demoCodes = new Set(ANOMALY_POINTS.map((point) => point.sensorCode));
  const clean =
    anomalous.length === EXPECTED_CLEAN_COUNT &&
    anomalous.every((row) => demoCodes.has(row.sensorCode));
  if (clean && count !== EXPECTED_CLEAN_COUNT) {
    throw new Error(`干净当天应为 ${EXPECTED_CLEAN_COUNT}，实际 ${count}`);
  }
  if (count < EXPECTED_CLEAN_COUNT) {
    throw new Error(`异常点位 ${count} 小于演示写入的 ${EXPECTED_CLEAN_COUNT}`);
  }
  return { count, clean };
}

export function screenUrls(webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  return {
    overview: `${origin}/`,
    screen: `${origin}/big-screen`,
  };
}

export function formatEnvAnomalyProof({
  count,
  day,
  clean = false,
  closed = 0,
  webOrigin = webOriginFromEnv(),
}) {
  const pages = screenUrls(webOrigin);
  const lines = [
    `${ANOMALY_POINTS[0].sensorCode}（${ANOMALY_POINTS[0].shedCode}）: ${ANOMALY_POINTS[0].temperature}℃ · 湿度 ${ANOMALY_POINTS[0].humidity}%（两项超限，仍计 1）`,
    `${ANOMALY_POINTS[1].sensorCode}（${ANOMALY_POINTS[1].shedCode}）: 基质含水率 ${ANOMALY_POINTS[1].substrateMoisture}%`,
    `${NORMAL_POINT.sensorCode}: 在种子阈值内`,
    `${YDAY_SENSOR}: 昨天 ${YDAY_POINT.temperature}℃，不进今天`,
    `对照 ${CONTRAST_SENSOR}: 当天 0 条`,
    `干净当天: 异常环境点位数 ${EXPECTED_CLEAN_COUNT}`,
    clean ? '当天异常点位只有这两台' : '当天还有别的超阈传感器，旁注按同一口径变',
    `关闭这几台传感器上的未闭合告警: ${closed}`,
    `上海日: ${day}`,
    '口径: 上海今日环境日桶，一个传感器计 1，棚级行不计入，不读告警表',
    '阈值: 已启用的温度、湿度、CO₂、基质含水率规则。种子规则不改。',
    '登录: admin / Admin@123456',
    `总览: ${pages.overview}`,
    `大屏: ${pages.screen}`,
  ];
  return [contracts().formatEnvAnomalyPointNote(count), ...lines].join('\n');
}

function messageText(payload) {
  const message = payload?.message ?? payload?.error;
  if (Array.isArray(message)) return message.join('；');
  if (typeof message === 'string') return message;
  return '';
}

function flag(payload, key) {
  return payload?.[key] ?? payload?.message?.[key];
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

async function queryDb(sql, params) {
  return withPg((db) => db.query(sql, params));
}

async function postEnvironment(body) {
  const url = `${apiBase()}/ingest/environment`;
  let posted;
  try {
    posted = await postJson(url, JSON.stringify(body), {
      'content-type': 'application/json',
      'x-ingest-token': ingestToken(),
    });
  } catch (error) {
    throw new Error(`API 连不上（${url}）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const payload = posted.responseBody;
  const accepted = flag(payload, 'accepted') === true;
  const id = flag(payload, 'id');
  if (posted.responseStatus < 200 || posted.responseStatus >= 300 || !accepted || !id) {
    throw new Error(`环境报文被拒绝 ${posted.responseStatus} ${messageText(payload)}`);
  }
  if (flag(payload, 'duplicate') === true) {
    throw new Error(`幂等键 ${body.idempotencyKey} 已在，但没有改到这次的观测时间`);
  }
  return { id };
}

async function login() {
  let response;
  try {
    response = await fetch(`${apiBase()}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'Admin@123456' }),
    });
  } catch (error) {
    throw new Error(`API 连不上（${apiBase()}）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const session = await readJson(response);
  if (!response.ok || !session.accessToken) {
    throw new Error(`登录失败 ${response.status}。确认 API 已用种子账号启动。`);
  }
  return session.accessToken;
}

function listUrl(sensorCode, start, end) {
  const to = new Date(new Date(end).getTime() - 1).toISOString();
  const params = new URLSearchParams({
    sensorCode,
    from: start,
    to,
    pageSize: '50',
  });
  return `${apiBase()}/ingest/environment-readings?${params.toString()}`;
}

async function getJson(token, url) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const body = await readJson(response);
  if (!response.ok) throw new Error(`读取失败 ${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function closeDemoAlerts(token) {
  const found = await queryDb(
    `SELECT id, sensor_code
       FROM alerts
      WHERE sensor_code = ANY($1::text[])
        AND status IN ('open', 'acked')`,
    [DEMO_SENSORS],
  );
  const rows = found.rows ?? [];
  for (const row of rows) {
    let response;
    try {
      response = await fetch(`${apiBase()}/alerts/${encodeURIComponent(row.id)}/close`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ note: CLOSE_NOTE }),
      });
    } catch (error) {
      throw new Error(`关闭 ${row.sensor_code} 的告警失败。${error.message}`);
    }
    const body = await readJson(response);
    if (!response.ok) {
      throw new Error(
        `关闭 ${row.sensor_code} 的告警失败 ${response.status} ${messageText(body) || JSON.stringify(body)}`,
      );
    }
  }
  const left = await queryDb(
    `SELECT id FROM alerts
      WHERE sensor_code = ANY($1::text[])
        AND status IN ('open', 'acked')`,
    [DEMO_SENSORS],
  );
  if ((left.rows ?? []).length) {
    throw new Error(`演示传感器还有 ${(left.rows ?? []).length} 条未闭合告警`);
  }
  return rows.length;
}

export async function sendDemo({ now = new Date() } = {}) {
  const built = buildEnvAnomalyPayloads(now);
  validateEnvAnomalyPayloads(built, now);
  const seeded = [...built.points, built.yesterdayPoint];
  for (const point of seeded) {
    await placeReading(point.body, { post: postEnvironment, query: queryDb });
    await syncSensorDayBucket(point, point.bucketStart, point.observedAt, { query: queryDb });
  }
  await queryDb(
    `DELETE FROM metric_buckets_day
      WHERE shed_code = $1
        AND camera_code = $2
        AND bucket_start >= $3::timestamptz
        AND bucket_start < $4::timestamptz
        AND metric IN ('env_temperature', 'env_humidity', 'env_co2', 'env_substrate_moisture')`,
    [YDAY_POINT.shedCode, YDAY_SENSOR, built.start, built.end],
  );
  const token = await login();
  const ruleList = await getJson(token, `${apiBase()}/alert-rules`);
  for (const point of built.points) {
    const listed = await getJson(token, listUrl(point.sensorCode, built.start, built.end));
    assertSensorReading(listed.items, point);
  }
  const contrast = await getJson(token, listUrl(CONTRAST_SENSOR, built.start, built.end));
  assertContrastEmpty(contrast.items);
  const ydayToday = await getJson(token, listUrl(YDAY_SENSOR, built.start, built.end));
  assertContrastEmpty(ydayToday.items);
  const closed = await closeDemoAlerts(token);
  const buckets = await queryDb(
    `SELECT shed_code, camera_code, metric, value
       FROM metric_buckets_day
      WHERE bucket_start >= $1::timestamptz
        AND bucket_start < $2::timestamptz
        AND camera_code <> ''
        AND metric IN ('env_temperature', 'env_humidity', 'env_co2', 'env_substrate_moisture')`,
    [built.start, built.end],
  );
  const overview = await getJson(token, `${apiBase()}/dashboard/overview`);
  const checked = assertOverviewAnomaly(overview, buckets.rows, ruleList);
  return { count: checked.count, day: built.day, clean: checked.clean, closed };
}

function usage() {
  return `用法:
  node scripts/demo-env-anomaly-count.mjs

读取 ${DEMO_FIXTURE}，写入 SENSOR-EAC-01（棚区 S01，32℃ 且湿度 55%）和 SENSOR-EAC-02（棚区 S02，基质含水率 40%）。步骤见 docs/DEMO_ENV_ANOMALY_COUNT.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const sent = await sendDemo();
    process.stdout.write(`${formatEnvAnomalyProof(sent)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
