#!/usr/bin/env node
/**
 * 留下同一棚、同一传感器近 24 小时内四个小时的环境读数。
 * 小时桶按传感器重写，曲线页读出温度 22℃ → 26℃。
 * 样例文件不改。不改 /environment 的时间筛选。
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
export const DEMO_SENSOR = 'SENSOR-ENV24-01';
export const DEMO_SHED = 'S01';
export const HOUR_MS = 60 * 60 * 1000;

export const SLOTS = [
  {
    hoursAgo: 18,
    key: 'demo-shed-env-24h-18',
    temperature: 22,
    humidity: 78,
    co2: 620,
    substrateMoisture: 68,
  },
  {
    hoursAgo: 12,
    key: 'demo-shed-env-24h-12',
    temperature: 24,
    humidity: 84,
    co2: 760,
    substrateMoisture: 72,
  },
  {
    hoursAgo: 6,
    key: 'demo-shed-env-24h-6',
    temperature: 25,
    humidity: 88,
    co2: 880,
    substrateMoisture: 75,
  },
  {
    hoursAgo: 0,
    key: 'demo-shed-env-24h-0',
    temperature: 26,
    humidity: 92,
    co2: 980,
    substrateMoisture: 78,
  },
];

export const HOUR_METRICS = [
  ['temperature', 'env_temperature'],
  ['humidity', 'env_humidity'],
  ['co2', 'env_co2'],
  ['substrateMoisture', 'env_substrate_moisture'],
];

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function buildShedEnvSamples(now = new Date()) {
  const fixture = readFixture(DEMO_FIXTURE);
  const endHour = contracts().shanghaiHourStart(now);
  return SLOTS.map((slot) => {
    const hourStart = new Date(endHour.getTime() - slot.hoursAgo * HOUR_MS);
    const inside = new Date(hourStart.getTime() + 15 * 60 * 1000);
    const observedAt = inside.getTime() > now.getTime() ? now : inside;
    return {
      ...slot,
      hourStart,
      observedAt: observedAt.toISOString(),
      body: {
        ...fixture.body,
        idempotencyKey: slot.key,
        shedCode: DEMO_SHED,
        sensorCode: DEMO_SENSOR,
        observedAt: observedAt.toISOString(),
        temperature: slot.temperature,
        humidity: slot.humidity,
        co2: slot.co2,
        substrateMoisture: slot.substrateMoisture,
      },
    };
  });
}

export function validateShedEnvSamples(samples, now = new Date()) {
  if (!Array.isArray(samples) || samples.length !== SLOTS.length) {
    throw new Error(`应有 ${SLOTS.length} 个小时点`);
  }
  const endHour = contracts().shanghaiHourStart(now);
  const windowStart = endHour.getTime() - 23 * HOUR_MS;
  const windowEnd = endHour.getTime() + HOUR_MS;
  const hours = new Set();
  for (const sample of samples) {
    const parsed = contracts().parseEnvironmentIngress(sample.body, now);
    if (!parsed.ok) throw new Error(`样例未通过契约：${parsed.errors.join('；')}`);
    const value = parsed.value;
    if (value.shedCode !== DEMO_SHED) throw new Error(`棚区是 ${value.shedCode}，应为 ${DEMO_SHED}`);
    if (value.sensorCode !== DEMO_SENSOR) {
      throw new Error(`传感器是 ${value.sensorCode}，应为 ${DEMO_SENSOR}`);
    }
    if (value.sensorCode.startsWith('SENSOR-HIST') || value.sensorCode === 'SENSOR-ENVF-01') {
      throw new Error('24 小时曲线不能占用历史列表或时间筛选的传感器');
    }
    if (value.idempotencyKey !== sample.key) {
      throw new Error(`幂等键是 ${value.idempotencyKey}，应为 ${sample.key}`);
    }
    if (value.temperature !== sample.temperature) {
      throw new Error(`温度是 ${value.temperature}，应为 ${sample.temperature}`);
    }
    const hour = new Date(sample.hourStart).getTime();
    if (hour < windowStart || hour >= windowEnd) {
      throw new Error(`${sample.key} 的小时不在近 24 小时里`);
    }
    const observed = new Date(value.observedAt).getTime();
    if (observed < hour || observed >= hour + HOUR_MS) {
      throw new Error(`${sample.key} 的观测时间不在该小时`);
    }
    if (observed > now.getTime()) throw new Error(`${sample.key} 的观测时间晚于现在`);
    hours.add(hour);
  }
  if (hours.size !== samples.length) throw new Error('四个小时点必须落在不同小时');
  const temps = samples.map((sample) => sample.temperature);
  const humidities = samples.map((sample) => sample.humidity);
  if (temps[0] !== 22 || temps[temps.length - 1] !== 26) {
    throw new Error('温度应从 22℃ 到 26℃');
  }
  if (temps[temps.length - 1] <= temps[0] || humidities[humidities.length - 1] <= humidities[0]) {
    throw new Error('温度和湿度都要随小时升高');
  }
  return samples;
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

export async function syncSensorHourBuckets(samples, deps = {}) {
  const query = deps.query ?? queryDb;
  await query(
    `DELETE FROM metric_buckets_hour
      WHERE shed_code = $1
        AND camera_code = $2
        AND metric IN ('env_temperature', 'env_humidity', 'env_co2', 'env_substrate_moisture')`,
    [DEMO_SHED, DEMO_SENSOR],
  );
  for (const sample of samples) {
    for (const [field, metric] of HOUR_METRICS) {
      await query(
        `INSERT INTO metric_buckets_hour
          (shed_code, camera_code, bucket_start, metric, value, sample_count, value_sum, latest_at)
         VALUES ($1, $2, $3::timestamptz, $4, $5, 1, $5, $6::timestamptz)`,
        [
          DEMO_SHED,
          DEMO_SENSOR,
          sample.hourStart.toISOString(),
          metric,
          sample[field],
          sample.observedAt,
        ],
      );
    }
  }
}

async function readJson(response) {
  return response.json().catch(() => ({}));
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

export function shedEnv24hUrl(webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const params = new URLSearchParams({
    shedCode: DEMO_SHED,
    sensorCode: DEMO_SENSOR,
  });
  return `${origin}/shed-env-24h?${params.toString()}`;
}

function seriesNumbers(points, field) {
  return (Array.isArray(points) ? points : [])
    .map((point) => point?.[field])
    .filter((value) => typeof value === 'number');
}

export function assertSeries(body) {
  const shed = Array.isArray(body?.sheds)
    ? body.sheds.find((item) => item.shedCode === DEMO_SHED)
    : undefined;
  const points = shed?.points?.length ? shed.points : body?.points;
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error('24 小时曲线少于两个点');
  }
  const temps = seriesNumbers(points, 'temperature');
  const humidities = seriesNumbers(points, 'humidity');
  if (temps[0] !== 22 || temps[temps.length - 1] !== 26) {
    throw new Error(`温度曲线是 ${temps.join(' → ')}，应为 22 → 26`);
  }
  if (humidities[0] !== 78 || humidities[humidities.length - 1] !== 92) {
    throw new Error(`湿度曲线是 ${humidities.join(' → ')}，应为 78 → 92`);
  }
  if (temps[temps.length - 1] <= temps[0] || humidities[humidities.length - 1] <= humidities[0]) {
    throw new Error('至少温度和湿度要随时间升高');
  }
  return { temps, humidities, count: points.length };
}

export function formatShedEnvProof({
  seeded,
  samples,
  series,
  webOrigin = webOriginFromEnv(),
}) {
  const line = (sample) => {
    const row = seeded.find((item) => item.idempotencyKey === sample.key);
    return `${sample.hoursAgo} 小时前: ${row?.created ? '新建' : '沿用'} ${sample.temperature}℃ ${sample.humidity}% CO₂ ${sample.co2} 基质含水率 ${sample.substrateMoisture}%`;
  };
  const lines = [
    `留下 ${seeded.length} 条环境读数`,
    `棚区: ${DEMO_SHED}`,
    `传感器: ${DEMO_SENSOR}`,
    ...samples.map(line),
    `温度: ${series.temps.join(' → ')}（升）`,
    `湿度: ${series.humidities.join(' → ')}（升）`,
    `小时点数: ${series.count}`,
    '登录: admin / Admin@123456',
    `打开: ${shedEnv24hUrl(webOrigin)}`,
  ];
  return lines.join('\n');
}

export async function sendShedEnv24hDemo({
  now = new Date(),
  place = placeReading,
  sync = syncSensorHourBuckets,
} = {}) {
  const samples = validateShedEnvSamples(buildShedEnvSamples(now), now);
  const seeded = [];
  for (const sample of samples) {
    const saved = await place(sample.body);
    seeded.push({
      id: saved.id,
      created: saved.created,
      idempotencyKey: sample.key,
    });
  }
  await sync(samples);
  const token = await login();
  const url = new URL(`${apiBase()}/growth-trends/environment`);
  url.searchParams.set('hours', '24');
  url.searchParams.set('shedCode', DEMO_SHED);
  url.searchParams.set('sensorCode', DEMO_SENSOR);
  let response;
  try {
    response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  } catch (error) {
    throw new Error(`API 连不上（${url}）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`环境小时曲线失败 ${response.status} ${messageText(body) || JSON.stringify(body)}`);
  }
  const series = assertSeries(body);
  return { seeded, samples, series };
}

function usage() {
  return `用法:
  node scripts/demo-shed-env-24h.mjs

留下 SENSOR-ENV24-01 近 24 小时的环境曲线。步骤见 docs/DEMO_SHED_ENV_24H.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await sendShedEnv24hDemo();
    process.stdout.write(`${formatShedEnvProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
