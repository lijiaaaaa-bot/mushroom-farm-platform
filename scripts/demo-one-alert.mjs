#!/usr/bin/env node
/**
 * 发一条温度 30℃ 的识别。种子规则「温度过高」阈值 28、级别严重，
 * 识别入库后留下一条未闭合告警。同一摄像头已有未闭合的温度过高告警时不再新建。
 * 样例文件 recognition.demo-one.json 不改，摄像头编号用 CAM-ALERT-01。
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  apiBase,
  ingestRecognitionUrl,
  ingestToken,
  postJson,
  repoRoot,
} from './lib/ingest-wire.mjs';
import {
  buildDemoPayload,
  validateDemoPayload,
  webOriginFromEnv,
} from './demo-one-http-recognition.mjs';

const require = createRequire(import.meta.url);

export const ALERT_CAMERA = 'CAM-ALERT-01';
export const ALERT_SHED = 'S01';
export const ALERT_TEMPERATURE = 30;
export const ALERT_THRESHOLD = 28;
export const ALERT_TITLE = '温度过高告警';

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function buildAlertRecognition(now = new Date()) {
  const body = buildDemoPayload(now);
  body.cameraCode = ALERT_CAMERA;
  body.shedCode = ALERT_SHED;
  body.temperature = ALERT_TEMPERATURE;
  body.idempotencyKey = `demo-alert-${now.getTime()}`;
  return body;
}

export function isTemperatureAlert(row) {
  return Boolean(
    row &&
      row.shedCode === ALERT_SHED &&
      row.cameraCode === ALERT_CAMERA &&
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
    `${apiBase()}/alerts?shedCode=${encodeURIComponent(ALERT_SHED)}` +
    `&status=${encodeURIComponent(status)}&pageSize=100`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`告警列表失败 ${response.status} ${messageText(body) || JSON.stringify(body)}`);
  }
  return Array.isArray(body.items) ? body.items : [];
}

export async function listTemperatureAlerts(token) {
  const [open, acked] = await Promise.all([
    listByStatus(token, 'open'),
    listByStatus(token, 'acked'),
  ]);
  const byId = new Map();
  for (const row of [...open, ...acked]) {
    if (isTemperatureAlert(row)) byId.set(row.id, row);
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

export function assertAlertDetail(detail, { created }) {
  const missing = [];
  if (detail?.title !== ALERT_TITLE) missing.push('标题');
  if (detail?.shedCode !== ALERT_SHED) missing.push('棚区');
  if (detail?.cameraCode !== ALERT_CAMERA) missing.push('摄像头');
  if (detail?.level !== 'severe') missing.push('级别');
  if (detail?.status !== 'open' && detail?.status !== 'acked') missing.push('状态');
  if (detail?.metric !== 'temperature_high') missing.push('指标');
  if (!Number.isFinite(Number(detail?.metricValue))) missing.push('当前值');
  if (!Number.isFinite(Number(detail?.threshold))) missing.push('阈值');
  if (!detail?.createdAt) missing.push('时间');
  const message = String(detail?.message || '');
  if (!message.includes(`棚区 ${ALERT_SHED}`)) missing.push('说明里的棚区');
  if (!message.includes(`摄像头 ${ALERT_CAMERA}`)) missing.push('说明里的摄像头');
  if (!message.includes('温度过高')) missing.push('说明里的指标');
  if (!message.includes('阈值')) missing.push('说明里的阈值');
  if (missing.length) throw new Error(`告警详情缺少${missing.join('、')}`);
  if (created) {
    if (Math.abs(Number(detail.metricValue) - ALERT_TEMPERATURE) > 1e-6) {
      throw new Error(`新建告警的当前值是 ${detail.metricValue}，这条识别的温度是 ${ALERT_TEMPERATURE}`);
    }
    if (Math.abs(Number(detail.threshold) - ALERT_THRESHOLD) > 1e-6) {
      throw new Error(
        `温度过高规则阈值是 ${detail.threshold}，演示报文温度是 ${ALERT_TEMPERATURE}。种子规则阈值应为 ${ALERT_THRESHOLD}。`,
      );
    }
  }
  return detail;
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
    last = await listTemperatureAlerts(token);
    const fresh = last.filter((row) => !beforeIds.has(row.id));
    if (fresh.length) return { row: newest(fresh), created: true };
    if (last.length) return { row: newest(last), created: false };
    if (Date.now() + 400 > deadline) break;
    await sleep(400);
  }
  throw new Error(
    `告警列表里没有棚区 ${ALERT_SHED} 摄像头 ${ALERT_CAMERA} 的未闭合温度过高告警。` +
      `确认种子规则「温度过高」已启用，阈值 ${ALERT_THRESHOLD}。`,
  );
}

export function alertListUrl(webOrigin = webOriginFromEnv()) {
  return `${String(webOrigin).replace(/\/$/, '')}/alerts`;
}

export function alertDetailUrl(id, webOrigin = webOriginFromEnv()) {
  return `${String(webOrigin).replace(/\/$/, '')}/alerts/${encodeURIComponent(id)}`;
}

export function formatAlertProof({
  recognitionId,
  created,
  detail,
  webOrigin = webOriginFromEnv(),
}) {
  const labels = contracts();
  const lines = [
    '发了 1 条识别',
    `识别 id: ${recognitionId}`,
    `棚区: ${ALERT_SHED}`,
    `摄像头编号: ${ALERT_CAMERA}`,
    `环境温度: ${ALERT_TEMPERATURE}`,
    created ? '告警: 新建' : '告警: 沿用未闭合',
    `告警 id: ${detail.id}`,
    `标题: ${detail.title}`,
    `说明: ${detail.message}`,
    `级别: ${labels.ALERT_LEVEL_LABEL[detail.level] || detail.level}`,
    `状态: ${labels.ALERT_STATUS_LABEL[detail.status] || detail.status}`,
    `当前值: ${detail.metricValue}`,
    `阈值: ${detail.threshold}`,
    '登录: admin / Admin@123456',
    `告警列表: ${alertListUrl(webOrigin)}`,
    `告警详情: ${alertDetailUrl(detail.id, webOrigin)}`,
  ];
  return lines.join('\n');
}

export async function sendAlertDemo({ now = new Date() } = {}) {
  const body = buildAlertRecognition(now);
  validateDemoPayload(body, now);
  if (body.cameraCode !== ALERT_CAMERA) {
    throw new Error(`这次识别的摄像头编号是 ${body.cameraCode}，应为 ${ALERT_CAMERA}`);
  }
  if (body.temperature !== ALERT_TEMPERATURE) {
    throw new Error(`这次识别的温度是 ${body.temperature}，应为 ${ALERT_TEMPERATURE}`);
  }
  const token = await login();
  const before = await listTemperatureAlerts(token);
  const beforeIds = new Set(before.map((row) => row.id));
  const posted = await postRecognition(body);
  const found = await findAlert(token, beforeIds);
  const detail = assertAlertDetail(await readAlert(token, found.row.id), { created: found.created });
  return {
    recognitionId: posted.id,
    created: found.created,
    detail,
    body,
  };
}

function usage() {
  return `用法:
  node scripts/demo-one-alert.mjs

POST 一次识别（摄像头 ${ALERT_CAMERA}，温度 ${ALERT_TEMPERATURE}℃）。步骤见 docs/DEMO_ONE_ALERT.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await sendAlertDemo();
    process.stdout.write(`${formatAlertProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
