#!/usr/bin/env node
/**
 * 保证设备列表里有一台摄像头，镜头码是 CAM-ALERT-01。
 * 编码已存在时不改原档案。不发识别，不发心跳，不改告警和规则。
 * 页面 /devices 与这条命令读的是同一份 GET /api/v1/devices?pageSize=100。
 */
import { pathToFileURL } from 'node:url';
import { apiBase } from './lib/ingest-wire.mjs';
import { login } from './demo-register-and-ingest.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';

export const LIST_CAMERA = 'CAM-ALERT-01';
export const LIST_SHED = 'S01';
export const LIST_NAME = '温度告警镜头';
export const LIST_NOTE = '镜头码对照告警';

export function cameraBody() {
  return {
    code: LIST_CAMERA,
    name: LIST_NAME,
    type: 'camera',
    shedCode: LIST_SHED,
    note: LIST_NOTE,
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

export function lensCodeOf(device) {
  if (!device || device.type !== 'camera') return '—';
  return device.code;
}

export function statusLabel(onlineStatus) {
  if (onlineStatus === 'online') return '在线';
  if (onlineStatus === 'offline') return '离线';
  return onlineStatus || '—';
}

export function heartbeatLabel(device) {
  if (!device) return '—';
  return device.lastHeartbeatAt || device.lastSeenAt || '—';
}

export function assertListedCamera(device, { created }) {
  if (!device) {
    throw new Error(
      `设备列表里没有 ${LIST_CAMERA}。打开 /devices，在镜头码一列找这一台。`,
    );
  }
  if (device.code !== LIST_CAMERA) {
    throw new Error(`镜头码是 ${device.code || '空'}，应为 ${LIST_CAMERA}`);
  }
  if (lensCodeOf(device) !== LIST_CAMERA) {
    throw new Error(`${LIST_CAMERA} 的类型是 ${device.type || '空'}，镜头码只标在摄像头上。`);
  }
  if (device.shedCode !== LIST_SHED) {
    throw new Error(
      `${LIST_CAMERA} 在棚区 ${device.shedCode}。告警演示用的是 ${LIST_SHED}。不改已有档案。`,
    );
  }
  if (device.onlineStatus !== 'online' && device.onlineStatus !== 'offline') {
    throw new Error(`${LIST_CAMERA} 的状态是 ${device.onlineStatus || '空'}，应为在线或离线。`);
  }
  if (typeof device.name !== 'string' || !device.name.trim()) {
    throw new Error(`${LIST_CAMERA} 没有名称。`);
  }
  if (created) {
    if (device.name !== LIST_NAME || device.note !== LIST_NOTE) {
      throw new Error(
        `新建的 ${LIST_CAMERA} 名称或备注与登记请求不一致（名称 ${device.name}，备注 ${device.note ?? '—'}）。`,
      );
    }
    if (device.onlineStatus !== 'offline' || device.lastHeartbeatAt || device.lastSeenAt) {
      throw new Error('新建摄像头应是离线，且还没有心跳。在线仍由心跳决定，这条命令不发心跳。');
    }
  }
  return device;
}

export async function listDevices(token) {
  const url = `${apiBase()}/devices?pageSize=100`;
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
  const items = Array.isArray(body.items) ? body.items : [];
  return items;
}

export async function ensureListedCamera(token) {
  let response;
  try {
    response = await fetch(`${apiBase()}/devices`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(cameraBody()),
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
        `用 admin 打开 /devices 确认镜头码 ${LIST_CAMERA}。`,
    );
  }
  const device = assertListedCamera(
    (await listDevices(token)).find((row) => row && row.code === LIST_CAMERA) ?? null,
    { created },
  );
  return { created, device };
}

export function formatListProof({ created, device, webOrigin = webOriginFromEnv() }) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const note = device.note == null || device.note === '' ? '—' : device.note;
  const lines = [
    created ? '登记: 新建' : '登记: 已有，未改档案',
    `镜头码: ${lensCodeOf(device)}`,
    `编号: ${device.code}`,
    `名称: ${device.name}`,
    `类型: 摄像头`,
    `棚区: ${device.shedCode}`,
    `状态: ${statusLabel(device.onlineStatus)}`,
    `备注: ${note}`,
    `最近心跳: ${heartbeatLabel(device)}`,
    `设备页: ${origin}/devices`,
    `告警筛选: ${origin}/alerts?cameraCode=${encodeURIComponent(device.code)}`,
    `识别记录: ${origin}/recognitions?cameraCode=${encodeURIComponent(device.code)}`,
  ];
  return lines.join('\n');
}

export async function showCameraList() {
  const token = await login();
  return ensureListedCamera(token);
}

function usage() {
  return `用法:
  node scripts/demo-camera-list.mjs

先保证 ${LIST_CAMERA} 在设备列表里，再读 GET /devices?pageSize=100。不发识别，不发心跳。步骤见 docs/DEMO_CAMERA_LIST.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await showCameraList();
    process.stdout.write(`${formatListProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
