#!/usr/bin/env node
/**
 * 写入两棚各一台传感器的当天环境读数，以及昨天一台对照。
 * 总览和基地大屏读出全园环境参数均值。
 * 样例仍是 environment.demo-history.json，只改本次请求。
 * 对照传感器 SENSOR-EM-NONE 不写入。
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

const require = createRequire(import.meta.url);

export const DEMO_FIXTURE = 'environment.demo-history.json';
export const CONTRAST_SENSOR = 'SENSOR-EM-NONE';
export const YDAY_SENSOR = 'SENSOR-EM-YDAY';

export const ENV_POINTS = [
  {
    shedCode: 'S01',
    sensorCode: 'SENSOR-EM-01',
    temperature: 22,
    humidity: 78,
    co2: 620,
    substrateMoisture: 68,
  },
  {
    shedCode: 'S02',
    sensorCode: 'SENSOR-EM-02',
    temperature: 26,
    humidity: 92,
    co2: 980,
    substrateMoisture: 78,
  },
];

export const YDAY_POINT = {
  shedCode: 'S01',
  sensorCode: YDAY_SENSOR,
  temperature: 16,
  humidity: 80,
  co2: 500,
  substrateMoisture: 60,
};

export const DAY_METRICS = [
  ['temperature', 'env_temperature'],
  ['humidity', 'env_humidity'],
  ['co2', 'env_co2'],
  ['substrateMoisture', 'env_substrate_moisture'],
];

const MEAN_KEYS = [
  'envMeanTemperature',
  'envMeanHumidity',
  'envMeanCo2',
  'envMeanSubstrateMoisture',
];

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function cleanEnvMeans() {
  return contracts().meanFarmEnvironment(ENV_POINTS);
}

export function shanghaiDayOf(now = new Date()) {
  const { shanghaiDate, shanghaiDayRange, shiftShanghaiDate } = contracts();
  const day = shanghaiDate(now);
  const range = shanghaiDayRange(day);
  const yesterday = shiftShanghaiDate(day, -1);
  const yRange = shanghaiDayRange(yesterday);
  return { day, yesterday, start: range.start, end: range.end, yStart: yRange.start, yEnd: yRange.end };
}

function clampToday(now, start, end) {
  let at = now.getTime() - 60 * 1000;
  if (at < start.getTime()) at = start.getTime() + 1000;
  if (at >= end.getTime()) at = end.getTime() - 1000;
  return new Date(at).toISOString();
}

export function buildEnvMeanPayloads(now = new Date()) {
  const fixture = readFixture(DEMO_FIXTURE);
  const { day, yesterday, start, end, yStart } = shanghaiDayOf(now);
  const points = ENV_POINTS.map((point) => ({
    ...point,
    day,
    bucketStart: start,
    observedAt: clampToday(now, start, end),
    key: `demo-env-mean-${point.sensorCode}-${day}`,
    body: {
      ...fixture.body,
      idempotencyKey: `demo-env-mean-${point.sensorCode}-${day}`,
      shedCode: point.shedCode,
      sensorCode: point.sensorCode,
      observedAt: clampToday(now, start, end),
      temperature: point.temperature,
      humidity: point.humidity,
      co2: point.co2,
      substrateMoisture: point.substrateMoisture,
    },
  }));
  const yObserved = new Date(yStart.getTime() + 2 * 60 * 60 * 1000).toISOString();
  const yesterdayPoint = {
    ...YDAY_POINT,
    day: yesterday,
    bucketStart: yStart,
    observedAt: yObserved,
    key: `demo-env-mean-${YDAY_SENSOR}-${yesterday}`,
    body: {
      ...fixture.body,
      idempotencyKey: `demo-env-mean-${YDAY_SENSOR}-${yesterday}`,
      shedCode: YDAY_POINT.shedCode,
      sensorCode: YDAY_POINT.sensorCode,
      observedAt: yObserved,
      temperature: YDAY_POINT.temperature,
      humidity: YDAY_POINT.humidity,
      co2: YDAY_POINT.co2,
      substrateMoisture: YDAY_POINT.substrateMoisture,
    },
  };
  return {
    points,
    yesterdayPoint,
    day,
    yesterday,
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

function assertSafe(value) {
  if (value.temperature <= 12 || value.temperature >= 28) {
    throw new Error(`温度 ${value.temperature} 碰到种子规则「温度过低」或「温度过高」`);
  }
  if (value.humidity <= 70 || value.humidity >= 98) {
    throw new Error(`湿度 ${value.humidity} 碰到种子规则「湿度过低」或「湿度过高」`);
  }
  if (value.co2 >= 2000) throw new Error(`CO₂ ${value.co2} 碰到种子规则「二氧化碳过高」`);
  if (value.substrateMoisture <= 50) {
    throw new Error(`基质含水率 ${value.substrateMoisture} 碰到种子规则「基质偏干」`);
  }
}

export function validateEnvMeanPayloads(sample, now = new Date()) {
  if (!Array.isArray(sample.points) || sample.points.length !== ENV_POINTS.length) {
    throw new Error(`全园环境均值要正好 ${ENV_POINTS.length} 台当天传感器`);
  }
  const { start, end, yStart, yEnd } = shanghaiDayOf(now);
  const sheds = new Set();
  for (const point of sample.points) {
    const parsed = contracts().parseEnvironmentIngress(point.body, now);
    if (!parsed.ok) throw new Error(`样例未通过契约：${parsed.errors.join('；')}`);
    const value = parsed.value;
    if (value.shedCode !== point.shedCode) throw new Error(`棚区是 ${value.shedCode}，应为 ${point.shedCode}`);
    if (value.sensorCode !== point.sensorCode) {
      throw new Error(`传感器是 ${value.sensorCode}，应为 ${point.sensorCode}`);
    }
    if (value.temperature !== point.temperature) {
      throw new Error(`温度是 ${value.temperature}，应为 ${point.temperature}`);
    }
    if (value.humidity !== point.humidity || value.co2 !== point.co2) {
      throw new Error(`${point.sensorCode} 的湿度或 CO₂ 与样例不一致`);
    }
    if (value.substrateMoisture !== point.substrateMoisture) {
      throw new Error(`${point.sensorCode} 的基质含水率不一致`);
    }
    assertSafe(value);
    const at = new Date(value.observedAt).getTime();
    if (at < start.getTime() || at >= end.getTime()) throw new Error('观测时间不在今天的上海日里');
    sheds.add(value.shedCode);
  }
  if (sheds.size < 2) throw new Error('全园均值要跨至少两个棚');
  const yParsed = contracts().parseEnvironmentIngress(sample.yesterdayPoint.body, now);
  if (!yParsed.ok) throw new Error(`昨天样例未通过契约：${yParsed.errors.join('；')}`);
  const yAt = new Date(yParsed.value.observedAt).getTime();
  if (yAt < yStart.getTime() || yAt >= yEnd.getTime()) throw new Error('对照传感器不在昨天');
  if (yAt >= start.getTime()) throw new Error('昨天的读数进了今天');
  assertSafe(yParsed.value);
  const clean = cleanEnvMeans();
  if (
    clean.envMeanTemperature !== 24 ||
    clean.envMeanHumidity !== 85 ||
    clean.envMeanCo2 !== 800 ||
    clean.envMeanSubstrateMoisture !== 73
  ) {
    throw new Error(
      `干净当天应为 24℃、85%、CO₂ 800、基质含水率 73%，实际 ${JSON.stringify(clean)}`,
    );
  }
  const fixture = readFixture(DEMO_FIXTURE);
  if (fixture.body.sensorCode !== 'SENSOR-HIST-01') throw new Error('样例文件里的传感器被改掉了');
  if (fixture.body.temperature !== 23.1) throw new Error('样例文件里的温度被改掉了');
  return sample;
}

export function readingsFromBucketRows(rows) {
  const bySensor = new Map();
  for (const row of rows) {
    const code = row.camera_code ?? row.cameraCode ?? '';
    if (!code) continue;
    const slot = bySensor.get(code) ?? { sensorCode: code };
    const value = row.value === null || row.value === undefined ? null : Number(row.value);
    if (row.metric === 'env_temperature') slot.temperature = value;
    if (row.metric === 'env_humidity') slot.humidity = value;
    if (row.metric === 'env_co2') slot.co2 = value;
    if (row.metric === 'env_substrate_moisture') slot.substrateMoisture = value;
    bySensor.set(code, slot);
  }
  return [...bySensor.values()];
}

export function assertSensorReading(items, point) {
  const rows = Array.isArray(items) ? items : [];
  const row = rows.find(
    (item) =>
      item.sensorCode === point.sensorCode &&
      Number(item.temperature) === point.temperature &&
      Number(item.humidity) === point.humidity &&
      Number(item.co2) === point.co2 &&
      Number(item.substrateMoisture) === point.substrateMoisture,
  );
  if (!row) {
    throw new Error(
      `${point.sensorCode} 没有 ${point.temperature}℃ / ${point.humidity}% / CO₂ ${point.co2} / 基质含水率 ${point.substrateMoisture}%`,
    );
  }
  return row;
}

export function assertContrastEmpty(items) {
  const rows = Array.isArray(items) ? items : [];
  if (rows.length !== 0) throw new Error(`对照传感器仍有 ${rows.length} 条`);
}

export function assertOverviewEnv(overview, bucketRows) {
  const parsed = contracts().parseFarmEnvMeans(overview);
  if (!parsed.ok) throw new Error(`总览环境均值未通过契约：${parsed.errors.join('；')}`);
  const readings = readingsFromBucketRows(bucketRows);
  if (readings.some((row) => row.sensorCode === YDAY_SENSOR)) {
    throw new Error('昨天的传感器进了今天的日桶');
  }
  const fromBuckets = contracts().meanFarmEnvironment(readings);
  const means = parsed.value;
  for (const key of MEAN_KEYS) {
    if (means[key] !== fromBuckets[key]) {
      throw new Error(`总览 ${key} 是 ${means[key]}，日桶算出 ${fromBuckets[key]}`);
    }
  }
  for (const point of ENV_POINTS) {
    const row = readings.find((item) => item.sensorCode === point.sensorCode);
    if (!row) throw new Error(`${point.sensorCode} 的当天日桶不在`);
    if (row.temperature !== point.temperature || row.humidity !== point.humidity) {
      throw new Error(`${point.sensorCode} 的日桶温度或湿度被改过`);
    }
    if (row.co2 !== point.co2 || row.substrateMoisture !== point.substrateMoisture) {
      throw new Error(`${point.sensorCode} 的日桶 CO₂ 或基质含水率被改过`);
    }
  }
  const codes = new Set(readings.map((row) => row.sensorCode));
  const clean = cleanEnvMeans();
  const onlyClean =
    codes.size === ENV_POINTS.length && ENV_POINTS.every((point) => codes.has(point.sensorCode));
  if (onlyClean) {
    for (const key of MEAN_KEYS) {
      if (means[key] !== clean[key]) {
        throw new Error(`干净当天 ${key} 是 ${means[key]}，应为 ${clean[key]}`);
      }
    }
  }
  return { means, clean: onlyClean };
}

export function screenUrls(webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  return {
    overview: `${origin}/`,
    screen: `${origin}/big-screen`,
  };
}

export function formatEnvMeanProof({
  means,
  day,
  clean = false,
  webOrigin = webOriginFromEnv(),
}) {
  const pages = screenUrls(webOrigin);
  const lines = ENV_POINTS.map(
    (point) =>
      `${point.sensorCode}（${point.shedCode}）: ${point.temperature}℃ · ${point.humidity}% · CO₂ ${point.co2} · 基质含水率 ${point.substrateMoisture}%`,
  );
  return [
    contracts().formatEnvMeanNote(means),
    `棚区: ${ENV_POINTS.map((point) => point.shedCode).join('、')}`,
    ...lines,
    `${YDAY_SENSOR}: 昨天，不进今天的均值`,
    `对照 ${CONTRAST_SENSOR}: 当天 0 条`,
    '干净当天: 全园环境参数均值 温度 24℃ · 湿度 85% · CO₂ 800ppm · 基质含水率 73%',
    clean ? '当天传感器日桶只有这两台' : '当天还有别的传感器日桶，旁注按同一口径变',
    `上海日: ${day}`,
    '口径: 上海今日环境日桶，传感器行算术平均，棚级行不计入',
    '登录: admin / Admin@123456',
    `总览: ${pages.overview}`,
    `大屏: ${pages.screen}`,
  ].join('\n');
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

export async function placeReading(body, deps = {}) {
  const query = deps.query ?? queryDb;
  const post = deps.post ?? postEnvironment;
  const found = await query(
    'SELECT id FROM environment_readings WHERE idempotency_key = $1',
    [body.idempotencyKey],
  );
  const existingId = found.rows?.[0]?.id;
  if (existingId) {
    await query(
      `UPDATE environment_readings
       SET observed_at = $2::timestamptz,
           temperature = $3,
           humidity = $4,
           co2 = $5,
           substrate_moisture = $6,
           shed_code = $7,
           sensor_code = $8,
           raw_payload = $9::jsonb
       WHERE idempotency_key = $1`,
      [
        body.idempotencyKey,
        body.observedAt,
        body.temperature,
        body.humidity,
        body.co2,
        body.substrateMoisture,
        body.shedCode,
        body.sensorCode,
        JSON.stringify(body),
      ],
    );
    return { id: existingId, created: false };
  }
  const posted = await post(body);
  return { id: posted.id, created: true };
}

export async function syncSensorDayBucket(point, bucketStart, observedAt, deps = {}) {
  const query = deps.query ?? queryDb;
  const end = new Date(bucketStart.getTime() + 24 * 60 * 60 * 1000);
  await query(
    `DELETE FROM metric_buckets_day
      WHERE shed_code = $1
        AND camera_code = $2
        AND bucket_start >= $3::timestamptz
        AND bucket_start < $4::timestamptz
        AND metric IN ('env_temperature', 'env_humidity', 'env_co2', 'env_substrate_moisture')`,
    [point.shedCode, point.sensorCode, bucketStart.toISOString(), end.toISOString()],
  );
  for (const [field, metric] of DAY_METRICS) {
    await query(
      `INSERT INTO metric_buckets_day
        (shed_code, camera_code, bucket_start, metric, value, sample_count, value_sum, latest_at)
       VALUES ($1, $2, $3::timestamptz, $4, $5, 1, $5, $6::timestamptz)`,
      [
        point.shedCode,
        point.sensorCode,
        bucketStart.toISOString(),
        metric,
        point[field],
        observedAt,
      ],
    );
  }
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

export async function sendDemo({ now = new Date() } = {}) {
  const built = buildEnvMeanPayloads(now);
  validateEnvMeanPayloads(built, now);
  const seeded = [...built.points, built.yesterdayPoint];
  for (const point of seeded) {
    await placeReading(point.body);
    await syncSensorDayBucket(point, point.bucketStart, point.observedAt);
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
  for (const point of built.points) {
    const listed = await getJson(token, listUrl(point.sensorCode, built.start, built.end));
    assertSensorReading(listed.items, point);
  }
  const contrast = await getJson(token, listUrl(CONTRAST_SENSOR, built.start, built.end));
  assertContrastEmpty(contrast.items);
  const ydayToday = await getJson(token, listUrl(YDAY_SENSOR, built.start, built.end));
  assertContrastEmpty(ydayToday.items);
  const yday = await getJson(
    token,
    listUrl(YDAY_SENSOR, built.yesterdayPoint.bucketStart.toISOString(), built.start),
  );
  assertSensorReading(yday.items, YDAY_POINT);
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
  const checked = assertOverviewEnv(overview, buckets.rows);
  return { means: checked.means, day: built.day, clean: checked.clean };
}

function usage() {
  return `用法:
  node scripts/demo-env-mean.mjs

读取 ${DEMO_FIXTURE}，写入 SENSOR-EM-01（棚区 S01）和 SENSOR-EM-02（棚区 S02）。步骤见 docs/DEMO_ENV_MEAN.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const sent = await sendDemo();
    process.stdout.write(`${formatEnvMeanProof(sent)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
