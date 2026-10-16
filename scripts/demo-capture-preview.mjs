#!/usr/bin/env node
/**
 * 写入 CAM-CP-01 三条不同时间的识别，抓拍对照页左右看原始图和 AI标注。
 * 样例仍是 recognition.demo-one.json，只改本次请求的摄像头、数量、时间和幂等键。
 * 对照摄像头 CAM-CP-NONE 不写入。
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  apiBase,
  ingestRecognitionUrl,
  ingestToken,
  postJson,
  readFixture,
  repoRoot,
} from './lib/ingest-wire.mjs';
import { snapshotReadUrl, webOriginFromEnv } from './demo-one-http-recognition.mjs';

const require = createRequire(import.meta.url);

export const DEMO_FIXTURE = 'recognition.demo-one.json';
export const DEMO_CAMERA = 'CAM-CP-01';
export const DEMO_SHED = 'S01';
export const CONTRAST_CAMERA = 'CAM-CP-NONE';
export const WINDOW_BEFORE_MS = 25 * 60 * 1000;
export const WINDOW_AFTER_MS = 60 * 1000;

export const CAPTURE_POINTS = [
  { slot: 'older', offsetMs: 20 * 60 * 1000, mushroomCount: 8, matureCount: 2, diseaseCount: 1 },
  { slot: 'middle', offsetMs: 10 * 60 * 1000, mushroomCount: 10, matureCount: 4, diseaseCount: 1 },
  { slot: 'latest', offsetMs: 0, mushroomCount: 12, matureCount: 5, diseaseCount: 1 },
];

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function captureWindow(now = new Date()) {
  const stamp = now.getTime();
  return {
    from: new Date(stamp - WINDOW_BEFORE_MS).toISOString(),
    to: new Date(stamp + WINDOW_AFTER_MS).toISOString(),
  };
}

export function buildCapturePayloads(now = new Date()) {
  const fixture = readFixture(DEMO_FIXTURE);
  const stamp = now.getTime();
  const window = captureWindow(now);
  const points = CAPTURE_POINTS.map((point) => ({
    slot: point.slot,
    body: {
      idempotencyKey: `demo-capture-preview-${point.slot}-${stamp}`,
      shedCode: DEMO_SHED,
      cameraCode: DEMO_CAMERA,
      recognizedAt: new Date(stamp - point.offsetMs).toISOString(),
      mushroomCount: point.mushroomCount,
      matureCount: point.matureCount,
      capDiameters: fixture.body.capDiameters,
      diseaseCount: point.diseaseCount,
      diseaseLevel: fixture.body.diseaseLevel,
      snapshotBase64: fixture.body.snapshotBase64,
      temperature: fixture.body.temperature,
      humidity: fixture.body.humidity,
      co2: fixture.body.co2,
      substrateMoisture: fixture.body.substrateMoisture,
    },
  }));
  return { points, window, stamp };
}

function validateOne(body, now) {
  const parsed = contracts().parseRecognitionIngress(body, now);
  if (!parsed.ok) throw new Error(`样例未通过契约：${parsed.errors.join('；')}`);
  const value = parsed.value;
  if (value.shedCode !== DEMO_SHED) throw new Error(`棚区是 ${value.shedCode}，应为 ${DEMO_SHED}`);
  if (value.cameraCode !== DEMO_CAMERA) {
    throw new Error(`摄像头是 ${value.cameraCode}，应为 ${DEMO_CAMERA}`);
  }
  if (value.diseaseLevel !== 1) throw new Error(`病害等级是 ${value.diseaseLevel}，应为 1`);
  if (value.diseaseCount >= 5) throw new Error('病害数量达到种子规则「病害数量一般」的 5');
  if (value.diseaseLevel >= 2) throw new Error('病害等级达到种子规则「病害等级一般」的 2');
  if (value.mushroomCount > 0 && value.matureCount / value.mushroomCount >= 0.6) {
    throw new Error('成熟占比达到种子规则「成熟占比一般」的 0.6');
  }
  if (value.temperature !== 22.5) throw new Error(`温度是 ${value.temperature}，应为 22.5`);
  if (!value.snapshotBase64) throw new Error('样例缺少 AI抓拍图');
  const bytes = Buffer.from(value.snapshotBase64, 'base64');
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('样例 AI抓拍图 不是 JPEG');
  }
  return value;
}

export function validateCapturePayloads(sample, now = new Date()) {
  if (!Array.isArray(sample.points) || sample.points.length < 3) {
    throw new Error('抓拍对照至少要 3 条');
  }
  const values = sample.points.map((point) => validateOne(point.body, now));
  const times = values.map((value) => new Date(value.recognizedAt).getTime());
  if (new Set(times).size !== times.length) throw new Error('三条识别时间必须不同');
  const counts = values.map((value) => value.mushroomCount);
  if (new Set(counts).size !== counts.length) throw new Error('三条蘑菇数必须不同');
  const from = new Date(sample.window.from).getTime();
  const to = new Date(sample.window.to).getTime();
  for (const at of times) {
    if (at < from || at > to) throw new Error('识别时间不在查询窗口里');
  }
  const fixture = readFixture(DEMO_FIXTURE);
  if (fixture.body.cameraCode !== 'CAM-DEMO-01') throw new Error('样例文件里的摄像头被改掉了');
  if (fixture.body.mushroomCount !== 12) throw new Error('样例文件里的蘑菇数被改掉了');
  if (fixture.body.diseaseCount !== 1) throw new Error('样例文件里的病害数量被改掉了');
  return { points: values, window: sample.window };
}

export function capturePreviewUrl(
  { cameraCode = DEMO_CAMERA, from, to, shedCode = DEMO_SHED } = {},
  webOrigin = webOriginFromEnv(),
) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const params = new URLSearchParams();
  if (shedCode) params.set('shedCode', shedCode);
  if (cameraCode) params.set('cameraCode', cameraCode);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  return `${origin}/capture-preview?${params.toString()}`;
}

export function timelineNote(count) {
  return `原始 · 标注 · 时间轴 ${count} 点`;
}

export function formatCaptureProof({
  points,
  window,
  listedCount,
  webOrigin = webOriginFromEnv(),
}) {
  const rows = Array.isArray(points) ? points : [];
  const lines = [
    `写入 ${rows.length} 条抓拍`,
    `棚区: ${DEMO_SHED}`,
    `摄像头: ${DEMO_CAMERA}`,
    '原始: 抓拍',
    '标注: AI标注',
    timelineNote(listedCount ?? rows.length),
  ];
  for (const row of rows) {
    lines.push(
      `${row.recognizedAt} 蘑菇数 ${row.mushroomCount} 成熟 ${row.matureCount} 病害 ${row.diseaseCount}`,
    );
  }
  lines.push(`开始: ${window.from}`);
  lines.push(`结束: ${window.to}`);
  lines.push('登录: admin / Admin@123456');
  lines.push(
    `打开: ${capturePreviewUrl({ cameraCode: DEMO_CAMERA, from: window.from, to: window.to }, webOrigin)}`,
  );
  lines.push(
    `对照: ${capturePreviewUrl({ cameraCode: CONTRAST_CAMERA, from: window.from, to: window.to }, webOrigin)}`,
  );
  return lines.join('\n');
}

function sameInstant(left, right) {
  const a = new Date(left).getTime();
  const b = new Date(right).getTime();
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1000;
}

function findPoint(items, expected) {
  return (Array.isArray(items) ? items : []).find(
    (item) =>
      item.cameraCode === expected.cameraCode &&
      Number(item.mushroomCount) === Number(expected.mushroomCount) &&
      sameInstant(item.recognizedAt, expected.recognizedAt),
  );
}

export function assertCaptureTimeline(items, payloads) {
  const rows = Array.isArray(items) ? items : [];
  const from = new Date(payloads.window.from).getTime();
  const to = new Date(payloads.window.to).getTime();
  if (rows.length < 3) throw new Error(`时间轴只有 ${rows.length} 点，至少要 3 点`);
  for (const row of rows) {
    if (row.cameraCode !== DEMO_CAMERA) {
      throw new Error(`时间轴里有 ${row.cameraCode}，这次只查 ${DEMO_CAMERA}`);
    }
    const at = new Date(row.recognizedAt).getTime();
    if (at < from || at > to) throw new Error(`时间轴里有窗口外的记录 ${row.recognizedAt}`);
  }
  const found = [];
  for (const expected of payloads.points) {
    const row = findPoint(rows, expected);
    if (!row) throw new Error(`时间轴里没有蘑菇数 ${expected.mushroomCount}`);
    if (!row.snapshotObjectKey) throw new Error(`蘑菇数 ${expected.mushroomCount} 没有可打开的抓拍`);
    found.push(row);
  }
  const times = found.map((row) => new Date(row.recognizedAt).getTime());
  if (new Set(times).size !== found.length) throw new Error('回看的三条识别时间重复');
  return found;
}

export function assertCaptureEmpty(items) {
  const rows = Array.isArray(items) ? items : [];
  if (rows.length !== 0) throw new Error(`对照摄像头仍有 ${rows.length} 条抓拍`);
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

async function readJson(response) {
  return response.json().catch(() => ({}));
}

async function postRecognition(body) {
  let posted;
  try {
    posted = await postJson(ingestRecognitionUrl(), JSON.stringify(body), {
      'content-type': 'application/json',
      'x-ingest-token': ingestToken(),
    });
  } catch (error) {
    throw new Error(`API 连不上（${ingestRecognitionUrl()}）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const payload = posted.responseBody;
  const accepted = flag(payload, 'accepted') === true;
  const id = flag(payload, 'id');
  if (posted.responseStatus < 200 || posted.responseStatus >= 300 || !accepted || !id) {
    throw new Error(`识别报文被拒绝 ${posted.responseStatus} ${messageText(payload)}`);
  }
  if (flag(payload, 'duplicate') === true) throw new Error('这次没有写入新识别');
  if (flag(payload, 'snapshotStored') !== true) {
    throw new Error(
      '识别已入库，但 AI抓拍图没有写入对象存储。先执行 make up，确认对象存储在 127.0.0.1:9000，然后重新 make api。',
    );
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

function listUrl(cameraCode, from, to) {
  const params = new URLSearchParams({
    shedCode: DEMO_SHED,
    cameraCode,
    from,
    to,
    pageSize: '50',
  });
  return `${apiBase()}/ingest/recognitions?${params.toString()}`;
}

async function getJson(token, url) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const body = await readJson(response);
  if (!response.ok) throw new Error(`读取失败 ${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function assertOpenSnapshot(token, id, body) {
  const response = await fetch(snapshotReadUrl(id), {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`抓拍读取失败 ${response.status} ${text}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('对象存储里的抓拍不是 JPEG');
  }
  const expected = Buffer.from(body.snapshotBase64, 'base64');
  if (!bytes.equals(expected)) throw new Error('对象存储里的抓拍与样例 JPEG 不一致');
}

export async function sendDemo({ now = new Date() } = {}) {
  const built = buildCapturePayloads(now);
  const sample = validateCapturePayloads(built, now);
  const posted = [];
  for (const point of built.points) {
    const result = await postRecognition(point.body);
    posted.push({ ...point.body, id: result.id });
  }
  const token = await login();
  const listed = await getJson(token, listUrl(DEMO_CAMERA, sample.window.from, sample.window.to));
  const found = assertCaptureTimeline(listed.items, { points: posted, window: sample.window });
  for (const row of found) {
    const source = posted.find((point) => point.id === row.id);
    await assertOpenSnapshot(token, row.id, source);
  }
  const contrast = await getJson(
    token,
    listUrl(CONTRAST_CAMERA, sample.window.from, sample.window.to),
  );
  assertCaptureEmpty(contrast.items);
  return {
    points: posted,
    window: sample.window,
    listedCount: Array.isArray(listed.items) ? listed.items.length : found.length,
  };
}

function usage() {
  return `用法:
  node scripts/demo-capture-preview.mjs

读取 ${DEMO_FIXTURE}，写入 ${DEMO_CAMERA} 三条抓拍。步骤见 docs/DEMO_CAPTURE_PREVIEW.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const sent = await sendDemo();
    process.stdout.write(`${formatCaptureProof(sent)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
