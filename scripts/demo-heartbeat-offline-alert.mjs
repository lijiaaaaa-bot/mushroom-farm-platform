#!/usr/bin/env node
/**
 * 登记 CAM-HB-OFF-01，发一条在线心跳，等心跳超时把它标成离线并留下「设备离线」告警。
 * 不等 5 分钟。启动 API 时设置 DEVICE_OFFLINE_AFTER_MS=2000，扫描间隔会跟着变成约 1 秒。
 * 编码已存在时不改原档案。不改 heartbeat.http.json，不发识别。
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { apiBase, ingestToken, postJson, readFixture, repoRoot } from './lib/ingest-wire.mjs';
import { login } from './demo-register-and-ingest.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';

const require = createRequire(import.meta.url);

export const HB_CAMERA = 'CAM-HB-OFF-01';
export const HB_SHED = 'S01';
export const HB_NAME = '心跳超时镜头';
export const HB_NOTE = '心跳超时演示';
export const HB_TITLE = '设备离线';
export const HEARTBEAT_FIXTURE = 'heartbeat.http.json';
/** 演示用的短超时。API 进程要带着同一个值启动。 */
export const DEMO_OFFLINE_AFTER_MS = 2_000;

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function demoOfflineAfterMs(env = process.env) {
  const raw = env.DEVICE_OFFLINE_AFTER_MS;
  if (raw === undefined || raw === '') return DEMO_OFFLINE_AFTER_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEMO_OFFLINE_AFTER_MS;
  return parsed;
}

/** 与 API deviceOfflineSweepMs 在未设置 DEVICE_OFFLINE_SWEEP_MS 时一致。长超时返回 null，命令不空等。 */
export function demoOfflineWaitMs(env = process.env) {
  const timeout = demoOfflineAfterMs(env);
  const explicit = env.DEVICE_OFFLINE_AFTER_MS;
  if (explicit !== undefined && explicit !== '' && timeout >= 60_000) return null;
  if (timeout >= 60_000) return null;
  const sweep = Math.min(1_000, Math.max(200, Math.floor(timeout / 2)));
  return timeout + sweep * 2 + 1_500;
}

