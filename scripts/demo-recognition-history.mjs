#!/usr/bin/env node
/**
 * 发四条识别，再按摄像头编号和时间窗读识别列表。
 * 窗内两条留在列表里；窗外来的和另一台摄像头不在这次结果里。
 * HTTP 为默认；`--channel mqtt` 走同一组报文。
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  apiBase,
  ingestRecognitionUrl,
  ingestToken,
  postJson,
  publishMqtt,
  readFixture,
  recognitionTopic,
  repoRoot,
} from './lib/ingest-wire.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';

const require = createRequire(import.meta.url);

export const DEMO_FIXTURE = 'recognition.demo-history.json';
export const DEMO_CAMERA = 'CAM-HIST-01';
export const DEMO_OTHER = 'CAM-HIST-02';
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
    recognizedAt: new Date(stamp - OUTSIDE_OFFSET_MS).toISOString(),
    idempotencyKey: `demo-recognition-history-outside-${stamp}`,
  };
  const other = {
    ...fixture.other,
    recognizedAt: new Date(stamp - OTHER_OFFSET_MS).toISOString(),
    idempotencyKey: `demo-recognition-history-other-${stamp}`,
  };
  const older = {
    ...fixture.older,
    recognizedAt: new Date(stamp - OLDER_OFFSET_MS).toISOString(),
    idempotencyKey: `demo-recognition-history-older-${stamp}`,
  };
  const latest = {
    ...fixture.body,
    recognizedAt: now.toISOString(),
    idempotencyKey: `demo-recognition-history-${stamp}`,
  };
  return { outside, other, older, latest, window };
}

function validateOne(body, now, cameraCode) {
  const parsed = contracts().parseRecognitionIngress(body, now);
  if (!parsed.ok) {
    throw new Error(`样例未通过契约：${parsed.errors.join('；')}`);
  }
  const value = parsed.value;
  if (value.shedCode !== DEMO_SHED) {
    throw new Error(`棚区是 ${value.shedCode}，应为 ${DEMO_SHED}`);
  }
  if (value.cameraCode !== cameraCode) {
    throw new Error(`摄像头是 ${value.cameraCode}，应为 ${cameraCode}`);
  }
  if (!Number.isFinite(value.mushroomCount)) throw new Error('样例缺少蘑菇数量');
  if (!Number.isFinite(value.matureCount)) throw new Error('样例缺少成熟数量');
  if (value.snapshotBase64) {
    const bytes = Buffer.from(value.snapshotBase64, 'base64');
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      throw new Error('样例 AI抓拍图 不是 JPEG');
    }
  }
  return value;
}

export function validateDemoPayloads(payloads, now = new Date()) {
  const outside = validateOne(payloads.outside, now, DEMO_CAMERA);
  const other = validateOne(payloads.other, now, DEMO_OTHER);
  const older = validateOne(payloads.older, now, DEMO_CAMERA);
  const latest = validateOne(payloads.latest, now, DEMO_CAMERA);
  const counts = [outside.mushroomCount, other.mushroomCount, older.mushroomCount, latest.mushroomCount];
  if (new Set(counts).size !== counts.length) {
    throw new Error('四条识别的蘑菇数量必须各不相同');
  }
  const from = new Date(payloads.window.from).getTime();
  const to = new Date(payloads.window.to).getTime();
  for (const row of [older, latest]) {
    const at = new Date(row.recognizedAt).getTime();
    if (at < from || at > to) throw new Error('窗内识别的识别时间不在查询窗口里');
  }
  if (new Date(outside.recognizedAt).getTime() >= from) {
    throw new Error('窗外来的识别落进了查询窗口');
  }
  const otherAt = new Date(other.recognizedAt).getTime();
  if (otherAt < from || otherAt > to) throw new Error('另一台摄像头的识别时间不在查询窗口里');
  if (new Date(older.recognizedAt).getTime() >= new Date(latest.recognizedAt).getTime()) {
    throw new Error('较早一条的识别时间不早于最新一条');
  }
  return { outside, other, older, latest, window: payloads.window };
}

export function recognitionHistoryUrl(
  { cameraCode, from, to },
  webOrigin = webOriginFromEnv(),
) {
  const params = new URLSearchParams({ cameraCode, from, to });
  return `${String(webOrigin).replace(/\/$/, '')}/recognitions?${params.toString()}`;
}

function historyApiUrl(cameraCode, from, to) {
  const params = new URLSearchParams({
    cameraCode,
    from,
    to,
    pageSize: '50',
  });
  return `${apiBase()}/ingest/recognitions?${params.toString()}`;
}

function pointApiUrl(cameraCode, at) {
  const params = new URLSearchParams({
    cameraCode,
    from: at,
    to: at,
    pageSize: '50',
  });
  return `${apiBase()}/ingest/recognitions?${params.toString()}`;
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
    '发了 4 条识别',
    `通道: ${channel}`,
    `棚区: ${latest.shedCode}`,
    `摄像头: ${latest.cameraCode}`,
    `窗内总数: ${older.mushroomCount}、${latest.mushroomCount}`,
    `窗外总数: ${outside.mushroomCount}`,
    `另一台: ${other.cameraCode} 总数 ${other.mushroomCount}`,
    `开始: ${window.from}`,
    `结束: ${window.to}`,
    '登录: admin / Admin@123456',
    `打开: ${recognitionHistoryUrl(
      { cameraCode: latest.cameraCode, from: window.from, to: window.to },
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

function findRecognition(items, expected) {
  return (Array.isArray(items) ? items : []).find(
    (item) =>
      item.cameraCode === expected.cameraCode &&
      Number(item.mushroomCount) === Number(expected.mushroomCount) &&
      sameInstant(item.recognizedAt, expected.recognizedAt),
  );
}

export function assertHistoryWindow(items, payloads) {
  const rows = Array.isArray(items) ? items : [];
  const from = new Date(payloads.window.from).getTime();
  const to = new Date(payloads.window.to).getTime();
  for (const row of rows) {
    if (row.cameraCode !== payloads.latest.cameraCode) {
      throw new Error(`识别列表里有 ${row.cameraCode}，这次只查 ${payloads.latest.cameraCode}`);
    }
    const at = new Date(row.recognizedAt).getTime();
    if (at < from || at > to) {
      throw new Error(`识别列表里有窗口外的记录 ${row.recognizedAt}`);
    }
  }
  const older = findRecognition(rows, payloads.older);
  const latest = findRecognition(rows, payloads.latest);
  if (!older) throw new Error(`识别列表里没有窗内较早的总数 ${payloads.older.mushroomCount}`);
  if (!latest) throw new Error(`识别列表里没有窗内较新的总数 ${payloads.latest.mushroomCount}`);
  if (findRecognition(rows, payloads.outside)) {
    throw new Error(`窗外的总数 ${payloads.outside.mushroomCount} 不该出现在这个时间窗`);
  }
  if (rows.some((row) => row.cameraCode === payloads.other.cameraCode)) {
    throw new Error(`${payloads.other.cameraCode} 不该出现在 ${payloads.latest.cameraCode} 的识别里`);
  }
  if (Number(rows[0]?.mushroomCount) !== Number(payloads.latest.mushroomCount)) {
    throw new Error(`识别列表第一条总数是 ${rows[0]?.mushroomCount}，不是较新的 ${payloads.latest.mushroomCount}`);
  }
  return { older, latest };
}

export function assertOutsideKept(items, outside) {
  if (!findRecognition(items, outside)) {
    throw new Error(`不限到这一时刻时，窗外的总数 ${outside.mushroomCount} 应该还在这台摄像头的识别里`);
  }
}

export function assertOtherCamera(items, other, camera) {
  const rows = Array.isArray(items) ? items : [];
  if (!findRecognition(rows, other)) {
    throw new Error(`另一台 ${other.cameraCode} 的总数 ${other.mushroomCount} 没有留在它自己的时间窗里`);
  }
  if (rows.some((row) => row.cameraCode === camera)) {
    throw new Error(`${camera} 不该出现在 ${other.cameraCode} 的识别里`);
  }
}

async function postRecognition(body) {
  const url = ingestRecognitionUrl();
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
    throw new Error(`识别报文被拒绝 ${posted.responseStatus} ${messageText(payload)}`);
  }
  if (flag(payload, 'duplicate') === true) {
    throw new Error('这次没有写入新识别');
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
  const url = historyApiUrl(payloads.latest.cameraCode, payloads.window.from, payloads.window.to);
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
    topic = recognitionTopic(payloads.latest.shedCode, payloads.latest.cameraCode);
    await publish(topic, JSON.stringify(payloads.outside));
    await publish(topic, JSON.stringify(payloads.older));
    await publish(topic, JSON.stringify(payloads.latest));
    await publish(
      recognitionTopic(payloads.other.shedCode, payloads.other.cameraCode),
      JSON.stringify(payloads.other),
    );
  } else {
    await postRecognition(payloads.outside);
    await postRecognition(payloads.other);
    await postRecognition(payloads.older);
    await postRecognition(payloads.latest);
  }
  const token = await login();
  const wait = timeoutMs ?? (channel === 'mqtt' ? 15_000 : 3_000);
  await pollHistory(token, payloads, wait);
  const stored = await getJson(
    token,
    pointApiUrl(payloads.outside.cameraCode, payloads.outside.recognizedAt),
  );
  assertOutsideKept(stored.items, payloads.outside);
  const other = await getJson(
    token,
    historyApiUrl(payloads.other.cameraCode, payloads.window.from, payloads.window.to),
  );
  assertOtherCamera(other.items, payloads.other, payloads.latest.cameraCode);
  return { channel, ...payloads, topic };
}

function usage() {
  return `用法:
  node scripts/demo-recognition-history.mjs
  node scripts/demo-recognition-history.mjs --channel mqtt

默认 HTTP POST /api/v1/ingest/recognition。样例 ${DEMO_FIXTURE}。`;
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
