#!/usr/bin/env node
/**
 * 从设备列表点进 CAM-ALERT-01 的镜头详情。
 * 详情读 GET /devices/:id，相关告警读 GET /alerts?cameraCode=。
 * 没有同标题告警时 POST 一条「镜头详情告警」。不发识别，不发心跳，不改档案。
 */
import { pathToFileURL } from 'node:url';
import { apiBase } from './lib/ingest-wire.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';
import { login } from './demo-register-and-ingest.mjs';
import {
  LIST_CAMERA,
  LIST_SHED,
  ensureListedCamera,
  heartbeatLabel,
  lensCodeOf,
  statusLabel,
} from './demo-camera-list.mjs';

export const DETAIL_TITLE = '镜头详情告警';
export const DETAIL_LEVEL = 'warning';
export const DETAIL_MESSAGE = `棚区 ${LIST_SHED} 摄像头 ${LIST_CAMERA} 镜头详情`;

const LEVEL_LABEL = {
  info: '提示',
  warning: '一般',
  severe: '严重',
};

const STATUS_LABEL = {
  open: '待确认',
  acked: '已确认',
  closed: '已关闭',
};

export function alertBody() {
  return {
    shedCode: LIST_SHED,
    cameraCode: LIST_CAMERA,
    level: DETAIL_LEVEL,
    title: DETAIL_TITLE,
    message: DETAIL_MESSAGE,
  };
}