export function longTimeoutMessage(timeout = demoOfflineAfterMs()) {
  return (
    `DEVICE_OFFLINE_AFTER_MS=${timeout} 不少于 1 分钟，本命令不会空等。` +
    `启动 API 时加上 DEVICE_OFFLINE_AFTER_MS=${DEMO_OFFLINE_AFTER_MS}，再跑 make demo-heartbeat-offline-alert。`
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageText(payload) {
  const inner =
    payload && typeof payload.message === 'object' ? payload.message : payload;
  const message = inner?.message ?? payload?.message ?? payload?.error;
  const text = Array.isArray(message)
    ? message.join('；')
    : typeof message === 'string'
      ? message
      : '';
  return text || JSON.stringify(payload);
}

function flag(payload, key) {
  return payload?.[key] ?? payload?.message?.[key];
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

function deviceBody() {
  return {
    code: HB_CAMERA,
    name: HB_NAME,
    type: 'camera',
    shedCode: HB_SHED,
    note: HB_NOTE,
  };
}

export function buildOfflineHeartbeat(now = new Date()) {
  const fixture = readFixture(HEARTBEAT_FIXTURE);
  return {
    ...fixture.body,
    shedCode: HB_SHED,
    deviceCode: HB_CAMERA,
    deviceType: 'camera',
    online: true,
    reportedAt: now.toISOString(),
  };
}

export function validateOfflineHeartbeat(body) {
  const parsed = contracts().parseHeartbeatIngress(body);
  if (!parsed.ok) {
    throw new Error(`心跳未通过契约：${parsed.errors.join('；')}`);
  }
  const value = parsed.value;
  if (value.deviceCode !== HB_CAMERA) {
    throw new Error(`心跳设备编号是 ${value.deviceCode}，应为 ${HB_CAMERA}`);
  }
  if (value.shedCode !== HB_SHED) {
    throw new Error(`心跳棚区是 ${value.shedCode}，应为 ${HB_SHED}`);
  }
  if (value.deviceType !== 'camera') {
    throw new Error(`心跳设备类型是 ${value.deviceType || '空'}，应为摄像头`);
  }
  if (value.online !== true) {
    throw new Error('心跳 online 不是 true。这条演示要先在线，再等超时。');
  }
  return value;
}

export async function listHbCamera(token) {
  const url =
    `${apiBase()}/devices?type=camera&shedCode=${encodeURIComponent(HB_SHED)}&pageSize=100`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`设备列表失败 ${response.status} ${messageText(body)}`);
  }
  const items = Array.isArray(body.items) ? body.items : [];
  return items.find((row) => row.code === HB_CAMERA) ?? null;
}

async function registerHbCamera(token) {
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
  const already = response.status === 409 && messageText(payload).includes('设备编码已存在');
  if (!created && !already) {
    throw new Error(`登记失败 ${response.status} ${messageText(payload)}`);
  }
  const device = await listHbCamera(token);
  if (!device) {
    throw new Error(`设备列表里没有 ${HB_CAMERA}。打开 /devices 确认这一行。`);
  }
  if (device.type !== 'camera' || device.shedCode !== HB_SHED) {
    throw new Error(`${HB_CAMERA} 不是棚区 ${HB_SHED} 的摄像头。`);
  }
  if (created && (device.name !== HB_NAME || device.note !== HB_NOTE)) {
    throw new Error(`新建的 ${HB_CAMERA} 名称或备注与登记请求不一致。`);
  }
  return { created, device };
}

export async function postOfflineHeartbeat(body) {
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
  if (code && code !== HB_CAMERA) {
    throw new Error(`心跳写入的设备编号是 ${code}，应为 ${HB_CAMERA}`);
  }
  return {
    duplicate: flag(payload, 'duplicate') === true,
    onlineStatus: flag(payload, 'onlineStatus'),
    reportedAt: body.reportedAt,
  };
}

async function listOfflineAlerts(token) {
  const url =
    `${apiBase()}/alerts?shedCode=${encodeURIComponent(HB_SHED)}` +
    `&cameraCode=${encodeURIComponent(HB_CAMERA)}&pageSize=100`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`告警列表失败 ${response.status} ${messageText(body)}`);
  }
  const items = Array.isArray(body.items) ? body.items : [];
  return items.filter(
    (row) =>
      row &&
      row.cameraCode === HB_CAMERA &&
      row.shedCode === HB_SHED &&
      row.title === HB_TITLE &&
      row.metric === 'device_offline' &&
      (row.status === 'open' || row.status === 'acked') &&
      String(row.message || '').includes('超时未心跳'),
  );
}

