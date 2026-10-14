#!/usr/bin/env node
/**
 * 设备列表同一页能认出一台在线和一台离线。
 * CAM-ON-01 登记后发一条在线心跳；CAM-OFF-01 保持离线（已在线则只改状态）。
 * 核对的是设备页同一份不带 online 的 GET /devices?pageSize=100。
 * 不发识别，不改告警，不改值班看板和已有演示编码。
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { apiBase, ingestToken, postJson, readFixture, repoRoot } from './lib/ingest-wire.mjs';
import { login } from './demo-register-and-ingest.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';
import { listDevices, statusLabel } from './demo-camera-list.mjs';

const require = createRequire(import.meta.url);

export const ONLINE_CAMERA = 'CAM-ON-01';
export const OFFLINE_CAMERA = 'CAM-OFF-01';
export const DEVICE_SHED = 'S01';
export const ONLINE_NAME = '列表在线镜头';
export const OFFLINE_NAME = '列表离线镜头';
export const ONLINE_NOTE = '设备列表在线';
export const OFFLINE_NOTE = '设备列表离线';
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
    throw new Error('心跳 online 不是 true，这一行不会显示在线');
  }
  if (value.shedCode !== DEVICE_SHED) {
    throw new Error(`心跳棚区是 ${value.shedCode}，应为 ${DEVICE_SHED}`);
  }
  if (value.deviceCode === 'EDGE-SIM-BOX' || value.deviceType === 'ai_box') {
    throw new Error('心跳仍是夹具里的 EDGE-SIM-BOX。本命令只改本次请求，不改 heartbeat.http.json。');
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

export function assertFreshCamera(device, { created, kind }) {
  const body = deviceBody(kind);
  if (!device) {
    throw new Error(
      `设备列表里没有 ${body.code}。打开 /devices，在编号一列找这一台。`,
    );
  }
  if (!device.id) throw new Error(`${body.code} 这一行没有 id。`);
  if (device.code !== body.code || device.type !== 'camera') {
    throw new Error(`${body.code} 的类型是 ${device.type || '空'}，设备页状态列标在这一行上。`);
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

export function assertDeviceOnlinePair(items) {
  const online = findCode(items, ONLINE_CAMERA);
  const offline = findCode(items, OFFLINE_CAMERA);
  if (!online) {
    throw new Error(
      `不带筛选的设备列表里没有 ${ONLINE_CAMERA}。打开 /devices，状态列应有一行「在线」。`,
    );
  }
  if (!offline) {
    throw new Error(
      `不带筛选的设备列表里没有 ${OFFLINE_CAMERA}。打开 /devices，状态列应有一行「离线」。`,
    );
  }
  if (online.onlineStatus !== 'online') {
    throw new Error(
      `${ONLINE_CAMERA} 的 onlineStatus 是 ${online.onlineStatus || '空'}，应为 online。设备页这一行应写「在线」。`,
    );
  }
  if (!online.lastHeartbeatAt) {
    throw new Error(`${ONLINE_CAMERA} 没有最近心跳。这条命令发过一次在线心跳。`);
  }
  if (offline.onlineStatus !== 'offline') {
    throw new Error(
      `${OFFLINE_CAMERA} 的 onlineStatus 是 ${offline.onlineStatus || '空'}，应为 offline。设备页这一行应写「离线」。`,
    );
  }
  if (online.type !== 'camera' || offline.type !== 'camera') {
    throw new Error('在线行或离线行不是摄像头。');
  }
  if (online.shedCode !== DEVICE_SHED || offline.shedCode !== DEVICE_SHED) {
    throw new Error(`这两行应在棚区 ${DEVICE_SHED}。`);
  }
  return { online, offline };
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
  const accepted = payload?.accepted === true || payload?.message?.accepted === true;
  if (posted.responseStatus < 200 || posted.responseStatus >= 300 || !accepted) {
    throw new Error(`心跳被拒绝 ${posted.responseStatus} ${messageText(payload) || JSON.stringify(payload)}`);
  }
  const code = payload?.code ?? payload?.message?.code;
  if (code && code !== ONLINE_CAMERA) {
    throw new Error(`心跳写入的设备编号是 ${code}，应为 ${ONLINE_CAMERA}`);
  }
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

export function formatDeviceOnlineProof(result, webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const lines = [
    result.onlineCreated
      ? `登记 ${ONLINE_CAMERA}: 新建`
      : `登记 ${ONLINE_CAMERA}: 已有，未改档案`,
    '心跳: 已写入',
    result.offlineCreated
      ? `登记 ${OFFLINE_CAMERA}: 新建`
      : `登记 ${OFFLINE_CAMERA}: 已有，未改档案`,
    result.patchedOffline ? '离线: 已改状态' : '离线: 本来就是离线',
    `在线行: ${ONLINE_CAMERA} ${statusLabel(result.online.onlineStatus)}`,
    `离线行: ${OFFLINE_CAMERA} ${statusLabel(result.offline.onlineStatus)}`,
    `在线 onlineStatus: ${result.online.onlineStatus}`,
    `离线 onlineStatus: ${result.offline.onlineStatus}`,
    `设备页: ${origin}/devices`,
  ];
  return lines.join('\n');
}

export async function showDeviceOnline({ now = new Date() } = {}) {
  const token = await login();
  const onlineReg = await registerCamera(token, 'online');
  const beat = buildOnlineHeartbeat(now);
  validateOnlineHeartbeat(beat);
  await postOnlineHeartbeat(beat);
  const offlineReg = await registerCamera(token, 'offline');
  const offlineMarked = await markOffline(token, offlineReg.device);
  const pair = assertDeviceOnlinePair(await listDevices(token));
  return {
    onlineCreated: onlineReg.created,
    offlineCreated: offlineReg.created,
    patchedOffline: offlineMarked.patched,
    online: pair.online,
    offline: pair.offline,
  };
}

function usage() {
  return `用法:
  node scripts/demo-device-online.mjs

登记 ${ONLINE_CAMERA} 并 POST 一次在线心跳，保证 ${OFFLINE_CAMERA} 离线。
再读不带 online 的 GET /devices?pageSize=100，两行的 onlineStatus 必须分别是 online 与 offline。
不发识别，不改告警。步骤见 docs/DEMO_DEVICE_ONLINE.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await showDeviceOnline();
    process.stdout.write(`${formatDeviceOnlineProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
