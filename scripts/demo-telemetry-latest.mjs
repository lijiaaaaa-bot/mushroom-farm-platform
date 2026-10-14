#!/usr/bin/env node
/**
 * 发两条环境遥测。先写较早一条，再写当前时刻的一条。
 * 最新值接口和详情必须是后一条。HTTP 为默认；`--channel mqtt` 走同一对报文。
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  apiBase,
  environmentTopic,
  ingestToken,
  postJson,
  publishMqtt,
  readFixture,
  repoRoot,
} from './lib/ingest-wire.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';

const require = createRequire(import.meta.url);

export const DEMO_FIXTURE = 'environment.demo-latest.json';
export const DEMO_SENSOR = 'SENSOR-LATEST-01';
export const DEMO_SHED = 'S01';

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function buildDemoPayloads(now = new Date()) {
  const fixture = readFixture(DEMO_FIXTURE);
  const stamp = now.getTime();
  const older = {
    ...fixture.older,
    observedAt: new Date(stamp - 120_000).toISOString(),
    idempotencyKey: `demo-telemetry-older-${stamp}`,
  };
  const latest = {
    ...fixture.body,
    observedAt: now.toISOString(),
    idempotencyKey: `demo-telemetry-latest-${stamp}`,
  };
  return { older, latest };
}

function validateOne(body, now) {
  const parsed = contracts().parseEnvironmentIngress(body, now);
  if (!parsed.ok) {
    throw new Error(`样例未通过契约：${parsed.errors.join('；')}`);
  }
  const value = parsed.value;
  if (value.shedCode !== DEMO_SHED) {
    throw new Error(`棚区是 ${value.shedCode}，应为 ${DEMO_SHED}`);
  }
  if (value.sensorCode !== DEMO_SENSOR) {
    throw new Error(`传感器是 ${value.sensorCode}，应为 ${DEMO_SENSOR}`);
  }
  for (const [key, label] of [
    ['temperature', '温度'],
    ['humidity', '湿度'],
    ['co2', 'CO₂'],
    ['substrateMoisture', '基质含水率'],
  ]) {
    if (typeof value[key] !== 'number') throw new Error(`样例缺少${label}`);
  }
  return value;
}

export function validateDemoPayloads(payloads, now = new Date()) {
  const older = validateOne(payloads.older, now);
  const latest = validateOne(payloads.latest, now);
  if (older.temperature === latest.temperature) {
    throw new Error('两条遥测的温度相同，看不出最新值');
  }
  if (new Date(older.observedAt).getTime() >= new Date(latest.observedAt).getTime()) {
    throw new Error('较早一条的观测时间不早于最新一条');
  }
  return { older, latest };
}

export function environmentUiUrl(webOrigin = webOriginFromEnv()) {
  return `${String(webOrigin).replace(/\/$/, '')}/environment`;
}

export function environmentDetailUrl(id, webOrigin = webOriginFromEnv()) {
  return `${environmentUiUrl(webOrigin)}/${encodeURIComponent(id)}`;
}

function latestApiUrl(sensorCode) {
  return `${apiBase()}/ingest/environment-readings/latest?sensorCode=${encodeURIComponent(sensorCode)}`;
}

function historyApiUrl(sensorCode) {
  return `${apiBase()}/ingest/environment-readings?sensorCode=${encodeURIComponent(sensorCode)}&pageSize=50`;
}

function detailApiUrl(id) {
  return `${apiBase()}/ingest/environment-readings/${encodeURIComponent(id)}`;
}

export function formatDemoProof({
  channel,
  older,
  latest,
  id,
  topic,
  webOrigin = webOriginFromEnv(),
}) {
  const lines = [
    '发了 2 条环境遥测',
    `通道: ${channel}`,
    `id: ${id}`,
    `棚区: ${latest.shedCode}`,
    `传感器: ${latest.sensorCode}`,
    `最新温度: ${latest.temperature}℃`,
    `最新湿度: ${latest.humidity}%`,
    `最新 CO₂: ${latest.co2}`,
    `最新基质含水率: ${latest.substrateMoisture}%`,
    `观测时间: ${latest.observedAt}`,
    `较早温度: ${older.temperature}℃`,
    '登录: admin / Admin@123456',
    `打开: ${environmentUiUrl(webOrigin)}`,
    `详情: ${environmentDetailUrl(id, webOrigin)}`,
  ];
  if (topic) lines.push(`主题: ${topic}`);
  return lines.join('\n');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageText(payload) {
  const inner = payload && typeof payload.message === 'object' ? payload.message : payload;
  const errors = inner?.errors || payload?.errors;
  const code = inner?.code || payload?.code;
  const list = Array.isArray(errors) ? errors.join('；') : JSON.stringify(payload);
  return code ? `${code} ${list}` : list;
}

function flag(payload, key) {
  return payload?.[key] ?? payload?.message?.[key];
}

function sameInstant(left, right) {
  const a = new Date(left).getTime();
  const b = new Date(right).getTime();
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1000;
}

export function assertLatestReading(row, latest) {
  if (!row) throw new Error(`最新值列表里没有 ${latest.sensorCode}`);
  if (row.sensorCode !== latest.sensorCode) {
    throw new Error(`传感器是 ${row.sensorCode}，应为 ${latest.sensorCode}`);
  }
  if (row.shedCode !== latest.shedCode) {
    throw new Error(`棚区是 ${row.shedCode}，应为 ${latest.shedCode}`);
  }
  for (const [key, label] of [
    ['temperature', '温度'],
    ['humidity', '湿度'],
    ['co2', 'CO₂'],
    ['substrateMoisture', '基质含水率'],
  ]) {
    if (Number(row[key]) !== Number(latest[key])) {
      throw new Error(`最新${label}是 ${row[key]}，这次发送的是 ${latest[key]}`);
    }
  }
  if (!sameInstant(row.observedAt, latest.observedAt)) {
    throw new Error(`最新观测时间 ${row.observedAt} 不是这次的 ${latest.observedAt}`);
  }
}

export function assertHistoryKeepsOlder(items, older, latest) {
  const rows = Array.isArray(items) ? items : [];
  const temps = rows.map((item) => Number(item.temperature));
  if (!temps.includes(Number(latest.temperature))) {
    throw new Error('读数列表里没有这次的最新温度');
  }
  if (!temps.includes(Number(older.temperature))) {
    throw new Error('较早一条没有留在读数列表里');
  }
  if (Number(rows[0]?.temperature) !== Number(latest.temperature)) {
    throw new Error(`读数列表第一条温度是 ${rows[0]?.temperature}，不是最新的 ${latest.temperature}`);
  }
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
    throw new Error('这次没有写入新读数');
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
  const session = await response.json().catch(() => ({}));
  if (!response.ok || !session.accessToken) {
    throw new Error(`登录失败 ${response.status}。确认 API 已用种子账号启动。`);
  }
  return session.accessToken;
}

async function getJson(token, url) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`读取失败 ${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function pollLatest(token, latest, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() <= deadline) {
    const body = await getJson(token, latestApiUrl(latest.sensorCode));
    const items = Array.isArray(body.items) ? body.items : [];
    last = items.find((item) => item.sensorCode === latest.sensorCode) ?? items[0] ?? null;
    if (items.length > 1) {
      throw new Error(`传感器 ${latest.sensorCode} 的最新值返回了 ${items.length} 条`);
    }
    try {
      assertLatestReading(last, latest);
      return last;
    } catch (error) {
      if (Date.now() + 400 > deadline) throw error;
    }
    await sleep(400);
  }
  assertLatestReading(last, latest);
  return last;
}

export function resolveChannel(argv) {
  const index = argv.indexOf('--channel');
  const channel = index === -1 ? 'http' : argv[index + 1];
  if (channel !== 'http' && channel !== 'mqtt') {
    throw new Error('channel 只能是 http 或 mqtt');
  }
  return channel;
}

export async function sendDemo({
  channel = 'http',
  now = new Date(),
  publish = publishMqtt,
  timeoutMs,
} = {}) {
  if (channel !== 'http' && channel !== 'mqtt') {
    throw new Error('channel 只能是 http 或 mqtt');
  }
  const payloads = buildDemoPayloads(now);
  const { older, latest } = validateDemoPayloads(payloads, now);
  let topic;
  let postedId;
  if (channel === 'mqtt') {
    topic = environmentTopic(latest.shedCode, latest.sensorCode);
    await publish(topic, JSON.stringify(older));
    await publish(topic, JSON.stringify(latest));
  } else {
    await postEnvironment(older);
    postedId = (await postEnvironment(latest)).id;
  }
  const token = await login();
  const wait = timeoutMs ?? (channel === 'mqtt' ? 15_000 : 3_000);
  const row = await pollLatest(token, latest, wait);
  if (postedId && row.id !== postedId) {
    throw new Error(`最新值 id ${row.id} 不是这次写入的 ${postedId}`);
  }
  const history = await getJson(token, historyApiUrl(latest.sensorCode));
  assertHistoryKeepsOlder(history.items, older, latest);
  const detail = await getJson(token, detailApiUrl(row.id));
  assertLatestReading(detail, latest);
  return { channel, older, latest, id: row.id, topic };
}

function usage() {
  return `用法:
  node scripts/demo-telemetry-latest.mjs
  node scripts/demo-telemetry-latest.mjs --channel mqtt

默认 HTTP POST /api/v1/ingest/environment。样例 ${DEMO_FIXTURE}。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const channel = resolveChannel(process.argv);
    const sent = await sendDemo({ channel });
    process.stdout.write(`${formatDemoProof(sent)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
