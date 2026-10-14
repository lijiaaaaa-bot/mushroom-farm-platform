#!/usr/bin/env node
/**
 * 登记 CAM-REG-02，再给这台摄像头发一条心跳。
 * 编码已存在时不改原档案。契约夹具 heartbeat.http.json 不改。
 * 成功条件是设备列表里这一行在线，并且 lastHeartbeatAt 有值。
 * 设备页和值班棚详情读的是同一份列表。
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { apiBase, ingestToken, postJson, readFixture, repoRoot } from './lib/ingest-wire.mjs';
import {
  REG_CAMERA,
  REG_NAME,
  REG_NOTE,
  REG_SHED,
  listRegisteredCamera,
  login,
  registerDemoCamera,
} from './demo-register-and-ingest.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';

const require = createRequire(import.meta.url);

export const HEARTBEAT_FIXTURE = 'heartbeat.http.json';

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function buildHeartbeatPayload(now = new Date()) {
  const fixture = readFixture(HEARTBEAT_FIXTURE);
  return {
    ...fixture.body,
    shedCode: REG_SHED,
    deviceCode: REG_CAMERA,
    deviceType: 'camera',
    online: true,
    reportedAt: now.toISOString(),
  };
}

export function validateHeartbeatPayload(body) {
  const parsed = contracts().parseHeartbeatIngress(body);
  if (!parsed.ok) {
    throw new Error(`心跳未通过契约：${parsed.errors.join('；')}`);
  }
  const value = parsed.value;
  if (value.shedCode !== REG_SHED) {
    throw new Error(`心跳棚区是 ${value.shedCode}，应为 ${REG_SHED}`);
  }
  if (value.deviceCode !== REG_CAMERA) {
    throw new Error(`心跳设备编号是 ${value.deviceCode}，应为 ${REG_CAMERA}`);
  }
  if (value.deviceType !== 'camera') {
    throw new Error(`心跳设备类型是 ${value.deviceType || '空'}，应为摄像头。值班看板只数摄像头。`);
  }
  if (value.online !== true) {
    throw new Error('心跳 online 不是 true，设备不会显示在线。');
  }
  return value;
}

function messageText(payload) {
  const inner =
    payload && typeof payload.message === 'object' ? payload.message : payload;
  const message = inner?.message ?? payload?.message ?? payload?.error;
  const errors = inner?.errors || payload?.errors;
  const code = inner?.code || payload?.code;
  const text = Array.isArray(message)
    ? message.join('；')
    : typeof message === 'string'
      ? message
      : '';
  const list = Array.isArray(errors) ? errors.join('；') : '';
  const parts = [code, text, list].filter(Boolean);
  return parts.join(' ') || JSON.stringify(payload);
}

function flag(payload, key) {
  return payload?.[key] ?? payload?.message?.[key];
}

export async function postHeartbeat(body) {
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
    throw new Error(`心跳被拒绝 ${posted.responseStatus} ${messageText(payload)}`);
  }
  const code = flag(payload, 'code');
  if (code && code !== REG_CAMERA) {
    throw new Error(`心跳写入的设备编号是 ${code}，应为 ${REG_CAMERA}`);
  }
  return {
    duplicate: flag(payload, 'duplicate') === true,
    onlineStatus: flag(payload, 'onlineStatus'),
    reportedAt: body.reportedAt,
  };
}

function sameInstant(left, right) {
  const a = new Date(left).getTime();
  const b = new Date(right).getTime();
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1000;
}

export function assertListedOnline(device, { reportedAt, duplicate }) {
  if (!device) {
    throw new Error(`设备列表里没有 ${REG_CAMERA}。打开 /devices 确认这一行。`);
  }
  if (device.code !== REG_CAMERA) {
    throw new Error(`设备列表返回的编号是 ${device.code}，应为 ${REG_CAMERA}`);
  }
  if (device.type !== 'camera') {
    throw new Error(`${REG_CAMERA} 的类型是 ${device.type}，不是摄像头。值班看板不会计入在线摄像头。`);
  }
  if (device.shedCode !== REG_SHED) {
    throw new Error(`${REG_CAMERA} 在棚区 ${device.shedCode}。值班棚详情要打开 /duty-screen/${REG_SHED}。`);
  }
  if (device.onlineStatus !== 'online') {
    const extra = duplicate ? '这次心跳不新于已存心跳。' : '';
    throw new Error(
      `${REG_CAMERA} 在设备列表里是 ${device.onlineStatus || '未知'}，不是在线。${extra}刷新 /devices 与 /duty-screen/${REG_SHED} 也看不到在线。`,
    );
  }
  if (!device.lastHeartbeatAt) {
    throw new Error(
      `${REG_CAMERA} 没有最近心跳。设备页可能因识别上报显示在线，值班棚详情的最近心跳仍是「—」。`,
    );
  }
  if (!duplicate && !sameInstant(device.lastHeartbeatAt, reportedAt)) {
    throw new Error(`设备列表的最近心跳 ${device.lastHeartbeatAt} 不是这次的 ${reportedAt}`);
  }
  if (duplicate) {
    const listed = new Date(device.lastHeartbeatAt).getTime();
    const sent = new Date(reportedAt).getTime();
    if (!Number.isFinite(listed) || listed + 1000 < sent) {
      throw new Error(`重复心跳后，列表里的最近心跳 ${device.lastHeartbeatAt} 早于这次的 ${reportedAt}`);
    }
  }
}

export function formatHeartbeatProof({ created, device, beat, webOrigin = webOriginFromEnv() }) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const note = device.note == null || device.note === '' ? '—' : device.note;
  const lines = [
    created ? '登记: 新建' : '登记: 已有，未改档案',
    `设备编号: ${device.code}`,
    `设备名称: ${device.name}`,
    `棚区: ${device.shedCode}`,
    `备注: ${note}`,
    '心跳: 已写入',
    `重复: ${beat.duplicate ? '是' : '否'}`,
    '在线: 在线',
    `最近心跳: ${device.lastHeartbeatAt}`,
    `设备页: ${origin}/devices`,
    `值班看板: ${origin}/duty-screen`,
    `值班棚: ${origin}/duty-screen/${encodeURIComponent(device.shedCode)}`,
  ];
  return lines.join('\n');
}

export async function registerAndHeartbeat({ now = new Date() } = {}) {
  const token = await login();
  const registered = await registerDemoCamera(token);
  const body = buildHeartbeatPayload(now);
  validateHeartbeatPayload(body);
  if (body.deviceCode !== REG_CAMERA || body.deviceType !== 'camera') {
    throw new Error(`这次心跳不是 ${REG_CAMERA} 摄像头`);
  }
  const beat = await postHeartbeat(body);
  const device = await listRegisteredCamera(token);
  assertListedOnline(device, { reportedAt: body.reportedAt, duplicate: beat.duplicate });
  if ((device.note ?? null) !== (registered.device.note ?? null)) {
    throw new Error(
      `心跳后备注从 ${registered.device.note ?? '—'} 变成 ${device.note ?? '—'}。心跳不应改备注。`,
    );
  }
  if (registered.created && (device.name !== REG_NAME || device.note !== REG_NOTE)) {
    throw new Error(
      `新建的 ${REG_CAMERA} 名称或备注与登记请求不一致（名称 ${device.name}，备注 ${device.note ?? '—'}）。`,
    );
  }
  return { created: registered.created, device, beat };
}

function usage() {
  return `用法:
  node scripts/demo-register-and-heartbeat.mjs

先 POST /api/v1/devices 登记 ${REG_CAMERA}，再 POST 一次心跳。步骤见 docs/DEMO_REGISTER_AND_HEARTBEAT.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await registerAndHeartbeat();
    process.stdout.write(`${formatHeartbeatProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
