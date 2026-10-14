#!/usr/bin/env node
/**
 * 删除摄像头 CAM-DEL-01。
 * 先登记（已存在则不改名称和心跳），列表里能看到，再只改备注，然后 DELETE。
 * 删除后列表没有这一台，详情是 404。不发识别，不发心跳，不改告警。
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

export const DELETE_CAMERA = 'CAM-DEL-01';
export const DELETE_SHED = 'S01';
export const DELETE_NAME = '可删除镜头';
export const DELETE_NOTE = '删除前';
export const DELETE_NOTE_AFTER = '删除前已改';

export function deleteCameraCreateBody() {
  return {
    code: DELETE_CAMERA,
    name: DELETE_NAME,
    type: 'camera',
    shedCode: DELETE_SHED,
    note: DELETE_NOTE,
  };
}

export function deleteCameraPatchBody() {
  return { note: DELETE_NOTE_AFTER };
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

export function assertDeleteSource(device, { created }) {
  if (!device) {
    throw new Error(
      `设备列表里没有 ${DELETE_CAMERA}。打开 /devices，在镜头码一列找这一台。`,
    );
  }
  if (!device.id) throw new Error(`${DELETE_CAMERA} 这一行没有 id，不能删除。`);
  if (device.code !== DELETE_CAMERA || lensCodeOf(device) !== DELETE_CAMERA) {
    throw new Error(
      `${DELETE_CAMERA} 的类型是 ${device.type || '空'}，镜头码只标在摄像头上。`,
    );
  }
  if (device.shedCode !== DELETE_SHED) {
    throw new Error(
      `${DELETE_CAMERA} 在棚区 ${device.shedCode || '空'}。删除演示用的是 ${DELETE_SHED}。`,
    );
  }
  if (device.onlineStatus !== 'online' && device.onlineStatus !== 'offline') {
    throw new Error(`${DELETE_CAMERA} 的状态是 ${device.onlineStatus || '空'}，应为在线或离线。`);
  }
  if (typeof device.name !== 'string' || !device.name.trim()) {
    throw new Error(`${DELETE_CAMERA} 没有名称。`);
  }
  if (created) {
    if (device.name !== DELETE_NAME || device.note !== DELETE_NOTE) {
      throw new Error(
        `新建的 ${DELETE_CAMERA} 名称或备注与登记请求不一致（名称 ${device.name}，备注 ${device.note ?? '—'}）。`,
      );
    }
    if (device.onlineStatus !== 'offline' || device.lastHeartbeatAt || device.lastSeenAt) {
      throw new Error('新建摄像头应是离线，且还没有心跳。这条命令先登记，再改备注，再删除，不发心跳。');
    }
    if (device.enabled !== true) {
      throw new Error(`新建的 ${DELETE_CAMERA} 应是启用。`);
    }
  }
  return device;
}

export function assertEditedCamera(device, before) {
  if (!device) {
    throw new Error(`改备注后设备列表里没有 ${DELETE_CAMERA}。删除还没发生。`);
  }
  if (!before?.id) throw new Error('改备注前这一行没有 id。');
  if (device.id !== before.id || device.code !== before.code) {
    throw new Error(
      `改备注后编号是 ${device.code || '空'}（${device.id || '无 id'}），改前是 ${before.code}（${before.id}）。`,
    );
  }
  if (device.name !== before.name || device.shedCode !== before.shedCode) {
    throw new Error('改备注改了名称或棚区。这一步只改备注。');
  }
  if (lensCodeOf(device) !== DELETE_CAMERA) {
    throw new Error(`改备注后的类型是 ${device.type || '空'}，镜头码只标在摄像头上。`);
  }
  if (device.note !== DELETE_NOTE_AFTER) {
    throw new Error(
      `设备列表备注是 ${noteText(device)}，应为 ${DELETE_NOTE_AFTER}。`,
    );
  }
  if (device.onlineStatus !== before.onlineStatus) {
    throw new Error(
      `设备列表状态是 ${statusLabel(device.onlineStatus)}，改备注前是 ${statusLabel(before.onlineStatus)}。这一步不改在线状态。`,
    );
  }
  if (
    !sameValue(device.lastHeartbeatAt, before.lastHeartbeatAt) ||
    !sameValue(device.lastSeenAt, before.lastSeenAt)
  ) {
    throw new Error('改备注改了最近心跳。这条命令不发心跳。');
  }
  if (device.enabled !== before.enabled) {
    throw new Error('改备注改了启用标记。这一步只改备注。');
  }
  return device;
}

export function assertDeletedFromList(items, removed, keptCodes) {
  const rows = Array.isArray(items) ? items : [];
  const still = rows.find((row) => row && (row.code === DELETE_CAMERA || row.id === removed.id));
  if (still) {
    throw new Error(
      `删除后设备列表仍有 ${still.code || DELETE_CAMERA}（${still.id || '无 id'}）。`,
    );
  }
  for (const code of keptCodes) {
    if (!rows.some((row) => row && row.code === code)) {
      throw new Error(`删除把 ${code} 也从列表去掉了。这条命令只删 ${DELETE_CAMERA}。`);
    }
  }
  return rows;
}

export function assertMissingDetail(status, body) {
  if (status !== 404) {
    throw new Error(`删除后镜头详情是 ${status}，应为 404。`);
  }
  if (!messageText(body).includes('设备不存在')) {
    throw new Error(
      `删除后镜头详情的说明是 ${messageText(body) || '空'}，应为设备不存在。`,
    );
  }
  return body;
}

async function readMissing(token, id) {
  const url = `${apiBase()}/devices/${encodeURIComponent(id)}`;
  let response;
  try {
    response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  } catch (error) {
    throw new Error(`API 连不上（${url}）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const body = await readJson(response);
  assertMissingDetail(response.status, body);
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
      body: JSON.stringify(deleteCameraCreateBody()),
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
        `用 admin 打开 /devices 确认镜头码 ${DELETE_CAMERA}。`,
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
      body: JSON.stringify(deleteCameraPatchBody()),
    });
  } catch (error) {
    throw new Error(`API 连不上（${url}）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(`改备注失败 ${response.status} ${messageText(payload) || JSON.stringify(payload)}`);
  }
  if (payload.note !== DELETE_NOTE_AFTER) {
    throw new Error(`改备注响应的备注是 ${noteText(payload)}，应为 ${DELETE_NOTE_AFTER}。`);
  }
  return payload;
}

async function deleteCamera(token, id) {
  const url = `${apiBase()}/devices/${encodeURIComponent(id)}`;
  let response;
  try {
    response = await fetch(url, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (error) {
    throw new Error(`API 连不上（${url}）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(`删除失败 ${response.status} ${messageText(payload) || JSON.stringify(payload)}`);
  }
  if (payload.code !== DELETE_CAMERA) {
    throw new Error(`删除响应的编号是 ${payload.code || '空'}，应为 ${DELETE_CAMERA}。`);
  }
  return payload;
}

export async function deleteListedCamera(token) {
  const { created, payload } = await postCreate(token);
  const listedBefore = await listDevices(token);
  const before = assertDeleteSource(
    listedBefore.find((row) => row && row.code === DELETE_CAMERA) ?? null,
    { created },
  );
  if (created && payload.id && payload.id !== before.id) {
    throw new Error(`新建响应的 id 是 ${payload.id}，设备列表是 ${before.id}。`);
  }
  const kept = listedBefore
    .filter((row) => row && row.code && row.code !== DELETE_CAMERA)
    .map((row) => row.code);
  const saved = await patchCamera(token, before.id);
  if (saved.id && saved.id !== before.id) {
    throw new Error(`改备注响应的 id 是 ${saved.id}，设备列表是 ${before.id}。`);
  }
  if (saved.onlineStatus && saved.onlineStatus !== before.onlineStatus) {
    throw new Error('改备注响应改了在线状态。这一步只改备注。');
  }
  if (saved.name && saved.name !== before.name) {
    throw new Error('改备注响应改了名称。这一步只改备注。');
  }
  const edited = assertEditedCamera(
    (await listDevices(token)).find((row) => row && row.code === DELETE_CAMERA) ?? null,
    before,
  );
  const removed = await deleteCamera(token, edited.id);
  if (removed.id && removed.id !== edited.id) {
    throw new Error(`删除响应的 id 是 ${removed.id}，设备列表是 ${edited.id}。`);
  }
  const after = await listDevices(token);
  assertDeletedFromList(after, edited, kept);
  await readMissing(token, edited.id);
  return { created, before, edited };
}

export function formatDeleteProof({ created, edited, webOrigin = webOriginFromEnv() }) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const lines = [
    created ? '登记: 新建' : '登记: 已有，未改名称和心跳',
    `列表: ${edited.code}`,
    `改后备注: ${noteText(edited)}`,
    `在线状态: ${statusLabel(edited.onlineStatus)}`,
    `最近心跳: ${heartbeatLabel(edited)}`,
    `删除: ${edited.code}`,
    '列表: 已无这一台',
    '详情: 不存在',
    `设备页: ${origin}/devices`,
  ];
  return lines.join('\n');
}

export async function showDeletedCamera() {
  const token = await login();
  return deleteListedCamera(token);
}

function usage() {
  return `用法:
  node scripts/demo-camera-delete.mjs

登记 ${DELETE_CAMERA}，读列表，PATCH 备注为「${DELETE_NOTE_AFTER}」，再 DELETE。然后读 GET /devices?pageSize=100 和 GET /devices/:id。已存在则不改名称和心跳。删除后列表没有这一台，详情是 404。不发识别，不发心跳。步骤见 docs/DEMO_CAMERA_DELETE.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await showDeletedCamera();
    process.stdout.write(`${formatDeleteProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
