#!/usr/bin/env node
/**
 * 登记六台设备：摄像头、AI 盒子、传感器各一台在线、一台离线。
 * 总览和基地大屏按类型读出在线/总数。
 * 心跳形状参考 heartbeat.http.json，该文件仍是 EDGE-SIM-BOX / ai_box，本命令不改文件。
 * 不发识别。不改值班看板页面，也不改 deviceOnline / deviceTotal 的口径。
 * 对照 CAM-DOT-NONE、BOX-DOT-NONE、SENSOR-DOT-NONE 不登记。
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { apiBase, ingestToken, postJson, readFixture, repoRoot } from './lib/ingest-wire.mjs';
import { login } from './demo-register-and-ingest.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';

const require = createRequire(import.meta.url);

export const HEARTBEAT_FIXTURE = 'heartbeat.http.json';
export const EXPECTED_CLEAN_NOTE = '摄像头 1/6 · AI盒子 1/4 · 传感器 1/4';

export const SEED_DEVICES = [
  { code: 'BOX-01', type: 'ai_box' },
  { code: 'CAM-S01-01', type: 'camera' },
  { code: 'CAM-S01-02', type: 'camera' },
  { code: 'SENSOR-S01', type: 'sensor' },
  { code: 'BOX-02', type: 'ai_box' },
  { code: 'CAM-S02-01', type: 'camera' },
  { code: 'SENSOR-S02', type: 'sensor' },
  { code: 'CAM-S03-01', type: 'camera' },
];

export const DEMO_DEVICES = [
  {
    code: 'CAM-DOT-01',
    name: '分类型在线镜头',
    type: 'camera',
    shedCode: 'S01',
    note: '分类型在线',
    online: true,
  },
  {
    code: 'CAM-DOT-02',
    name: '分类型离线镜头',
    type: 'camera',
    shedCode: 'S01',
    note: '分类型离线',
    online: false,
  },
  {
    code: 'BOX-DOT-01',
    name: '分类型在线盒子',
    type: 'ai_box',
    shedCode: 'S01',
    note: '分类型在线',
    online: true,
  },
  {
    code: 'BOX-DOT-02',
    name: '分类型离线盒子',
    type: 'ai_box',
    shedCode: 'S02',
    note: '分类型离线',
    online: false,
  },
  {
    code: 'SENSOR-DOT-01',
    name: '分类型在线传感器',
    type: 'sensor',
    shedCode: 'S01',
    note: '分类型在线',
    online: true,
  },
  {
    code: 'SENSOR-DOT-02',
    name: '分类型离线传感器',
    type: 'sensor',
    shedCode: 'S02',
    note: '分类型离线',
    online: false,
  },
];

export const CONTRAST_CODES = ['CAM-DOT-NONE', 'BOX-DOT-NONE', 'SENSOR-DOT-NONE'];

export const EXPECTED_CLEAN = {
  cameraOnline: 1,
  cameraTotal: 6,
  aiBoxOnline: 1,
  aiBoxTotal: 4,
  sensorOnline: 1,
  sensorTotal: 4,
};

const COUNT_KEYS = Object.keys(EXPECTED_CLEAN);

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function deviceBody(row) {
  return {
    code: row.code,
    name: row.name,
    type: row.type,
    shedCode: row.shedCode,
    note: row.note,
  };
}

export function buildOnlineHeartbeat(row, now = new Date()) {
  const fixture = readFixture(HEARTBEAT_FIXTURE);
  return {
    ...fixture.body,
    shedCode: row.shedCode,
    deviceCode: row.code,
    deviceType: row.type,
    online: true,
    reportedAt: now.toISOString(),
  };
}

export function validateOnlineHeartbeats(now = new Date()) {
  const fixture = readFixture(HEARTBEAT_FIXTURE);
  if (fixture.body.deviceCode !== 'EDGE-SIM-BOX' || fixture.body.deviceType !== 'ai_box') {
    throw new Error('heartbeat.http.json 被改掉了。本命令只改本次请求。');
  }
  const online = DEMO_DEVICES.filter((row) => row.online);
  if (online.length !== 3) throw new Error('应有三台在线演示设备');
  for (const row of online) {
    const body = buildOnlineHeartbeat(row, now);
    const parsed = contracts().parseHeartbeatIngress(body);
    if (!parsed.ok) throw new Error(`心跳未通过契约：${parsed.errors.join('；')}`);
    if (parsed.value.deviceCode !== row.code) {
      throw new Error(`心跳设备编号是 ${parsed.value.deviceCode}，应为 ${row.code}`);
    }
    if (parsed.value.deviceType !== row.type) {
      throw new Error(`心跳设备类型是 ${parsed.value.deviceType || '空'}，应为 ${row.type}`);
    }
    if (parsed.value.online !== true) throw new Error(`${row.code} 的心跳 online 不是 true`);
    if (parsed.value.shedCode !== row.shedCode) {
      throw new Error(`心跳棚区是 ${parsed.value.shedCode}，应为 ${row.shedCode}`);
    }
    if (body.deviceCode === 'EDGE-SIM-BOX') {
      throw new Error('心跳仍是夹具里的 EDGE-SIM-BOX。本命令只改本次请求，不改 heartbeat.http.json。');
    }
  }
  return online.map((row) => buildOnlineHeartbeat(row, now));
}

function sameCounts(left, right) {
  return COUNT_KEYS.every((key) => left[key] === right[key]);
}

export function assertOverviewDeviceOnline(overview, devices) {
  const lib = contracts();
  const rows = Array.isArray(devices) ? devices : [];
  const parsed = lib.parseDeviceOnlineByType(overview);
  if (!parsed.ok) throw new Error(`总览分类型在线未通过契约：${parsed.errors.join('；')}`);
  for (const row of DEMO_DEVICES) {
    const found = rows.find((item) => item && item.code === row.code);
    if (!found) throw new Error(`设备列表里没有 ${row.code}`);
    if (found.type !== row.type) {
      throw new Error(`${row.code} 的类型是 ${found.type || '空'}，应为 ${row.type}`);
    }
    const online = found.onlineStatus === 'online';
    if (online !== row.online) {
      throw new Error(`${row.code} 的 onlineStatus 是 ${found.onlineStatus || '空'}`);
    }
  }
  for (const code of CONTRAST_CODES) {
    if (rows.some((item) => item && item.code === code)) {
      throw new Error(`${code} 不该被登记。本命令不写对照编号。`);
    }
  }
  const fromList = lib.countDevicesOnlineByType(rows);
  const value = parsed.value;
  for (const key of COUNT_KEYS) {
    if (value[key] !== fromList[key]) {
      throw new Error(`总览 ${key} 是 ${value[key]}，设备列表算出 ${fromList[key]}`);
    }
  }
  const onlineSum = value.cameraOnline + value.aiBoxOnline + value.sensorOnline;
  const totalSum = value.cameraTotal + value.aiBoxTotal + value.sensorTotal;
  if (typeof overview?.deviceOnline === 'number' && overview.deviceOnline !== onlineSum) {
    throw new Error(`总在线 ${overview.deviceOnline} 与分类型在线之和 ${onlineSum} 不一致`);
  }
  if (typeof overview?.deviceTotal === 'number' && overview.deviceTotal !== totalSum) {
    throw new Error(`设备总数 ${overview.deviceTotal} 与分类型总数之和 ${totalSum} 不一致`);
  }
  const allowed = new Set([...SEED_DEVICES.map((row) => row.code), ...DEMO_DEVICES.map((row) => row.code)]);
  const seedOffline = SEED_DEVICES.every((seed) => {
    const found = rows.find((item) => item && item.code === seed.code);
    return found && found.type === seed.type && found.onlineStatus === 'offline';
  });
  const onlyKnown = rows.length === allowed.size && rows.every((item) => allowed.has(item.code));
  const clean = seedOffline && onlyKnown;
  if (clean && !sameCounts(value, EXPECTED_CLEAN)) {
    throw new Error(`干净库存应为 ${EXPECTED_CLEAN_NOTE}`);
  }
  if (value.cameraOnline < 1 || value.aiBoxOnline < 1 || value.sensorOnline < 1) {
    throw new Error('摄像头、AI盒子、传感器应各至少一台在线');
  }
  if (value.cameraTotal <= value.cameraOnline || value.aiBoxTotal <= value.aiBoxOnline || value.sensorTotal <= value.sensorOnline) {
    throw new Error('三种类型都应有离线设备，在线数应小于总数');
  }
  return {
    counts: value,
    clean,
    note: lib.formatDeviceOnlineByTypeNote(value),
  };
}

export function screenUrls(webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  return {
    overview: `${origin}/`,
    screen: `${origin}/big-screen`,
  };
}

export function formatDeviceOnlineByTypeProof({ counts, clean = false, webOrigin = webOriginFromEnv() }) {
  const pages = screenUrls(webOrigin);
  const lines = DEMO_DEVICES.map(
    (row) => `${row.code}（${row.shedCode}）: ${row.online ? '在线' : '离线'}`,
  );
  lines.push(`对照 ${CONTRAST_CODES.join('、')}: 未登记`);
  lines.push(`干净库存: ${EXPECTED_CLEAN_NOTE}`);
  lines.push(
    clean
      ? '库存只有种子设备和这六台，种子设备仍是离线'
      : '库里还有别的设备，或种子设备不是离线，旁注按全园同一口径变',
  );
  lines.push('口径: 全园设备档案。在线是 onlineStatus=online，总数含离线。停用仍计入。');
  lines.push('不改值班看板。值班看板仍读 deviceOnline 与 deviceTotal。');
  lines.push('登录: admin / Admin@123456');
  lines.push(`总览: ${pages.overview}`);
  lines.push(`大屏: ${pages.screen}`);
  return [contracts().formatDeviceOnlineByTypeNote(counts), ...lines].join('\n');
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

async function listAllDevices(token) {
  const items = [];
  let page = 1;
  let total = Number.POSITIVE_INFINITY;
  while (items.length < total && page <= 20) {
    const url = `${apiBase()}/devices?pageSize=100&page=${page}`;
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
    const batch = Array.isArray(body.items) ? body.items : [];
    total = Number(body.total);
    items.push(...batch);
    if (!batch.length) break;
    page += 1;
  }
  if (!Number.isFinite(total) || items.length < total) {
    throw new Error(`设备列表没有取全，已读 ${items.length}，共 ${total}`);
  }
  return items;
}

async function registerDevice(token, row) {
  const body = deviceBody(row);
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
    throw new Error(`登记 ${row.code} 失败 ${response.status} ${messageText(payload) || JSON.stringify(payload)}`);
  }
  return { created };
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
  if (code && code !== body.deviceCode) {
    throw new Error(`心跳写入的设备编号是 ${code}，应为 ${body.deviceCode}`);
  }
}

async function markOffline(token, device, row) {
  const patch = {};
  if (device.onlineStatus !== 'offline') patch.onlineStatus = 'offline';
  if (device.type !== row.type) patch.type = row.type;
  if (device.shedCode !== row.shedCode) patch.shedCode = row.shedCode;
  if (!Object.keys(patch).length) return { patched: false };
  let response;
  try {
    response = await fetch(`${apiBase()}/devices/${encodeURIComponent(device.id)}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify(patch),
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

async function getOverview(token) {
  const url = `${apiBase()}/dashboard/overview`;
  let response;
  try {
    response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  } catch (error) {
    throw new Error(`API 连不上（${url}）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const body = await readJson(response);
  if (!response.ok) throw new Error(`总览失败 ${response.status} ${messageText(body) || JSON.stringify(body)}`);
  return body;
}

export async function showDeviceOnlineByType({ now = new Date() } = {}) {
  const beats = validateOnlineHeartbeats(now);
  const token = await login();
  for (const row of DEMO_DEVICES) {
    await registerDevice(token, row);
  }
  for (const body of beats) {
    await postOnlineHeartbeat(body);
  }
  let listed = await listAllDevices(token);
  for (const row of DEMO_DEVICES.filter((item) => !item.online)) {
    const found = listed.find((item) => item.code === row.code);
    if (!found) throw new Error(`登记后列表里没有 ${row.code}`);
    await markOffline(token, found, row);
  }
  listed = await listAllDevices(token);
  const overview = await getOverview(token);
  return assertOverviewDeviceOnline(overview, listed);
}

function usage() {
  return `用法:
  node scripts/demo-device-online-by-type.mjs

登记 CAM-DOT-01、BOX-DOT-01、SENSOR-DOT-01 并各 POST 一次在线心跳，保证 CAM-DOT-02、BOX-DOT-02、SENSOR-DOT-02 离线。
再读全园设备列表和 GET /dashboard/overview。干净库存旁注是 ${EXPECTED_CLEAN_NOTE}。
不发识别。不改 heartbeat.http.json。步骤见 docs/DEMO_DEVICE_ONLINE_BY_TYPE.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await showDeviceOnlineByType();
    process.stdout.write(`${formatDeviceOnlineByTypeProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
