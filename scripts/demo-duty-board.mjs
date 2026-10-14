#!/usr/bin/env node
/**
 * 让值班看板的三个数字都不是空的：一台在线、一台离线、一条待确认告警。
 * 在线、离线与设备列表的 online 参数一致。待确认与告警列表 status=open 一致。
 * 不改 heartbeat.http.json，不发识别，不新增告警筛选。
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { apiBase, ingestToken, postJson, readFixture, repoRoot } from './lib/ingest-wire.mjs';
import { login } from './demo-register-and-ingest.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';

const require = createRequire(import.meta.url);

export const ONLINE_CAMERA = 'CAM-DUTY-ON';
export const OFFLINE_CAMERA = 'CAM-DUTY-OFF';
export const DUTY_SHED = 'S01';
export const ONLINE_NAME = '值班在线镜头';
export const OFFLINE_NAME = '值班离线镜头';
export const ONLINE_NOTE = '值班看板在线';
export const OFFLINE_NOTE = '值班看板离线';
export const ALERT_TITLE = '值班看板告警';
export const ALERT_LEVEL = 'warning';
export const ALERT_MESSAGE = `棚区 ${DUTY_SHED} 摄像头 ${OFFLINE_CAMERA} 值班看板待确认`;
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
      shedCode: DUTY_SHED,
      note: OFFLINE_NOTE,
    };
  }
  return {
    code: ONLINE_CAMERA,
    name: ONLINE_NAME,
    type: 'camera',
    shedCode: DUTY_SHED,
    note: ONLINE_NOTE,
  };
}

export function alertBody() {
  return {
    shedCode: DUTY_SHED,
    cameraCode: OFFLINE_CAMERA,
    level: ALERT_LEVEL,
    title: ALERT_TITLE,
    message: ALERT_MESSAGE,
  };
}

export function buildOnlineHeartbeat(now = new Date()) {
  const fixture = readFixture(HEARTBEAT_FIXTURE);
  return {
    ...fixture.body,
    shedCode: DUTY_SHED,
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
    throw new Error('心跳 online 不是 true，这台不会显示在线');
  }
  if (value.shedCode !== DUTY_SHED) {
    throw new Error(`心跳棚区是 ${value.shedCode}，应为 ${DUTY_SHED}`);
  }
  return value;
}

function messageText(payload) {
  const inner = payload && typeof payload.message === 'object' ? payload.message : payload;
  const message = inner?.message ?? payload?.message ?? payload?.error;
  const text = Array.isArray(message)
    ? message.join('；')
    : typeof message === 'string'
      ? message
      : '';
  return text || '';
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

async function getPage(token, path, params) {
  const url = new URL(`${apiBase()}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  let response;
  try {
    response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  } catch (error) {
    throw new Error(`API 连不上（${url}）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`${path} 失败 ${response.status} ${messageText(body) || JSON.stringify(body)}`);
  }
  return body;
}

async function findDevice(token, code, extra = {}) {
  for (let page = 1; page <= 20; page += 1) {
    const body = await getPage(token, '/devices', { ...extra, page, pageSize: 100 });
    const items = Array.isArray(body.items) ? body.items : [];
    const found = items.find((row) => row && row.code === code);
    if (found) return found;
    const total = Number(body.total);
    if (!items.length || (Number.isFinite(total) && page * 100 >= total)) return null;
  }
  return null;
}

async function countOf(token, path, params) {
  const body = await getPage(token, path, { ...params, page: 1, pageSize: 1 });
  const total = Number(body.total);
  if (!Number.isInteger(total) || total < 0) {
    throw new Error(`${path} 没有可用的 total`);
  }
  return total;
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
  const device = await findDevice(token, body.code, { shedCode: DUTY_SHED });
  if (!device) throw new Error(`设备列表里没有 ${body.code}`);
  if (device.type !== 'camera' || device.shedCode !== DUTY_SHED) {
    throw new Error(`${body.code} 不是棚区 ${DUTY_SHED} 的摄像头`);
  }
  if (created && (device.name !== body.name || device.note !== body.note)) {
    throw new Error(`新建的 ${body.code} 名称或备注与登记请求不一致`);
  }
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
}

async function markOffline(token, device) {
  if (device.onlineStatus === 'offline') return { patched: false, device };
  let response;
  try {
    response = await fetch(`${apiBase()}/devices/${encodeURIComponent(device.id)}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ onlineStatus: 'offline' }),
    });
  } catch (error) {
    throw new Error(`API 连不上。先执行 make up、make migrate、make api。${error.message}`);
  }
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(`改离线失败 ${response.status} ${messageText(payload) || JSON.stringify(payload)}`);
  }
  const listed = await findDevice(token, OFFLINE_CAMERA, { online: 'offline' });
  if (!listed || listed.onlineStatus !== 'offline') {
    throw new Error(`${OFFLINE_CAMERA} 改完后仍不在离线列表`);
  }
  return { patched: true, device: listed };
}

async function findOpenAlert(token) {
  for (let page = 1; page <= 20; page += 1) {
    const body = await getPage(token, '/alerts', {
      status: 'open',
      cameraCode: OFFLINE_CAMERA,
      page,
      pageSize: 100,
    });
    const items = Array.isArray(body.items) ? body.items : [];
    const found = items.find((row) => row && row.title === ALERT_TITLE && row.status === 'open');
    if (found) return found;
    const total = Number(body.total);
    if (!items.length || (Number.isFinite(total) && page * 100 >= total)) return null;
  }
  return null;
}

async function ensureOpenAlert(token) {
  const existing = await findOpenAlert(token);
  if (existing) return { created: false, alert: existing };
  let response;
  try {
    response = await fetch(`${apiBase()}/alerts`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(alertBody()),
    });
  } catch (error) {
    throw new Error(`API 连不上（${apiBase()}/alerts）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const payload = await readJson(response);
  if (response.status !== 201 || !payload?.id) {
    throw new Error(`新建告警失败 ${response.status} ${messageText(payload) || JSON.stringify(payload)}`);
  }
  const listed = await findOpenAlert(token);
  if (!listed || listed.id !== payload.id) {
    throw new Error('新建的值班看板告警不在待确认列表里');
  }
  return { created: true, alert: listed };
}

export function assertDutySnapshot(snapshot) {
  const { onlineTotal, offlineTotal, openTotal, overview, onlineDevice, offlineDevice, alert } = snapshot;
  if (!Number.isInteger(onlineTotal) || onlineTotal < 1) {
    throw new Error(`在线设备数是 ${onlineTotal}，至少要有 1`);
  }
  if (!Number.isInteger(offlineTotal) || offlineTotal < 1) {
    throw new Error(`离线设备数是 ${offlineTotal}，至少要有 1`);
  }
  if (!Number.isInteger(openTotal) || openTotal < 1) {
    throw new Error(`待确认告警数是 ${openTotal}，至少要有 1`);
  }
  if (!overview || overview.deviceOnline !== onlineTotal) {
    throw new Error(`总览在线 ${overview?.deviceOnline}，设备列表在线 ${onlineTotal}`);
  }
  const offlineFromOverview = Number(overview.deviceTotal) - Number(overview.deviceOnline);
  if (offlineFromOverview !== offlineTotal) {
    throw new Error(`总览离线 ${offlineFromOverview}，设备列表离线 ${offlineTotal}`);
  }
  if (!onlineDevice || onlineDevice.code !== ONLINE_CAMERA || onlineDevice.onlineStatus !== 'online') {
    throw new Error(`在线列表里没有 ${ONLINE_CAMERA}`);
  }
  if (!offlineDevice || offlineDevice.code !== OFFLINE_CAMERA || offlineDevice.onlineStatus !== 'offline') {
    throw new Error(`离线列表里没有 ${OFFLINE_CAMERA}`);
  }
  if (!alert || alert.status !== 'open' || alert.title !== ALERT_TITLE) {
    throw new Error('待确认列表里没有「值班看板告警」');
  }
  if (alert.cameraCode !== OFFLINE_CAMERA || alert.shedCode !== DUTY_SHED) {
    throw new Error('值班看板告警的棚区或摄像头不对');
  }
  return snapshot;
}

export function formatDutyProof(result, webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const lines = [
    result.onlineCreated ? `登记 ${ONLINE_CAMERA}: 新建` : `登记 ${ONLINE_CAMERA}: 已有，未改档案`,
    `心跳: 已写入`,
    result.offlineCreated ? `登记 ${OFFLINE_CAMERA}: 新建` : `登记 ${OFFLINE_CAMERA}: 已有，未改档案`,
    result.patchedOffline ? `离线: 已改状态` : `离线: 本来就是离线`,
    result.alertCreated ? '告警: 新建' : '告警: 沿用待确认',
    `告警 id: ${result.alert.id}`,
    `在线设备: ${result.onlineTotal}`,
    `离线设备: ${result.offlineTotal}`,
    `待确认: ${result.openTotal}`,
    `值班看板: ${origin}/duty-screen`,
    `在线列表: ${origin}/devices?online=online`,
    `离线列表: ${origin}/devices?online=offline`,
    `告警列表: ${origin}/alerts?status=open`,
    `告警详情: ${origin}/alerts/${encodeURIComponent(result.alert.id)}`,
  ];
  return lines.join('\n');
}

export async function showDutyBoard({ now = new Date() } = {}) {
  const token = await login();
  const onlineReg = await registerCamera(token, 'online');
  const beat = buildOnlineHeartbeat(now);
  validateOnlineHeartbeat(beat);
  await postOnlineHeartbeat(beat);
  const onlineDevice = await findDevice(token, ONLINE_CAMERA, { online: 'online' });
  if (!onlineDevice || onlineDevice.onlineStatus !== 'online' || !onlineDevice.lastHeartbeatAt) {
    throw new Error(`${ONLINE_CAMERA} 心跳后不在在线列表，或没有最近心跳`);
  }
  const offlineReg = await registerCamera(token, 'offline');
  const offlineMarked = await markOffline(token, offlineReg.device);
  const alertEnsured = await ensureOpenAlert(token);
  const detail = await getPage(token, `/alerts/${encodeURIComponent(alertEnsured.alert.id)}`, {});
  const onlineTotal = await countOf(token, '/devices', { online: 'online' });
  const offlineTotal = await countOf(token, '/devices', { online: 'offline' });
  const openTotal = await countOf(token, '/alerts', { status: 'open' });
  const overview = await getPage(token, '/dashboard/overview', {});
  const snapshot = assertDutySnapshot({
    onlineTotal,
    offlineTotal,
    openTotal,
    overview,
    onlineDevice,
    offlineDevice: offlineMarked.device,
    alert: detail,
  });
  return {
    onlineCreated: onlineReg.created,
    offlineCreated: offlineReg.created,
    patchedOffline: offlineMarked.patched,
    alertCreated: alertEnsured.created,
    alert: snapshot.alert,
    onlineTotal: snapshot.onlineTotal,
    offlineTotal: snapshot.offlineTotal,
    openTotal: snapshot.openTotal,
  };
}

function usage() {
  return `用法:
  node scripts/demo-duty-board.mjs

登记 ${ONLINE_CAMERA} 并发一条在线心跳，保证 ${OFFLINE_CAMERA} 离线，再留下一条待确认告警。
步骤见 docs/DEMO_DUTY_BOARD.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await showDutyBoard();
    process.stdout.write(`${formatDutyProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
