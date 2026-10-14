#!/usr/bin/env node
/**
 * 发一条带样例 JPEG 的温度过高识别。对象写入 MinIO，告警记下对象键。
 * 再读 GET /api/v1/alerts/:id/snapshot，字节须与样例 JPEG 一致。
 * 样例文件 recognition.demo-one.json 不改。摄像头编号用 CAM-SNAP-01。
 */
import { pathToFileURL } from 'node:url';
import {
  apiBase,
  ingestRecognitionUrl,
  ingestToken,
  postJson,
} from './lib/ingest-wire.mjs';
import {
  buildDemoPayload,
  validateDemoPayload,
  webOriginFromEnv,
} from './demo-one-http-recognition.mjs';

export const SNAP_CAMERA = 'CAM-SNAP-01';
export const SNAP_SHED = 'S01';
export const SNAP_TEMPERATURE = 30;
export const SNAP_THRESHOLD = 28;
export const SNAP_TITLE = '温度过高告警';

export function buildSnapshotRecognition(now = new Date()) {
  const body = buildDemoPayload(now);
  body.cameraCode = SNAP_CAMERA;
  body.shedCode = SNAP_SHED;
  body.temperature = SNAP_TEMPERATURE;
  body.idempotencyKey = `demo-snap-${now.getTime()}`;
  return body;
}

export function isSnapshotAlert(row) {
  return Boolean(
    row &&
      row.shedCode === SNAP_SHED &&
      row.cameraCode === SNAP_CAMERA &&
      row.metric === 'temperature_high' &&
      (row.status === 'open' || row.status === 'acked'),
  );
}

function messageText(payload) {
  const message = payload?.message ?? payload?.error;
  if (Array.isArray(message)) return message.join('；');
  if (typeof message === 'string') return message;
  return '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function readJson(response) {
  return response.json().catch(() => ({}));
}

async function listByStatus(token, status) {
  const url =
    `${apiBase()}/alerts?shedCode=${encodeURIComponent(SNAP_SHED)}` +
    `&cameraCode=${encodeURIComponent(SNAP_CAMERA)}` +
    `&status=${encodeURIComponent(status)}&pageSize=100`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`告警列表失败 ${response.status} ${messageText(body) || JSON.stringify(body)}`);
  }
  return Array.isArray(body.items) ? body.items : [];
}

async function listSnapshotAlerts(token) {
  const [open, acked] = await Promise.all([
    listByStatus(token, 'open'),
    listByStatus(token, 'acked'),
  ]);
  const byId = new Map();
  for (const row of [...open, ...acked]) {
    if (isSnapshotAlert(row)) byId.set(row.id, row);
  }
  return [...byId.values()].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  );
}

function rejectText(responseBody) {
  const inner =
    responseBody && typeof responseBody.message === 'object' ? responseBody.message : responseBody;
  const errors = inner?.errors || responseBody?.errors;
  const code = inner?.code || responseBody?.code;
  const list = Array.isArray(errors) ? errors.join('；') : JSON.stringify(responseBody);
  return code ? `${code} ${list}` : list;
}

function nestedFlag(payload, key) {
  return payload?.[key] === true || payload?.message?.[key] === true;
}

async function postRecognition(body) {
  let posted;
  try {
    posted = await postJson(ingestRecognitionUrl(), JSON.stringify(body), {
      'content-type': 'application/json',
      'x-ingest-token': ingestToken(),
    });
  } catch (error) {
    throw new Error(
      `API 连不上（${ingestRecognitionUrl()}）。先执行 make up、make migrate、make api。${error.message}`,
    );
  }
  const payload = posted.responseBody;
  const accepted = payload?.accepted === true || payload?.message?.accepted === true;
  const id = payload?.id || payload?.message?.id;
  if (posted.responseStatus < 200 || posted.responseStatus >= 300 || !accepted || !id) {
    throw new Error(`接入拒绝 ${posted.responseStatus} ${rejectText(payload)}`);
  }
  if (!nestedFlag(payload, 'snapshotStored')) {
    throw new Error(
      '识别已入库，但 AI抓拍图没有写入对象存储。先执行 make up，确认对象存储在 127.0.0.1:9000，然后重新 make api。',
    );
  }
  return { id, duplicate: Boolean(payload?.duplicate || payload?.message?.duplicate) };
}

