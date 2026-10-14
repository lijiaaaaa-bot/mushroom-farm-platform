#!/usr/bin/env node
/**
 * 设备详情页能单独看出一台在线（最近心跳有时间）和一台离线。
 * 截图地址是 /devices/<id>，不是设备列表。
 * CAM-DTL-ON 登记后发一条在线心跳；CAM-DTL-OFF 保持离线（已在线则只改状态）。
 * 核对的是 GET /devices/:id。不发识别，不新建告警，不改已有演示编码。
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { apiBase, ingestToken, postJson, readFixture, repoRoot } from './lib/ingest-wire.mjs';
import { login } from './demo-register-and-ingest.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';
import { heartbeatLabel, listDevices, statusLabel } from './demo-camera-list.mjs';

const require = createRequire(import.meta.url);

export const ONLINE_CAMERA = 'CAM-DTL-ON';
export const OFFLINE_CAMERA = 'CAM-DTL-OFF';
export const DEVICE_SHED = 'S01';
export const ONLINE_NAME = '详情在线镜头';
export const OFFLINE_NAME = '详情离线镜头';
export const ONLINE_NOTE = '设备详情在线';
export const OFFLINE_NOTE = '设备详情离线';
export const HEARTBEAT_FIXTURE = 'heartbeat.http.json';

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function deviceBody(kind) {
  if (kind === 'offline') {
    return {
      code: OFFLINE_CAMERA,
      name: OFFLINE_NAME,
      type: 'camera',
      shedCode: DEVICE_SHED,
      note: OFFLINE_NOTE,
    };
  }
  return {
    code: ONLINE_CAMERA,
    name: ONLINE_NAME,
    type: 'camera',
    shedCode: DEVICE_SHED,
    note: ONLINE_NOTE,
  };
}

export function offlinePatchBody() {
  return { onlineStatus: 'offline' };
}

export function buildOnlineHeartbeat(now = new Date()) {
  const fixture = readFixture(HEARTBEAT_FIXTURE);
  return {
    ...fixture.body,
    shedCode: DEVICE_SHED,
    deviceCode: ONLINE_CAMERA,
    deviceType: 'camera',
    online: true,
    reportedAt: now.toISOString(),
  };
}

export function validateOnlineHeartbeat(body) {
  const parsed = contracts().parseHeartbeatIngress(body);
  if (!parsed.ok) {
    throw new Error(`心跳未通过契约：${parsed.errors.join('；')}`);
  }
  const value = parsed.value;
  if (value.deviceCode !== ONLINE_CAMERA) {
    throw new Error(`心跳设备编号是 ${value.deviceCode}，应为 ${ONLINE_CAMERA}`);
  }
  if (value.deviceType !== 'camera') {
    throw new Error(`心跳设备类型是 ${value.deviceType || '空'}，应为摄像头`);
  }
  if (value.online !== true) {
    throw new Error('心跳 online 不是 true，详情页不会显示在线');
  }
  if (value.shedCode !== DEVICE_SHED) {
    throw new Error(`心跳棚区是 ${value.shedCode}，应为 ${DEVICE_SHED}`);
  }
  if (value.deviceCode === 'EDGE-SIM-BOX' || value.deviceType === 'ai_box') {
    throw new Error('心跳仍是夹具里的 EDGE-SIM-BOX。本命令只改本次请求，不改 heartbeat.http.json。');
  }
  if (value.deviceCode === 'CAM-ON-01' || value.deviceCode === 'CAM-ALERT-01' || value.deviceCode === OFFLINE_CAMERA) {
    throw new Error(`心跳设备编号不应是 ${value.deviceCode}。详情在线用 ${ONLINE_CAMERA}。`);
  }
  return value;
}

function messageText(payload) {
  const inner = payload && typeof payload.message === 'object' ? payload.message : payload;
  const message = inner?.message ?? payload?.message ?? payload?.error;
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

function authHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
}

function findCode(items, code) {
  return (Array.isArray(items) ? items : []).find((row) => row && row.code === code) ?? null;
}

function sameInstant(left, right) {
  const a = new Date(left).getTime();
  const b = new Date(right).getTime();
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1000;
}

export function assertFreshCamera(device, { created, kind }) {
  const body = deviceBody(kind);
  if (!device) {
    throw new Error(`设备列表里没有 ${body.code}。详情页地址要用这一行的 id。`);
  }
  if (!device.id) throw new Error(`${body.code} 这一行没有 id，打不开 /devices/<id>。`);
  if (device.code !== body.code || device.type !== 'camera') {
    throw new Error(`${body.code} 的类型是 ${device.type || '空'}，镜头详情只给摄像头。`);
  }
  if (device.shedCode !== DEVICE_SHED) {
    throw new Error(`${body.code} 在棚区 ${device.shedCode || '空'}。这一刀用的是 ${DEVICE_SHED}。`);
  }
  if (device.onlineStatus !== 'online' && device.onlineStatus !== 'offline') {
    throw new Error(`${body.code} 的状态是 ${device.onlineStatus || '空'}，应为在线或离线。`);
  }
  if (created) {
    if (device.name !== body.name || device.note !== body.note) {
      throw new Error(
        `新建的 ${body.code} 名称或备注与登记请求不一致（名称 ${device.name}，备注 ${device.note ?? '—'}）。`,
      );
    }
    if (device.onlineStatus !== 'offline' || device.lastHeartbeatAt || device.lastSeenAt) {
      throw new Error(`新建的 ${body.code} 应是离线，且还没有心跳。在线由随后的心跳写入。`);
    }
  }
  return device;
}

export function assertOnlineDetail(detail, { reportedAt, duplicate }) {
  if (!detail?.id) throw new Error(`${ONLINE_CAMERA} 的详情没有 id。`);
  if (detail.code !== ONLINE_CAMERA || detail.type !== 'camera') {
    throw new Error(`在线详情编号是 ${detail.code || '空'}，类型是 ${detail.type || '空'}。应为 ${ONLINE_CAMERA} 摄像头。`);
  }
  if (detail.shedCode !== DEVICE_SHED) {
    throw new Error(`在线详情棚区是 ${detail.shedCode || '空'}，应为 ${DEVICE_SHED}。`);
  }
  if (detail.onlineStatus !== 'online') {
    throw new Error(
      `${ONLINE_CAMERA} 的详情状态是 ${detail.onlineStatus || '空'}，不是在线。打开 /devices/${detail.id} 应看到「在线」。`,
    );
  }
  if (!detail.lastHeartbeatAt) {
    throw new Error(
      `${ONLINE_CAMERA} 的详情没有最近心跳。页面「最近心跳」会是「—」。这条命令发过一次在线心跳。`,
    );
  }
  if (!duplicate && !sameInstant(detail.lastHeartbeatAt, reportedAt)) {
    throw new Error(`详情的最近心跳 ${detail.lastHeartbeatAt} 不是这次的 ${reportedAt}`);
  }
  if (duplicate) {
    const listed = new Date(detail.lastHeartbeatAt).getTime();
    const sent = new Date(reportedAt).getTime();
    if (!Number.isFinite(listed) || listed + 1000 < sent) {
      throw new Error(`重复心跳后，详情里的最近心跳 ${detail.lastHeartbeatAt} 早于这次的 ${reportedAt}`);
    }
  }
  if (heartbeatLabel(detail) === '—') {
    throw new Error(`${ONLINE_CAMERA} 的详情最近心跳仍是「—」。`);
  }
  return detail;
}

export function assertOfflineDetail(detail) {
  if (!detail?.id) throw new Error(`${OFFLINE_CAMERA} 的详情没有 id。`);
  if (detail.code !== OFFLINE_CAMERA || detail.type !== 'camera') {
    throw new Error(`离线详情编号是 ${detail.code || '空'}，类型是 ${detail.type || '空'}。应为 ${OFFLINE_CAMERA} 摄像头。`);
  }
  if (detail.shedCode !== DEVICE_SHED) {
    throw new Error(`离线详情棚区是 ${detail.shedCode || '空'}，应为 ${DEVICE_SHED}。`);
  }
  if (detail.onlineStatus !== 'offline') {
    throw new Error(
      `${OFFLINE_CAMERA} 的详情状态是 ${detail.onlineStatus || '空'}，不是离线。打开 /devices/${detail.id} 应看到「离线」。`,
    );
  }
  const label = heartbeatLabel(detail);
  if (label !== '—' && !detail.lastHeartbeatAt && !detail.lastSeenAt) {
    throw new Error(`${OFFLINE_CAMERA} 的最近心跳对不上（${label}）。`);
  }
  return detail;
}

async function registerCamera(token, kind) {
  const body = deviceBody(kind);
  let response;
  try {
    response = await fetch(`${apiBase()}/devices`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`API 连不上（${apiBase()}/devices）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const payload = await readJson(response);
  const created = response.status === 201;
  const already = response.status === 409 && messageText(payload).includes('设备编码已存在');
  if (!created && !already) {
    throw new Error(`登记 ${body.code} 失败 ${response.status} ${messageText(payload) || JSON.stringify(payload)}`);
  }
  const device = assertFreshCamera(findCode(await listDevices(token), body.code), { created, kind });
  return { created, device };
}

async function postOnlineHeartbeat(body) {
  const url = `${apiBase()}/ingest/heartbeat`;
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
  if (posted.responseStatus < 200 || posted.responseStatus >= 300 || !accepted) {
    throw new Error(`心跳被拒绝 ${posted.responseStatus} ${messageText(payload) || JSON.stringify(payload)}`);
  }
  const code = flag(payload, 'code');
  if (code && code !== ONLINE_CAMERA) {
    throw new Error(`心跳写入的设备编号是 ${code}，应为 ${ONLINE_CAMERA}`);
  }
  return {
    duplicate: flag(payload, 'duplicate') === true,
    reportedAt: body.reportedAt,
  };
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
    throw new Error(`设备详情失败 ${response.status} ${messageText(body) || JSON.stringify(body)}`);
  }
  return body;
}

async function markOffline(token, device) {
  if (device.onlineStatus === 'offline') return { patched: false };
  let response;
  try {
    response = await fetch(`${apiBase()}/devices/${encodeURIComponent(device.id)}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify(offlinePatchBody()),
    });
  } catch (error) {
    throw new Error(`API 连不上。先执行 make up、make migrate、make api。${error.message}`);
  }
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(`改离线失败 ${response.status} ${messageText(payload) || JSON.stringify(payload)}`);
  }
  return { patched: true };
}

export function formatDeviceDetailProof(result, webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const offlineBeat = heartbeatLabel(result.offline);
  const lines = [
    result.onlineCreated
      ? `登记 ${ONLINE_CAMERA}: 新建`
      : `登记 ${ONLINE_CAMERA}: 已有，未改档案`,
    '心跳: 已写入',
    result.duplicate ? '重复: 是' : '重复: 否',
    result.offlineCreated
      ? `登记 ${OFFLINE_CAMERA}: 新建`
      : `登记 ${OFFLINE_CAMERA}: 已有，未改档案`,
    result.patchedOffline ? '离线: 已改状态' : '离线: 本来就是离线',
    `在线编号: ${ONLINE_CAMERA}`,
    `在线名称: ${result.online.name}`,
    `在线状态: ${statusLabel(result.online.onlineStatus)}`,
    `在线最近心跳: ${result.online.lastHeartbeatAt}`,
    `离线编号: ${OFFLINE_CAMERA}`,
    `离线名称: ${result.offline.name}`,
    `离线状态: ${statusLabel(result.offline.onlineStatus)}`,
    `离线最近心跳: ${offlineBeat}`,
    offlineBeat === '—'
      ? '离线心跳: 无心跳，页面写「—」'
      : '离线心跳: 状态已是离线，最近心跳留着上次时间',
    `在线详情: ${origin}/devices/${encodeURIComponent(result.online.id)}`,
    `离线详情: ${origin}/devices/${encodeURIComponent(result.offline.id)}`,
  ];
  return lines.join('\n');
}

export async function showDeviceDetail({ now = new Date() } = {}) {
  const token = await login();
  const onlineReg = await registerCamera(token, 'online');
  const beatBody = buildOnlineHeartbeat(now);
  validateOnlineHeartbeat(beatBody);
  const beat = await postOnlineHeartbeat(beatBody);
  const online = assertOnlineDetail(await readDevice(token, onlineReg.device.id), beat);
  const offlineReg = await registerCamera(token, 'offline');
  const offlineMarked = await markOffline(token, offlineReg.device);
  const offline = assertOfflineDetail(await readDevice(token, offlineReg.device.id));
  if (online.id === offline.id) {
    throw new Error('在线和离线详情是同一个 id。');
  }
  return {
    onlineCreated: onlineReg.created,
    offlineCreated: offlineReg.created,
    patchedOffline: offlineMarked.patched,
    duplicate: beat.duplicate,
    online,
    offline,
  };
}

function usage() {
  return `用法:
  node scripts/demo-device-detail.mjs

登记 ${ONLINE_CAMERA} 并 POST 一次在线心跳，保证 ${OFFLINE_CAMERA} 离线。
再读 GET /devices/:id。在线详情的 onlineStatus 是 online 且 lastHeartbeatAt 有值；
离线详情的 onlineStatus 是 offline，最近心跳为空时页面写「—」，已有心跳则留着上次时间。
不发识别，不新建告警。步骤见 docs/DEMO_DEVICE_DETAIL.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await showDeviceDetail();
    process.stdout.write(`${formatDeviceDetailProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
