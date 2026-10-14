#!/usr/bin/env node
/**
 * 新增一台摄像头 CAM-NEW-01。
 * 编码已存在时不改原档案。然后读设备页同一份列表，再读这台的镜头详情。
 * 不发识别，不发心跳，不改告警。
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

export const NEW_CAMERA = 'CAM-NEW-01';
export const NEW_SHED = 'S01';
export const NEW_NAME = '新增镜头';
export const NEW_NOTE = '新增可演示';

export function newCameraBody() {
  return {
    code: NEW_CAMERA,
    name: NEW_NAME,
    type: 'camera',
    shedCode: NEW_SHED,
    note: NEW_NOTE,
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

export function assertNewCamera(device, { created }) {
  if (!device) {
    throw new Error(
      `设备列表里没有 ${NEW_CAMERA}。打开 /devices，在镜头码一列找这一台。`,
    );
  }
  if (!device.id) throw new Error(`${NEW_CAMERA} 这一行没有 id，打不开镜头详情。`);
  if (device.code !== NEW_CAMERA || lensCodeOf(device) !== NEW_CAMERA) {
    throw new Error(
      `${NEW_CAMERA} 的类型是 ${device.type || '空'}，镜头码只标在摄像头上。`,
    );
  }
  if (device.shedCode !== NEW_SHED) {
    throw new Error(
      `${NEW_CAMERA} 在棚区 ${device.shedCode || '空'}。新增演示用的是 ${NEW_SHED}。不改已有档案。`,
    );
  }
  if (device.onlineStatus !== 'online' && device.onlineStatus !== 'offline') {
    throw new Error(`${NEW_CAMERA} 的状态是 ${device.onlineStatus || '空'}，应为在线或离线。`);
  }
  if (typeof device.name !== 'string' || !device.name.trim()) {
    throw new Error(`${NEW_CAMERA} 没有名称。`);
  }
  if (created) {
    if (device.name !== NEW_NAME || device.note !== NEW_NOTE) {
      throw new Error(
        `新建的 ${NEW_CAMERA} 名称或备注与登记请求不一致（名称 ${device.name}，备注 ${device.note ?? '—'}）。`,
      );
    }
    if (device.onlineStatus !== 'offline' || device.lastHeartbeatAt || device.lastSeenAt) {
      throw new Error('新建摄像头应是离线，且还没有心跳。在线仍由心跳决定，这条命令不发心跳。');
    }
  }
  return device;
}

export function assertNewCameraDetail(detail, listed) {
  if (!detail?.id) throw new Error('镜头详情没有 id。');
  if (!listed?.id) throw new Error('设备列表这一行没有 id。');
  if (detail.id !== listed.id) {
    throw new Error(`镜头详情 id 是 ${detail.id}，设备列表是 ${listed.id}。`);
  }
  if (detail.code !== NEW_CAMERA || detail.code !== listed.code) {
    throw new Error(`镜头详情编号是 ${detail.code || '空'}，应为 ${NEW_CAMERA}。`);
  }
  if (lensCodeOf(detail) !== NEW_CAMERA) {
    throw new Error(`镜头详情的类型是 ${detail.type || '空'}，镜头码只标在摄像头上。`);
  }
  if (detail.name !== listed.name) {
    throw new Error(
      `镜头详情名称是 ${detail.name || '空'}，设备列表是 ${listed.name || '空'}。`,
    );
  }
  if (detail.shedCode !== listed.shedCode) {
    throw new Error(
      `镜头详情棚区是 ${detail.shedCode || '空'}，设备列表是 ${listed.shedCode || '空'}。`,
    );
  }
  if (detail.onlineStatus !== listed.onlineStatus) {
    throw new Error(
      `镜头详情状态是 ${detail.onlineStatus || '空'}，设备列表是 ${listed.onlineStatus || '空'}。`,
    );
  }
  if (!sameValue(detail.note, listed.note)) {
    throw new Error('镜头详情的备注和设备列表不一致。这条命令不改档案。');
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

export async function createListedCamera(token) {
  let response;
  try {
    response = await fetch(`${apiBase()}/devices`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(newCameraBody()),
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
        `用 admin 打开 /devices 确认镜头码 ${NEW_CAMERA}。`,
    );
  }
  const listed = assertNewCamera(
    (await listDevices(token)).find((row) => row && row.code === NEW_CAMERA) ?? null,
    { created },
  );
  if (created && payload.id && payload.id !== listed.id) {
    throw new Error(`新建响应的 id 是 ${payload.id}，设备列表是 ${listed.id}。`);
  }
  const detail = assertNewCameraDetail(await readDevice(token, listed.id), listed);
  return { created, device: detail };
}

export function formatCreateProof({ created, device, webOrigin = webOriginFromEnv() }) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const note = device.note == null || device.note === '' ? '—' : device.note;
  const lines = [
    created ? '登记: 新建' : '登记: 已有，未改档案',
    `镜头码: ${lensCodeOf(device)}`,
    `编号: ${device.code}`,
    `名称: ${device.name}`,
    '类型: 摄像头',
    `棚区: ${device.shedCode}`,
    `状态: ${statusLabel(device.onlineStatus)}`,
    `备注: ${note}`,
    `最近心跳: ${heartbeatLabel(device)}`,
    `设备页: ${origin}/devices`,
    `镜头详情: ${origin}/devices/${encodeURIComponent(device.id)}`,
  ];
  return lines.join('\n');
}

export async function showNewCamera() {
  const token = await login();
  return createListedCamera(token);
}

function usage() {
  return `用法:
  node scripts/demo-camera-create.mjs

新增 ${NEW_CAMERA}，再读 GET /devices?pageSize=100 和 GET /devices/:id。编码已存在则不改档案。不发识别，不发心跳。步骤见 docs/DEMO_CAMERA_CREATE.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await showNewCamera();
    process.stdout.write(`${formatCreateProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
