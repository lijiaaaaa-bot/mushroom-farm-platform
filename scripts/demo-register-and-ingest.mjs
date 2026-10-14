#!/usr/bin/env node
/**
 * 登记 CAM-REG-02，再给这台摄像头发一条识别。
 * 样例文件仍是 recognition.demo-one.json，本次请求把摄像头编号改成 CAM-REG-02。
 * 编码已存在时不改原档案，只继续发识别。
 */
import { pathToFileURL } from 'node:url';
import { apiBase } from './lib/ingest-wire.mjs';
import {
  buildDemoPayload,
  formatDemoProof,
  sendDemo,
  validateDemoPayload,
  webOriginFromEnv,
} from './demo-one-http-recognition.mjs';

export const REG_CAMERA = 'CAM-REG-02';
export const REG_SHED = 'S01';
export const REG_NAME = '西侧过道';
export const REG_NOTE = '演示登记';

export function buildRegisteredPayload(now = new Date()) {
  const body = buildDemoPayload(now);
  body.shedCode = REG_SHED;
  body.cameraCode = REG_CAMERA;
  body.idempotencyKey = `demo-reg-02-${now.getTime()}`;
  return body;
}

function messageText(payload) {
  const message = payload?.message ?? payload?.error;
  if (Array.isArray(message)) return message.join('；');
  if (typeof message === 'string') return message;
  return '';
}

export async function login() {
  let response;
  try {
    response = await fetch(`${apiBase()}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'Admin@123456' }),
    });
  } catch (error) {
    throw new Error(`API 连不上（${apiBase()}）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const session = await response.json().catch(() => ({}));
  if (!response.ok || !session.accessToken) {
    throw new Error(`登录失败 ${response.status}。确认 API 已用种子账号启动。`);
  }
  return session.accessToken;
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

export async function listRegisteredCamera(token) {
  const url =
    `${apiBase()}/devices?type=camera&shedCode=${encodeURIComponent(REG_SHED)}&pageSize=100`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`设备列表失败 ${response.status} ${messageText(body) || JSON.stringify(body)}`);
  }
  const items = Array.isArray(body.items) ? body.items : [];
  return items.find((row) => row.code === REG_CAMERA) ?? null;
}

function deviceBody() {
  return {
    code: REG_CAMERA,
    name: REG_NAME,
    type: 'camera',
    shedCode: REG_SHED,
    note: REG_NOTE,
  };
}

export async function registerDemoCamera(token) {
  let response;
  try {
    response = await fetch(`${apiBase()}/devices`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(deviceBody()),
    });
  } catch (error) {
    throw new Error(`API 连不上（${apiBase()}/devices）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const payload = await readJson(response);
  const created = response.status === 201;
  const already =
    response.status === 409 && messageText(payload).includes('设备编码已存在');
  if (!created && !already) {
    throw new Error(
      `登记失败 ${response.status} ${messageText(payload) || JSON.stringify(payload)}。` +
        '用 admin 打开 /devices，按 docs/DEMO_REGISTER_AND_INGEST.md 登记 CAM-REG-02。',
    );
  }
  const device = await listRegisteredCamera(token);
  if (!device) {
    throw new Error(
      `设备列表里没有 ${REG_CAMERA}。打开 ${webOriginFromEnv().replace(/\/$/, '')}/devices 确认这一行。`,
    );
  }
  if (device.type !== 'camera') {
    throw new Error(`${REG_CAMERA} 的类型是 ${device.type}，不是摄像头。`);
  }
  if (device.shedCode !== REG_SHED) {
    throw new Error(
      `${REG_CAMERA} 在棚区 ${device.shedCode}。这条识别要写到 ${REG_SHED}。在 /devices 使用棚区 ${REG_SHED}。`,
    );
  }
  if (created) {
    if (device.name !== REG_NAME || device.note !== REG_NOTE) {
      throw new Error(
        `新建的 ${REG_CAMERA} 名称或备注与登记请求不一致（名称 ${device.name}，备注 ${device.note ?? '—'}）。`,
      );
    }
  }
  return { created, device };
}

export function formatRegisterProof({ created, device, sent, webOrigin = webOriginFromEnv() }) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const note = device.note == null || device.note === '' ? '—' : device.note;
  const head = [
    created ? '登记: 新建' : '登记: 已有，未改档案',
    `设备编号: ${device.code}`,
    `设备名称: ${device.name}`,
    `棚区: ${device.shedCode}`,
    `备注: ${note}`,
    `设备页: ${origin}/devices`,
  ];
  return `${head.join('\n')}\n${formatDemoProof({ ...sent, webOrigin: origin })}`;
}

export async function registerAndIngest({ now = new Date() } = {}) {
  const token = await login();
  const registered = await registerDemoCamera(token);
  const body = buildRegisteredPayload(now);
  validateDemoPayload(body, now);
  if (body.cameraCode !== REG_CAMERA) {
    throw new Error(`这次识别的摄像头编号是 ${body.cameraCode}，应为 ${REG_CAMERA}`);
  }
  const sent = await sendDemo({ channel: 'http', now, body });
  if (sent.body.cameraCode !== REG_CAMERA) {
    throw new Error(`接入写入的摄像头编号是 ${sent.body.cameraCode}，应为 ${REG_CAMERA}`);
  }
  return { ...registered, sent };
}

function usage() {
  return `用法:
  node scripts/demo-register-and-ingest.mjs

先 POST /api/v1/devices 登记 ${REG_CAMERA}，再 POST 一次识别。步骤见 docs/DEMO_REGISTER_AND_INGEST.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await registerAndIngest();
    process.stdout.write(`${formatRegisterProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
