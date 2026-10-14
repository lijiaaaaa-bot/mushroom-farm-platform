#!/usr/bin/env node
/**
 * 编辑摄像头 CAM-EDIT-01 的备注和状态。
 * 先登记（已存在则不改名称和心跳），再 PATCH 备注与在线状态，
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

export const EDIT_CAMERA = 'CAM-EDIT-01';
export const EDIT_SHED = 'S01';
export const EDIT_NAME = '可编辑镜头';
export const EDIT_NOTE_BEFORE = '编辑前';
export const EDIT_NOTE_AFTER = '备注已改';
export const EDIT_STATUS_AFTER = 'online';

export function editCameraCreateBody() {
  return {
    code: EDIT_CAMERA,
    name: EDIT_NAME,
    type: 'camera',
    shedCode: EDIT_SHED,
    note: EDIT_NOTE_BEFORE,
  };
}

export function editCameraPatchBody() {
  return {
    note: EDIT_NOTE_AFTER,
    onlineStatus: EDIT_STATUS_AFTER,
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

function noteText(device) {
  if (!device || device.note == null || device.note === '') return '—';
  return device.note;
}

export function assertEditSource(device, { created }) {
  if (!device) {
    throw new Error(
      `设备列表里没有 ${EDIT_CAMERA}。打开 /devices，在镜头码一列找这一台。`,
    );
  }
  if (!device.id) throw new Error(`${EDIT_CAMERA} 这一行没有 id，不能保存备注和状态。`);
  if (device.code !== EDIT_CAMERA || lensCodeOf(device) !== EDIT_CAMERA) {
    throw new Error(
      `${EDIT_CAMERA} 的类型是 ${device.type || '空'}，镜头码只标在摄像头上。`,
    );
  }
  if (device.shedCode !== EDIT_SHED) {
    throw new Error(
      `${EDIT_CAMERA} 在棚区 ${device.shedCode || '空'}。编辑演示用的是 ${EDIT_SHED}。`,
    );
  }
  if (device.onlineStatus !== 'online' && device.onlineStatus !== 'offline') {
    throw new Error(`${EDIT_CAMERA} 的状态是 ${device.onlineStatus || '空'}，应为在线或离线。`);
  }
  if (typeof device.name !== 'string' || !device.name.trim()) {
    throw new Error(`${EDIT_CAMERA} 没有名称。`);
  }
  if (created) {
    if (device.name !== EDIT_NAME || device.note !== EDIT_NOTE_BEFORE) {
      throw new Error(
        `新建的 ${EDIT_CAMERA} 名称或备注与登记请求不一致（名称 ${device.name}，备注 ${device.note ?? '—'}）。`,
      );
    }
    if (device.onlineStatus !== 'offline' || device.lastHeartbeatAt || device.lastSeenAt) {
      throw new Error('新建摄像头应是离线，且还没有心跳。这条命令先登记，再改状态，不发心跳。');
    }
  }
  return device;
}

export function assertEditedCamera(device, before) {
  if (!device) {
    throw new Error(`保存后设备列表里没有 ${EDIT_CAMERA}。`);
  }
  if (!before?.id) throw new Error('编辑前这一行没有 id。');
  if (device.id !== before.id || device.code !== before.code) {
    throw new Error(
      `保存后编号是 ${device.code || '空'}（${device.id || '无 id'}），编辑前是 ${before.code}（${before.id}）。`,
    );
  }
  if (device.name !== before.name || device.shedCode !== before.shedCode) {
    throw new Error('保存改了名称或棚区。这条命令只改备注和状态。');
  }
  if (lensCodeOf(device) !== EDIT_CAMERA) {
    throw new Error(`保存后的类型是 ${device.type || '空'}，镜头码只标在摄像头上。`);
  }
  if (device.note !== EDIT_NOTE_AFTER) {
    throw new Error(
      `设备列表备注是 ${noteText(device)}，应为 ${EDIT_NOTE_AFTER}。`,
    );
  }
  if (device.onlineStatus !== EDIT_STATUS_AFTER) {
    throw new Error(
      `设备列表状态是 ${statusLabel(device.onlineStatus)}，应为 ${statusLabel(EDIT_STATUS_AFTER)}。`,
    );
  }
  if (
    !sameValue(device.lastHeartbeatAt, before.lastHeartbeatAt) ||
    !sameValue(device.lastSeenAt, before.lastSeenAt)
  ) {
    throw new Error('保存改了最近心跳。这条命令不发心跳。');
  }
  return device;
}

export function assertEditedDetail(detail, listed) {
  if (!detail?.id) throw new Error('镜头详情没有 id。');
  if (!listed?.id) throw new Error('设备列表这一行没有 id。');
  if (detail.id !== listed.id) {
    throw new Error(`镜头详情 id 是 ${detail.id}，设备列表是 ${listed.id}。`);
  }
  if (detail.code !== EDIT_CAMERA || detail.code !== listed.code) {
    throw new Error(`镜头详情编号是 ${detail.code || '空'}，应为 ${EDIT_CAMERA}。`);
  }
  if (detail.name !== listed.name || detail.shedCode !== listed.shedCode) {
    throw new Error('镜头详情的名称或棚区和设备列表不一致。');
  }
  if (lensCodeOf(detail) !== EDIT_CAMERA) {
    throw new Error(`镜头详情的类型是 ${detail.type || '空'}，镜头码只标在摄像头上。`);
  }
  if (detail.note !== EDIT_NOTE_AFTER || detail.note !== listed.note) {
    throw new Error(
      `镜头详情备注是 ${noteText(detail)}，设备列表是 ${noteText(listed)}。应为 ${EDIT_NOTE_AFTER}。`,
    );
  }
  if (detail.onlineStatus !== EDIT_STATUS_AFTER || detail.onlineStatus !== listed.onlineStatus) {
    throw new Error(
      `镜头详情状态是 ${statusLabel(detail.onlineStatus)}，设备列表是 ${statusLabel(listed.onlineStatus)}。`,
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
      body: JSON.stringify(editCameraCreateBody()),
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
        `用 admin 打开 /devices 确认镜头码 ${EDIT_CAMERA}。`,
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
      body: JSON.stringify(editCameraPatchBody()),
    });
  } catch (error) {
    throw new Error(`API 连不上（${url}）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(`保存失败 ${response.status} ${messageText(payload) || JSON.stringify(payload)}`);
  }
  if (payload.note !== EDIT_NOTE_AFTER || payload.onlineStatus !== EDIT_STATUS_AFTER) {
    throw new Error(
      `保存响应的备注或状态不对（备注 ${noteText(payload)}，状态 ${statusLabel(payload.onlineStatus)}）。`,
    );
  }
  return payload;
}

export async function editListedCamera(token) {
  const { created, payload } = await postCreate(token);
  const before = assertEditSource(
    (await listDevices(token)).find((row) => row && row.code === EDIT_CAMERA) ?? null,
    { created },
  );
  if (created && payload.id && payload.id !== before.id) {
    throw new Error(`新建响应的 id 是 ${payload.id}，设备列表是 ${before.id}。`);
  }
  const saved = await patchCamera(token, before.id);
  if (saved.id && saved.id !== before.id) {
    throw new Error(`保存响应的 id 是 ${saved.id}，设备列表是 ${before.id}。`);
  }
  const listed = assertEditedCamera(
    (await listDevices(token)).find((row) => row && row.code === EDIT_CAMERA) ?? null,
    before,
  );
  const detail = assertEditedDetail(await readDevice(token, listed.id), listed);
  return { created, before, device: detail };
}

export function formatEditProof({ created, before, device, webOrigin = webOriginFromEnv() }) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const lines = [
    created ? '登记: 新建' : '登记: 已有，未改名称和心跳',
    `编辑前状态: ${statusLabel(before.onlineStatus)}`,
    `编辑前备注: ${noteText(before)}`,
    `编辑后状态: ${statusLabel(device.onlineStatus)}`,
    `编辑后备注: ${noteText(device)}`,
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

export async function showEditedCamera() {
  const token = await login();
  return editListedCamera(token);
}

function usage() {
  return `用法:
  node scripts/demo-camera-edit.mjs

登记 ${EDIT_CAMERA}，再 PATCH 备注和状态，然后读 GET /devices?pageSize=100 和 GET /devices/:id。已存在则不改名称和心跳。不发识别，不发心跳。步骤见 docs/DEMO_CAMERA_EDIT.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await showEditedCamera();
    process.stdout.write(`${formatEditProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