async function readAlert(token, id) {
  const response = await fetch(`${apiBase()}/alerts/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`告警详情失败 ${response.status} ${messageText(body)}`);
  }
  return body;
}

function newest(rows) {
  return [...rows].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  )[0];
}

export function assertOfflineDevice(device) {
  if (!device) {
    throw new Error(`设备列表里没有 ${HB_CAMERA}。`);
  }
  if (device.onlineStatus !== 'offline') {
    throw new Error(
      `${HB_CAMERA} 仍是${device.onlineStatus === 'online' ? '在线' : device.onlineStatus || '未知'}。` +
        `${longTimeoutMessage()} 未设置该变量时 API 默认 5 分钟，大约每分钟才扫一次。`,
    );
  }
  if (!device.lastHeartbeatAt) {
    throw new Error(`${HB_CAMERA} 已离线，但没有最近心跳。超时离线要留着上次心跳时间。`);
  }
  return device;
}

export function assertOfflineAlert(detail) {
  const missing = [];
  if (detail?.title !== HB_TITLE) missing.push('标题');
  if (detail?.shedCode !== HB_SHED) missing.push('棚区');
  if (detail?.cameraCode !== HB_CAMERA) missing.push('摄像头');
  if (detail?.metric !== 'device_offline') missing.push('指标');
  if (detail?.status !== 'open' && detail?.status !== 'acked') missing.push('状态');
  if (detail?.level !== 'warning') missing.push('级别');
  const message = String(detail?.message || '');
  if (!message.includes('超时未心跳')) missing.push('说明里的超时');
  if (!message.includes(`棚区 ${HB_SHED}`)) missing.push('说明里的棚区');
  if (!message.includes(HB_CAMERA)) missing.push('说明里的设备');
  if (missing.length) throw new Error(`告警详情缺少${missing.join('、')}`);
  return detail;
}

export function formatOfflineProof({
  created,
  device,
  alert,
  timeoutMs = demoOfflineAfterMs(),
  webOrigin = webOriginFromEnv(),
}) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const status = alert.status === 'acked' ? '已确认' : '待确认';
  const lines = [
    created ? '登记: 新建' : '登记: 已有，未改档案',
    `设备编号: ${device.code}`,
    `棚区: ${device.shedCode}`,
    '心跳: 已写入',
    '在线: 在线',
    `超时: DEVICE_OFFLINE_AFTER_MS=${timeoutMs}`,
    '离线: 离线',
    `告警: ${alert.title}`,
    `告警 id: ${alert.id}`,
    `状态: ${status}`,
    `设备页: ${origin}/devices`,
    `告警详情: ${origin}/alerts/${encodeURIComponent(alert.id)}`,
  ];
  return lines.join('\n');
}

export async function heartbeatOfflineAlert({
  now = new Date(),
  sleepFn = sleep,
  clock = () => Date.now(),
  waitMs = demoOfflineWaitMs(),
  timeoutMs = demoOfflineAfterMs(),
} = {}) {
  if (waitMs == null) {
    throw new Error(longTimeoutMessage(timeoutMs));
  }
  const token = await login();
  const registered = await registerHbCamera(token);
  const noteBefore = registered.device.note ?? null;
  const body = buildOfflineHeartbeat(now);
  validateOfflineHeartbeat(body);
  const beat = await postOfflineHeartbeat(body);
  if (beat.duplicate) {
    throw new Error(`这次心跳不新于已有心跳，${HB_CAMERA} 没有按这次上报回到在线。把命令再跑一次。`);
  }
  if (beat.onlineStatus !== 'online') {
    throw new Error(`心跳响应不是在线（${beat.onlineStatus || '空'}）。这条演示要先写入在线，再等超时。`);
  }
  const deadline = clock() + waitMs;
  let device = null;
  let alert = null;
  while (true) {
    device = await listHbCamera(token);
    const rows = await listOfflineAlerts(token);
    alert = rows.length ? newest(rows) : null;
    if (device?.onlineStatus === 'offline' && alert) break;
    if (clock() >= deadline) break;
    await sleepFn(200);
  }
  assertOfflineDevice(device);
  if (!alert) {
    throw new Error(
      `${HB_CAMERA} 已离线，但没有未闭合的「${HB_TITLE}」告警。超时扫描应写下标题「设备离线」、说明含「超时未心跳」。`,
    );
  }
  if ((device.note ?? null) !== noteBefore) {
    throw new Error(`超时后备注从 ${noteBefore ?? '—'} 变成 ${device.note ?? '—'}。超时不应改备注。`);
  }
  const detail = assertOfflineAlert(await readAlert(token, alert.id));
  return { created: registered.created, device, alert: detail, beat, timeoutMs };
}

function usage() {
  return `用法:
  DEVICE_OFFLINE_AFTER_MS=${DEMO_OFFLINE_AFTER_MS} make api
  make demo-heartbeat-offline-alert

先登记 ${HB_CAMERA}，再 POST 一次在线心跳，然后等短超时把它标成离线并留下「设备离线」告警。
步骤见 docs/DEMO_HEARTBEAT_OFFLINE_ALERT.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await heartbeatOfflineAlert();
    process.stdout.write(`${formatOfflineProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