export async function readAlert(token, id) {
  const response = await fetch(`${apiBase()}/alerts/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`告警详情失败 ${response.status} ${messageText(body) || JSON.stringify(body)}`);
  }
  return body;
}

export function alertSnapshotUrl(id) {
  return `${apiBase()}/alerts/${encodeURIComponent(id)}/snapshot`;
}

export function alertDetailUrl(id, webOrigin = webOriginFromEnv()) {
  return `${String(webOrigin).replace(/\/$/, '')}/alerts/${encodeURIComponent(id)}`;
}

export function assertSnapshotDetail(detail) {
  const missing = [];
  if (detail?.title !== SNAP_TITLE) missing.push('标题');
  if (detail?.shedCode !== SNAP_SHED) missing.push('棚区');
  if (detail?.cameraCode !== SNAP_CAMERA) missing.push('摄像头');
  if (detail?.metric !== 'temperature_high') missing.push('指标');
  if (!detail?.id) missing.push('告警 id');
  const key = typeof detail?.snapshotObjectKey === 'string' ? detail.snapshotObjectKey.trim() : '';
  if (!key) missing.push('抓拍对象键');
  if (key && (!key.startsWith(`snapshots/${SNAP_SHED}/`) || !key.includes(`/${SNAP_CAMERA}/`) || !key.endsWith('.jpg'))) {
    throw new Error(`抓拍对象键不符合棚/日/摄像头布局：${key}`);
  }
  if (missing.length) throw new Error(`告警详情缺少${missing.join('、')}`);
  return key;
}

async function readSnapshot(token, id, body) {
  const url = alertSnapshotUrl(id);
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`告警抓拍读取失败 ${response.status} ${text}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('对象存储里的告警抓拍不是 JPEG');
  }
  const expected = Buffer.from(body.snapshotBase64, 'base64');
  if (!bytes.equals(expected)) throw new Error('对象存储里的告警抓拍与样例 JPEG 不一致');
  return { bytes, url };
}

function newest(rows) {
  return [...rows].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  )[0];
}

async function findAlert(token, beforeIds) {
  const deadline = Date.now() + 3_000;
  let last = [];
  while (Date.now() <= deadline) {
    last = await listSnapshotAlerts(token);
    const fresh = last.filter((row) => !beforeIds.has(row.id));
    if (fresh.length) return { row: newest(fresh), created: true };
    if (last.length) return { row: newest(last), created: false };
    if (Date.now() + 400 > deadline) break;
    await sleep(400);
  }
  throw new Error(
    `告警列表里没有棚区 ${SNAP_SHED} 摄像头 ${SNAP_CAMERA} 的未闭合温度过高告警。` +
      `确认种子规则「温度过高」已启用，阈值 ${SNAP_THRESHOLD}。`,
  );
}

export function formatSnapshotProof({
  recognitionId,
  created,
  detail,
  snapshotObjectKey,
  snapshotReadUrl,
  webOrigin = webOriginFromEnv(),
}) {
  const lines = [
    '发了 1 条带抓拍的识别',
    `识别 id: ${recognitionId}`,
    `棚区: ${SNAP_SHED}`,
    `摄像头编号: ${SNAP_CAMERA}`,
    `环境温度: ${SNAP_TEMPERATURE}`,
    created ? '告警: 新建' : '告警: 沿用未闭合',
    `告警 id: ${detail.id}`,
    `标题: ${detail.title}`,
    `抓拍对象键: ${snapshotObjectKey}`,
    `告警抓拍: ${snapshotReadUrl}`,
    '登录: admin / Admin@123456',
    `告警详情: ${alertDetailUrl(detail.id, webOrigin)}`,
  ];
  return lines.join('\n');
}

export async function sendSnapshotAlertDemo({ now = new Date() } = {}) {
  const body = buildSnapshotRecognition(now);
  validateDemoPayload(body, now);
  if (body.cameraCode !== SNAP_CAMERA) {
    throw new Error(`这次识别的摄像头编号是 ${body.cameraCode}，应为 ${SNAP_CAMERA}`);
  }
  if (!body.snapshotBase64) throw new Error('样例没有 AI抓拍图');
  const token = await login();
  const before = await listSnapshotAlerts(token);
  const beforeIds = new Set(before.map((row) => row.id));
  const posted = await postRecognition(body);
  const found = await findAlert(token, beforeIds);
  const detail = await readAlert(token, found.row.id);
  const snapshotObjectKey = assertSnapshotDetail(detail);
  const snapshot = await readSnapshot(token, detail.id, body);
  return {
    recognitionId: posted.id,
    created: found.created,
    detail,
    body,
    snapshotObjectKey,
    snapshotReadUrl: snapshot.url,
  };
}

function usage() {
  return `用法:
  node scripts/demo-alert-snapshot-minio.mjs

POST 一次识别（摄像头 ${SNAP_CAMERA}，温度 ${SNAP_TEMPERATURE}℃，样例 JPEG）。步骤见 docs/DEMO_ALERT_SNAPSHOT_MINIO.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await sendSnapshotAlertDemo();
    process.stdout.write(`${formatSnapshotProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
