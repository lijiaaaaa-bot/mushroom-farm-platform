#!/usr/bin/env node
/**
 * 设备列表按在线 / 离线筛选。
 * CAM-FLST-ON 登记后发一条在线心跳；CAM-FLST-OFF 保持离线（已在线则只改状态）。
 * GET /devices?pageSize=100&online=online 含前者、不含后者，且每一行都是 online。
 * GET /devices?pageSize=100&online=offline 含后者、不含前者，且每一行都是 offline。
 * 不发识别，不改告警，不改 CAM-ON-01 / CAM-OFF-01 与 CAM-DTL-ON / CAM-DTL-OFF。
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { apiBase, ingestToken, postJson, readFixture, repoRoot } from './lib/ingest-wire.mjs';
import { login } from './demo-register-and-ingest.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';
import { statusLabel } from './demo-camera-list.mjs';

const require = createRequire(import.meta.url);

export const ONLINE_CAMERA = 'CAM-FLST-ON';
export const OFFLINE_CAMERA = 'CAM-FLST-OFF';
export const DEVICE_SHED = 'S01';
export const ONLINE_NAME = '筛选在线镜头';
export const OFFLINE_NAME = '筛选离线镜头';
export const ONLINE_NOTE = '列表筛选在线';
export const OFFLINE_NOTE = '列表筛选离线';
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

export function listPath(online) {
  if (online !== 'online' && online !== 'offline') {
    throw new Error(`筛选只接受 online 或 offline，收到 ${online || '空'}`);
  }
  return `/devices?pageSize=100&online=${online}`;
}

export function pagePath(online) {
  return `/devices?online=${online}`;
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
    throw new Error('心跳 online 不是 true，这一行不会出现在在线筛选里');
  }
  if (value.shedCode !== DEVICE_SHED) {
    throw new Error(`心跳棚区是 ${value.shedCode}，应为 ${DEVICE_SHED}`);
  }
  if (value.deviceCode === 'EDGE-SIM-BOX' || value.deviceType === 'ai_box') {
    throw new Error('心跳仍是夹具里的 EDGE-SIM-BOX。本命令只改本次请求，不改 heartbeat.http.json。');
  }
  if (value.deviceCode === 'CAM-ON-01' || value.deviceCode === 'CAM-DTL-ON') {
    throw new Error('心跳打到了别的演示镜头。这一刀只用 CAM-FLST-ON。');
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
    throw new Error(`设备列表里没有 ${body.code}。`);
  }
  if (!device.id) throw new Error(`${body.code} 这一行没有 id。`);
  if (device.code !== body.code || device.type !== 'camera') {
    throw new Error(`${body.code} 的类型是 ${device.type || '空'}，筛选打在摄像头这一行上。`);
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

export function assertStatusSlice(items, online, presentCode, absentCode) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) {
    throw new Error(
      `${online === 'online' ? '在线' : '离线'}筛选没有行。打开 /devices?online=${online}，状态下拉应是「${statusLabel(online)}」。`,
    );
  }
  for (const row of rows) {
    if (!row || row.onlineStatus !== online) {
      throw new Error(
        `${online === 'online' ? '在线' : '离线'}筛选里 ${row?.code || '空编号'} 的 onlineStatus 是 ${row?.onlineStatus || '空'}，应为 ${online}。`,
      );
    }
    if (row.code === absentCode) {
      throw new Error(
        `${absentCode} 出现在 ${online === 'online' ? '在线' : '离线'}筛选里。两份列表的行必须不一样。`,
      );
    }
  }
  const hit = findCode(rows, presentCode);
  if (!hit) {
    throw new Error(
      `${online === 'online' ? '在线' : '离线'}筛选里没有 ${presentCode}。地址是 /devices?online=${online}。`,
    );
  }
  if (online === 'online' && presentCode === ONLINE_CAMERA && !hit.lastHeartbeatAt) {
    throw new Error(`${ONLINE_CAMERA} 没有最近心跳。这条命令发过一次在线心跳。`);
  }
  return hit;
}

async function listDevices(token, online) {
  const path = online ? listPath(online) : '/devices?pageSize=100';
  const url = `${apiBase()}${path}`;
  let response;
  try {
    response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  } catch (error) {
    throw new Error(`API 连不上（${url}）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`设备列表失败 ${response.status} ${messageText(body) || JSON.stringify(body)}`);
  }
  return Array.isArray(body.items) ? body.items : [];
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

export function formatDeviceOnlineFilterProof(result, webOrigin = webOriginFromEnv()) {
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
    `在线筛选: ${ONLINE_CAMERA} ${statusLabel(result.online.onlineStatus)}`,
    `离线筛选: ${OFFLINE_CAMERA} ${statusLabel(result.offline.onlineStatus)}`,
    `在线列表不含: ${OFFLINE_CAMERA}`,
    `离线列表不含: ${ONLINE_CAMERA}`,
    `在线列表: ${origin}${pagePath('online')}`,
    `离线列表: ${origin}${pagePath('offline')}`,
  ];
  return lines.join('\n');
}

export async function showDeviceOnlineFilter({ now = new Date() } = {}) {
  const token = await login();
  const onlineReg = await registerCamera(token, 'online');
  const beat = buildOnlineHeartbeat(now);
  validateOnlineHeartbeat(beat);
  await postOnlineHeartbeat(beat);
  const offlineReg = await registerCamera(token, 'offline');
  const offlineMarked = await markOffline(token, offlineReg.device);
  const online = assertStatusSlice(await listDevices(token, 'online'), 'online', ONLINE_CAMERA, OFFLINE_CAMERA);
  const offline = assertStatusSlice(await listDevices(token, 'offline'), 'offline', OFFLINE_CAMERA, ONLINE_CAMERA);
  if (online.code === offline.code) {
    throw new Error('在线筛选和离线筛选指到了同一台设备。');
  }
  return {
    onlineCreated: onlineReg.created,
    offlineCreated: offlineReg.created,
    patchedOffline: offlineMarked.patched,
    online,
    offline,
  };
}

function usage() {
  return `用法:
  node scripts/demo-device-online-filter.mjs

登记 ${ONLINE_CAMERA} 并 POST 一次在线心跳，保证 ${OFFLINE_CAMERA} 离线。
再读 GET /devices?pageSize=100&online=online 与 online=offline。
两份列表的行必须不一样。步骤见 docs/DEMO_DEVICE_ONLINE_FILTER.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await showDeviceOnlineFilter();
    process.stdout.write(`${formatDeviceOnlineFilterProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
