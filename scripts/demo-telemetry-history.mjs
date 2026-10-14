#!/usr/bin/env node
/**
 * 发四条环境遥测，再按传感器编号和时间窗读历史列表。
 * 窗内两条留在列表里；窗外来的和另一台传感器不在这次结果里。
 * HTTP 为默认；`--channel mqtt` 走同一组报文。
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

export const DEMO_FIXTURE = 'environment.demo-history.json';
export const DEMO_SENSOR = 'SENSOR-HIST-01';
export const DEMO_OTHER = 'SENSOR-HIST-02';
export const DEMO_SHED = 'S01';
const WINDOW_BEFORE_MS = 30 * 60 * 1000;
const WINDOW_AFTER_MS = 60 * 1000;
const OLDER_OFFSET_MS = 8 * 60 * 1000;
const OTHER_OFFSET_MS = 4 * 60 * 1000;
const OUTSIDE_OFFSET_MS = 3 * 60 * 60 * 1000;

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function historyWindow(now = new Date()) {
  const stamp = now.getTime();
  return {
    from: new Date(stamp - WINDOW_BEFORE_MS).toISOString(),
    to: new Date(stamp + WINDOW_AFTER_MS).toISOString(),
  };
}

export function buildDemoPayloads(now = new Date()) {
  const fixture = readFixture(DEMO_FIXTURE);
  const stamp = now.getTime();
  const window = historyWindow(now);
  const outside = {
    ...fixture.outside,
    observedAt: new Date(stamp - OUTSIDE_OFFSET_MS).toISOString(),
    idempotencyKey: `demo-telemetry-history-outside-${stamp}`,
  };
  const other = {
    ...fixture.other,
    observedAt: new Date(stamp - OTHER_OFFSET_MS).toISOString(),
    idempotencyKey: `demo-telemetry-history-other-${stamp}`,
  };
  const older = {
    ...fixture.older,
    observedAt: new Date(stamp - OLDER_OFFSET_MS).toISOString(),
    idempotencyKey: `demo-telemetry-history-older-${stamp}`,
  };
  const latest = {
    ...fixture.body,
    observedAt: now.toISOString(),
    idempotencyKey: `demo-telemetry-history-${stamp}`,
  };
  return { outside, other, older, latest, window };
}

function validateOne(body, now, sensorCode) {
  const parsed = contracts().parseEnvironmentIngress(body, now);
  if (!parsed.ok) {
    throw new Error(`样例未通过契约：${parsed.errors.join('；')}`);
  }
  const value = parsed.value;
  if (value.shedCode !== DEMO_SHED) {
    throw new Error(`棚区是 ${value.shedCode}，应为 ${DEMO_SHED}`);
  }
  if (value.sensorCode !== sensorCode) {
    throw new Error(`传感器是 ${value.sensorCode}，应为 ${sensorCode}`);
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
  const outside = validateOne(payloads.outside, now, DEMO_SENSOR);
  const other = validateOne(payloads.other, now, DEMO_OTHER);
  const older = validateOne(payloads.older, now, DEMO_SENSOR);
  const latest = validateOne(payloads.latest, now, DEMO_SENSOR);
  const temps = [outside.temperature, other.temperature, older.temperature, latest.temperature];
  if (new Set(temps).size !== temps.length) {
    throw new Error('四条遥测的温度必须各不相同');
  }
  const from = new Date(payloads.window.from).getTime();
  const to = new Date(payloads.window.to).getTime();
  for (const row of [older, latest]) {
    const at = new Date(row.observedAt).getTime();
    if (at < from || at > to) throw new Error('窗内读数的观测时间不在查询窗口里');
  }
  if (new Date(outside.observedAt).getTime() >= from) {
    throw new Error('窗外来的读数落进了查询窗口');
  }
  const otherAt = new Date(other.observedAt).getTime();
  if (otherAt < from || otherAt > to) throw new Error('另一台传感器的观测时间不在查询窗口里');
  if (new Date(older.observedAt).getTime() >= new Date(latest.observedAt).getTime()) {
    throw new Error('较早一条的观测时间不早于最新一条');
  }
  return { outside, other, older, latest, window: payloads.window };
}

export function environmentHistoryUrl(
  { sensorCode, from, to },
  webOrigin = webOriginFromEnv(),
) {
  const params = new URLSearchParams({ sensorCode, from, to });
  return `${String(webOrigin).replace(/\/$/, '')}/environment?${params.toString()}`;
}

function historyApiUrl(sensorCode, from, to) {
  const params = new URLSearchParams({
    sensorCode,
    from,
    to,
    pageSize: '50',
  });
  return `${apiBase()}/ingest/environment-readings?${params.toString()}`;
}

function pointApiUrl(sensorCode, at) {
  const params = new URLSearchParams({
    sensorCode,
    from: at,
    to: at,
    pageSize: '50',
  });
  return `${apiBase()}/ingest/environment-readings?${params.toString()}`;
}

export function formatDemoProof({
  channel,
  outside,
  other,
  older,
  latest,
  window,
  topic,
  webOrigin = webOriginFromEnv(),
}) {
  const lines = [
    '发了 4 条环境遥测',
    `通道: ${channel}`,
    `棚区: ${latest.shedCode}`,
    `传感器: ${latest.sensorCode}`,
    `窗内温度: ${older.temperature}℃、${latest.temperature}℃`,
    `窗外温度: ${outside.temperature}℃`,
    `另一台: ${other.sensorCode} ${other.temperature}℃`,
    `开始: ${window.from}`,
    `结束: ${window.to}`,
    '登录: admin / Admin@123456',
    `打开: ${environmentHistoryUrl(
      { sensorCode: latest.sensorCode, from: window.from, to: window.to },
      webOrigin,
    )}`,
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

function findReading(items, expected) {
  return (Array.isArray(items) ? items : []).find(
    (item) =>
      item.sensorCode === expected.sensorCode &&
      Number(item.temperature) === Number(expected.temperature) &&
      sameInstant(item.observedAt, expected.observedAt),
  );
}

export function assertHistoryWindow(items, payloads) {
  const rows = Array.isArray(items) ? items : [];
  const from = new Date(payloads.window.from).getTime();
  const to = new Date(payloads.window.to).getTime();
  for (const row of rows) {
    if (row.sensorCode !== payloads.latest.sensorCode) {
      throw new Error(`历史列表里有 ${row.sensorCode}，这次只查 ${payloads.latest.sensorCode}`);
    }
    const at = new Date(row.observedAt).getTime();
    if (at < from || at > to) {
      throw new Error(`历史列表里有窗口外的读数 ${row.observedAt}`);
    }
  }
  const older = findReading(rows, payloads.older);
  const latest = findReading(rows, payloads.latest);
  if (!older) throw new Error(`历史列表里没有窗内较早的 ${payloads.older.temperature}℃`);
  if (!latest) throw new Error(`历史列表里没有窗内较新的 ${payloads.latest.temperature}℃`);
  if (findReading(rows, payloads.outside)) {
    throw new Error(`窗外的 ${payloads.outside.temperature}℃ 不该出现在这个时间窗`);
  }
  if (rows.some((row) => row.sensorCode === payloads.other.sensorCode)) {
    throw new Error(`${payloads.other.sensorCode} 不该出现在 ${payloads.latest.sensorCode} 的历史里`);
  }
  if (Number(rows[0]?.temperature) !== Number(payloads.latest.temperature)) {
    throw new Error(`历史列表第一条温度是 ${rows[0]?.temperature}，不是较新的 ${payloads.latest.temperature}`);
  }
  return { older, latest };
}

export function assertOutsideKept(items, outside) {
  if (!findReading(items, outside)) {
    throw new Error(`不限时间时，窗外的 ${outside.temperature}℃ 应该还在这台传感器的读数里`);
  }
}

export function assertOtherSensor(items, other, sensor) {
  const rows = Array.isArray(items) ? items : [];
  if (!findReading(rows, other)) {
    throw new Error(`另一台 ${other.sensorCode} 的 ${other.temperature}℃ 没有留在它自己的时间窗里`);
  }
  if (rows.some((row) => row.sensorCode === sensor)) {
    throw new Error(`${sensor} 不该出现在 ${other.sensorCode} 的历史里`);
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

async function pollHistory(token, payloads, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  const url = historyApiUrl(payloads.latest.sensorCode, payloads.window.from, payloads.window.to);
  while (Date.now() <= deadline) {
    const body = await getJson(token, url);
    last = Array.isArray(body.items) ? body.items : [];
    try {
      assertHistoryWindow(last, payloads);
      return last;
    } catch (error) {
      if (Date.now() + 400 > deadline) throw error;
    }
    await sleep(400);
  }
  assertHistoryWindow(last, payloads);
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
  const payloads = validateDemoPayloads(buildDemoPayloads(now), now);
  let topic;
  if (channel === 'mqtt') {
    topic = environmentTopic(payloads.latest.shedCode, payloads.latest.sensorCode);
    await publish(topic, JSON.stringify(payloads.outside));
    await publish(topic, JSON.stringify(payloads.older));
    await publish(topic, JSON.stringify(payloads.latest));
    await publish(
      environmentTopic(payloads.other.shedCode, payloads.other.sensorCode),
      JSON.stringify(payloads.other),
    );
  } else {
    await postEnvironment(payloads.outside);
    await postEnvironment(payloads.other);
    await postEnvironment(payloads.older);
    await postEnvironment(payloads.latest);
  }
  const token = await login();
  const wait = timeoutMs ?? (channel === 'mqtt' ? 15_000 : 3_000);
  await pollHistory(token, payloads, wait);
  const stored = await getJson(
    token,
    pointApiUrl(payloads.outside.sensorCode, payloads.outside.observedAt),
  );
  assertOutsideKept(stored.items, payloads.outside);
  const other = await getJson(
    token,
    historyApiUrl(payloads.other.sensorCode, payloads.window.from, payloads.window.to),
  );
  assertOtherSensor(other.items, payloads.other, payloads.latest.sensorCode);
  return { channel, ...payloads, topic };
}

function usage() {
  return `用法:
  node scripts/demo-telemetry-history.mjs
  node scripts/demo-telemetry-history.mjs --channel mqtt

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