function messageText(payload) {
  const message = payload?.message ?? payload?.error;
  if (Array.isArray(message)) return message.join('；');
  if (typeof message === 'string') return message;
  return '';
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

function sameValue(left, right) {
  return (left ?? null) === (right ?? null);
}

export function assertDeviceDetail(detail, listed) {
  if (!detail?.id) throw new Error('镜头详情没有 id。');
  if (!listed?.id) throw new Error('设备列表这一行没有 id。');
  if (detail.id !== listed.id) {
    throw new Error(`镜头详情 id 是 ${detail.id}，设备列表是 ${listed.id}。`);
  }
  if (detail.code !== LIST_CAMERA || detail.code !== listed.code) {
    throw new Error(`镜头详情编号是 ${detail.code || '空'}，应为 ${LIST_CAMERA}。`);
  }
  if (lensCodeOf(detail) !== LIST_CAMERA) {
    throw new Error(`镜头详情的类型是 ${detail.type || '空'}，镜头码只标在摄像头上。`);
  }
  if (detail.name !== listed.name) {
    throw new Error(`镜头详情名称是 ${detail.name || '空'}，设备列表是 ${listed.name || '空'}。不改已有档案。`);
  }
  if (typeof detail.name !== 'string' || !detail.name.trim()) {
    throw new Error(`${LIST_CAMERA} 的详情没有名称。`);
  }
  if (detail.shedCode !== listed.shedCode || detail.shedCode !== LIST_SHED) {
    throw new Error(`镜头详情棚区是 ${detail.shedCode || '空'}，应为 ${LIST_SHED}。`);
  }
  if (detail.onlineStatus !== listed.onlineStatus) {
    throw new Error(
      `镜头详情状态是 ${detail.onlineStatus || '空'}，设备列表是 ${listed.onlineStatus || '空'}。`,
    );
  }
  if (detail.onlineStatus !== 'online' && detail.onlineStatus !== 'offline') {
    throw new Error(`${LIST_CAMERA} 的状态是 ${detail.onlineStatus || '空'}，应为在线或离线。`);
  }
  if (!sameValue(detail.note, listed.note)) {
    throw new Error('镜头详情的备注和设备列表不一致。这条命令不改档案。');
  }
  if (!sameValue(detail.lastHeartbeatAt, listed.lastHeartbeatAt) || !sameValue(detail.lastSeenAt, listed.lastSeenAt)) {
    throw new Error('镜头详情的心跳和设备列表不一致。这条命令不发心跳。');
  }
  return detail;
}

export function pickReusableAlert(items) {
  const matches = (Array.isArray(items) ? items : []).filter(
    (row) =>
      row &&
      row.cameraCode === LIST_CAMERA &&
      row.shedCode === LIST_SHED &&
      row.title === DETAIL_TITLE,
  );
  return (
    matches.find((row) => row.status === 'open' || row.status === 'acked') ||
    matches.find((row) => row.status === 'closed') ||
    null
  );
}

export function assertAlertsOnDetail(page, alert) {
  const items = Array.isArray(page?.items) ? page.items : [];
  if (!alert?.id || !items.some((row) => row.id === alert.id)) {
    throw new Error(
      `镜头详情的相关告警里没有 ${alert?.id || '这条告警'}。页面读的是 GET /alerts?cameraCode=${LIST_CAMERA}&pageSize=100。`,
    );
  }
  const other = items.filter((row) => row.cameraCode !== LIST_CAMERA);
  if (other.length) {
    const codes = [...new Set(other.map((row) => row.cameraCode || '（空）'))].join('、');
    throw new Error(`按 ${LIST_CAMERA} 筛选后仍有其他摄像头：${codes}`);
  }
  if (alert.cameraCode !== LIST_CAMERA || alert.shedCode !== LIST_SHED || alert.title !== DETAIL_TITLE) {
    throw new Error(
      `相关告警对不上（摄像头 ${alert.cameraCode || '空'}，棚区 ${alert.shedCode || '空'}，标题 ${alert.title || '空'}）。`,
    );
  }
  if (!alert.message) throw new Error('相关告警没有说明。');
  return alert;
}

export function alertsUrl() {
  const url = new URL(`${apiBase()}/alerts`);
  url.searchParams.set('cameraCode', LIST_CAMERA);
  url.searchParams.set('pageSize', '100');
  return url;
}

async function readDevice(token, id) {
  const url = `${apiBase()}/devices/${encodeURIComponent(id)}`;
  let response;
  try {
    response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  } catch (error) {
    throw new Error(`API 连不上（${url}）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`镜头详情失败 ${response.status} ${messageText(body) || JSON.stringify(body)}`);
  }
  return body;
}

async function listCameraAlerts(token) {
  const url = alertsUrl();
  let response;
  try {
    response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  } catch (error) {
    throw new Error(`API 连不上（${url}）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`相关告警失败 ${response.status} ${messageText(body) || JSON.stringify(body)}`);
  }
  if (!Array.isArray(body.items)) throw new Error('相关告警没有 items。');
  return body;
}

async function createAlert(token) {
  const payload = alertBody();
  let response;
  try {
    response = await fetch(`${apiBase()}/alerts`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new Error(`API 连不上（${apiBase()}/alerts）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const body = await readJson(response);
  if (response.status < 200 || response.status >= 300 || !body.id) {
    throw new Error(`新建告警失败 ${response.status} ${messageText(body) || JSON.stringify(body)}`);
  }
  if (body.status !== 'open' || body.level !== DETAIL_LEVEL || body.message !== DETAIL_MESSAGE) {
    throw new Error(
      `新建的镜头详情告警状态是 ${body.status || '空'}，级别是 ${body.level || '空'}。应为待确认、一般。`,
    );
  }
  return body;
}

async function readAlert(token, id) {
  const url = `${apiBase()}/alerts/${encodeURIComponent(id)}`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`告警详情失败 ${response.status} ${messageText(body) || JSON.stringify(body)}`);
  }
  return assertAlertsOnDetail({ items: [body] }, body);
}

export function formatDetailProof({
  created,
  alertCreated,
  device,
  alert,
  webOrigin = webOriginFromEnv(),
}) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const note = device.note == null || device.note === '' ? '—' : device.note;
  const lines = [
    created ? '登记: 新建' : '登记: 已有，未改档案',
    alertCreated ? '告警: 新建' : '告警: 已有，未改',
    `镜头码: ${lensCodeOf(device)}`,
    `编号: ${device.code}`,
    `名称: ${device.name}`,
    '类型: 摄像头',
    `棚区: ${device.shedCode}`,
    `状态: ${statusLabel(device.onlineStatus)}`,
    `备注: ${note}`,
    `最近心跳: ${heartbeatLabel(device)}`,
    `相关告警: ${alert.title}`,
    `告警 id: ${alert.id}`,
    `告警级别: ${LEVEL_LABEL[alert.level] || alert.level}`,
    `告警状态: ${STATUS_LABEL[alert.status] || alert.status}`,
    `告警说明: ${alert.message}`,
    `设备页: ${origin}/devices`,
    `镜头详情: ${origin}/devices/${encodeURIComponent(device.id)}`,
    `告警详情: ${origin}/alerts/${encodeURIComponent(alert.id)}`,
  ];
  return lines.join('\n');
}

export async function showCameraDetail() {
  const token = await login();
  const listed = await ensureListedCamera(token);
  const detail = assertDeviceDetail(await readDevice(token, listed.device.id), listed.device);
  let page = await listCameraAlerts(token);
  let alert = pickReusableAlert(page.items);
  let alertCreated = false;
  if (!alert) {
    alert = await createAlert(token);
    alertCreated = true;
    page = await listCameraAlerts(token);
  }
  assertAlertsOnDetail(page, alert);
  const alertDetail = await readAlert(token, alert.id);
  return {
    created: listed.created,
    alertCreated,
    device: detail,
    alert: alertDetail,
  };
}

function usage() {
  return `用法:
  node scripts/demo-camera-detail.mjs

先保证 ${LIST_CAMERA} 在设备列表里，再读 GET /devices/:id 和 GET /alerts?cameraCode=${LIST_CAMERA}。不发识别，不发心跳。步骤见 docs/DEMO_CAMERA_DETAIL.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await showCameraDetail();
    process.stdout.write(`${formatDetailProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
