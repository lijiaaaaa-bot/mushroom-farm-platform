#!/usr/bin/env node
/**
 * 停用摄像头 CAM-STOP-01。
 * 先登记（已存在则不改名称和心跳），再 PATCH enabled=false，
 * 然后读设备列表和镜头详情。不发识别，不发心跳，不改告警。
 */
import { pathToFileURL } from 'node:url';
import { apiBase } from './lib/ingest-wire.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';
import { login } from './demo-register-and-ingest.mjs';
import {
  heartbeatLabel,
  lensCodeOf,
  listDevices,
  statusLabel,
} from './demo-camera-list.mjs';

export const STOP_CAMERA = 'CAM-STOP-01';
export const STOP_SHED = 'S01';
export const STOP_NAME = '可停用镜头';
export const STOP_NOTE = '停用前';

export function stopCameraCreateBody() {
  return {
    code: STOP_CAMERA,
    name: STOP_NAME,
    type: 'camera',
    shedCode: STOP_SHED,
    note: STOP_NOTE,
  };
}

export function stopCameraPatchBody() {
  return { enabled: false };
}

export function enabledLabel(enabled) {
  return enabled === false ? '停用' : '启用';
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

function noteText(device) {
  if (!device || device.note == null || device.note === '') return '—';
  return device.note;
}

export function assertStopSource(device, { created }) {
  if (!device) {
    throw new Error(
      `设备列表里没有 ${STOP_CAMERA}。打开 /devices，在镜头码一列找这一台。`,
    );
  }
  if (!device.id) throw new Error(`${STOP_CAMERA} 这一行没有 id，不能停用。`);
  if (device.code !== STOP_CAMERA || lensCodeOf(device) !== STOP_CAMERA) {
    throw new Error(
      `${STOP_CAMERA} 的类型是 ${device.type || '空'}，镜头码只标在摄像头上。`,
    );
  }
  if (device.shedCode !== STOP_SHED) {
    throw new Error(
      `${STOP_CAMERA} 在棚区 ${device.shedCode || '空'}。停用演示用的是 ${STOP_SHED}。`,
    );
  }
  if (device.onlineStatus !== 'online' && device.onlineStatus !== 'offline') {
    throw new Error(`${STOP_CAMERA} 的状态是 ${device.onlineStatus || '空'}，应为在线或离线。`);
  }
  if (typeof device.name !== 'string' || !device.name.trim()) {
    throw new Error(`${STOP_CAMERA} 没有名称。`);
  }
  if (created) {
    if (device.name !== STOP_NAME || device.note !== STOP_NOTE) {
      throw new Error(
        `新建的 ${STOP_CAMERA} 名称或备注与登记请求不一致（名称 ${device.name}，备注 ${device.note ?? '—'}）。`,
      );
    }
    if (device.onlineStatus !== 'offline' || device.lastHeartbeatAt || device.lastSeenAt) {
      throw new Error('新建摄像头应是离线，且还没有心跳。这条命令先登记，再停用，不发心跳。');
    }
    if (device.enabled !== true) {
      throw new Error(`新建的 ${STOP_CAMERA} 应是启用。`);
    }
  }
  return device;
}

export function assertStoppedCamera(device, before) {
  if (!device) {
    throw new Error(`停用后设备列表里没有 ${STOP_CAMERA}。`);
  }
  if (!before?.id) throw new Error('停用前这一行没有 id。');
  if (device.id !== before.id || device.code !== before.code) {
    throw new Error(
      `停用后编号是 ${device.code || '空'}（${device.id || '无 id'}），停用前是 ${before.code}（${before.id}）。`,
    );
  }
  if (device.name !== before.name || device.shedCode !== before.shedCode) {
    throw new Error('停用改了名称或棚区。这条命令只改启用标记。');
  }
  if (lensCodeOf(device) !== STOP_CAMERA) {
    throw new Error(`停用后的类型是 ${device.type || '空'}，镜头码只标在摄像头上。`);
  }
  if (!sameValue(device.note, before.note)) {
    throw new Error(
      `设备列表备注是 ${noteText(device)}，停用前是 ${noteText(before)}。停用不改备注。`,
    );
  }
  if (device.onlineStatus !== before.onlineStatus) {
    throw new Error(
      `设备列表状态是 ${statusLabel(device.onlineStatus)}，停用前是 ${statusLabel(before.onlineStatus)}。停用不改在线状态。`,
    );
  }
  if (device.enabled !== false) {
    throw new Error(
      `设备列表启用是 ${enabledLabel(device.enabled)}，应为停用。`,
    );
  }
  if (
    !sameValue(device.lastHeartbeatAt, before.lastHeartbeatAt) ||
    !sameValue(device.lastSeenAt, before.lastSeenAt)
  ) {
    throw new Error('停用改了最近心跳。这条命令不发心跳。');
  }
  return device;
}

export function assertStoppedDetail(detail, listed) {
  if (!detail?.id) throw new Error('镜头详情没有 id。');
  if (!listed?.id) throw new Error('设备列表这一行没有 id。');
  if (detail.id !== listed.id) {
    throw new Error(`镜头详情 id 是 ${detail.id}，设备列表是 ${listed.id}。`);
  }
  if (detail.code !== STOP_CAMERA || detail.code !== listed.code) {
    throw new Error(`镜头详情编号是 ${detail.code || '空'}，应为 ${STOP_CAMERA}。`);
  }
  if (detail.name !== listed.name || detail.shedCode !== listed.shedCode) {
    throw new Error('镜头详情的名称或棚区和设备列表不一致。');
  }
  if (lensCodeOf(detail) !== STOP_CAMERA) {
    throw new Error(`镜头详情的类型是 ${detail.type || '空'}，镜头码只标在摄像头上。`);
  }
  if (!sameValue(detail.note, listed.note)) {
    throw new Error(
      `镜头详情备注是 ${noteText(detail)}，设备列表是 ${noteText(listed)}。`,
    );
  }
  if (detail.onlineStatus !== listed.onlineStatus) {
    throw new Error(
      `镜头详情状态是 ${statusLabel(detail.onlineStatus)}，设备列表是 ${statusLabel(listed.onlineStatus)}。`,
    );
  }
  if (detail.enabled !== false || detail.enabled !== listed.enabled) {
    throw new Error(
      `镜头详情启用是 ${enabledLabel(detail.enabled)}，设备列表是 ${enabledLabel(listed.enabled)}。应为停用。`,
    );
  }
  if (
    !sameValue(detail.lastHeartbeatAt, listed.lastHeartbeatAt) ||
    !sameValue(detail.lastSeenAt, listed.lastSeenAt)
  ) {
    throw new Error('镜头详情的心跳和设备列表不一致。这条命令不发心跳。');
  }
  return detail;
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

async function postCreate(token) {
  let response;
  try {
    response = await fetch(`${apiBase()}/devices`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(stopCameraCreateBody()),
    });
  } catch (error) {
    throw new Error(
      `API 连不上（${apiBase()}/devices）。先执行 make up、make migrate、make api。${error.message}`,
    );
  }
  const payload = await readJson(response);
  const created = response.status === 201;
  const already = response.status === 409 && messageText(payload).includes('设备编码已存在');
  if (!created && !already) {
    throw new Error(
      `登记失败 ${response.status} ${messageText(payload) || JSON.stringify(payload)}。` +
        `用 admin 打开 /devices 确认镜头码 ${STOP_CAMERA}。`,
    );
  }
  return { created, payload };
}

async function patchCamera(token, id) {
  const url = `${apiBase()}/devices/${encodeURIComponent(id)}`;
  let response;
  try {
    response = await fetch(url, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(stopCameraPatchBody()),
    });
  } catch (error) {
    throw new Error(`API 连不上（${url}）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(`停用失败 ${response.status} ${messageText(payload) || JSON.stringify(payload)}`);
  }
  if (payload.enabled !== false) {
    throw new Error(`停用响应的启用是 ${enabledLabel(payload.enabled)}，应为停用。`);
  }
  return payload;
}

export async function stopListedCamera(token) {
  const { created, payload } = await postCreate(token);
  const before = assertStopSource(
    (await listDevices(token)).find((row) => row && row.code === STOP_CAMERA) ?? null,
    { created },
  );
  if (created && payload.id && payload.id !== before.id) {
    throw new Error(`新建响应的 id 是 ${payload.id}，设备列表是 ${before.id}。`);
  }
  const saved = await patchCamera(token, before.id);
  if (saved.id && saved.id !== before.id) {
    throw new Error(`停用响应的 id 是 ${saved.id}，设备列表是 ${before.id}。`);
  }
  if (saved.note !== undefined && !sameValue(saved.note, before.note)) {
    throw new Error('停用响应改了备注。这条命令只改启用标记。');
  }
  if (saved.onlineStatus && saved.onlineStatus !== before.onlineStatus) {
    throw new Error('停用响应改了在线状态。这条命令只改启用标记。');
  }
  const listed = assertStoppedCamera(
    (await listDevices(token)).find((row) => row && row.code === STOP_CAMERA) ?? null,
    before,
  );
  const detail = assertStoppedDetail(await readDevice(token, listed.id), listed);
  return { created, before, device: detail };
}

export function formatStopProof({ created, before, device, webOrigin = webOriginFromEnv() }) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const lines = [
    created ? '登记: 新建' : '登记: 已有，未改名称和心跳',
    `停用前: ${enabledLabel(before.enabled)}`,
    `停用后: ${enabledLabel(device.enabled)}`,
    `在线状态: ${statusLabel(device.onlineStatus)}`,
    `备注: ${noteText(device)}`,
    `镜头码: ${lensCodeOf(device)}`,
    `编号: ${device.code}`,
    `名称: ${device.name}`,
    '类型: 摄像头',
    `棚区: ${device.shedCode}`,
    `最近心跳: ${heartbeatLabel(device)}`,
    `设备页: ${origin}/devices`,
    `镜头详情: ${origin}/devices/${encodeURIComponent(device.id)}`,
  ];
  return lines.join('\n');
}

export async function showStoppedCamera() {
  const token = await login();
  return stopListedCamera(token);
}

function usage() {
  return `用法:
  node scripts/demo-camera-stop.mjs

登记 ${STOP_CAMERA}，再 PATCH enabled=false，然后读 GET /devices?pageSize=100 和 GET /devices/:id。已存在则不改名称和心跳。不发识别，不发心跳。步骤见 docs/DEMO_CAMERA_STOP.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await showStoppedCamera();
    process.stdout.write(`${formatStopProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
