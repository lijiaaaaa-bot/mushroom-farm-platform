#!/usr/bin/env node
/**
 * 留下两台设备，各一条告警，再按设备 id 筛选。
 * 设备 A 的列表只有 A；设备 B 的列表只有 B；不带 deviceId 时两条都在。
 * 摄像头编号、状态筛选仍可用。不发识别，不确认，不关闭。
 */
import { pathToFileURL } from 'node:url';
import { apiBase } from './lib/ingest-wire.mjs';
import { login } from './demo-register-and-ingest.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';

export const DEVICE_SHED = 'S01';
export const DEVICE_LEVEL = 'warning';
export const TITLE_QUERY = '设备告警';
export const EAST_CAMERA = 'CAM-DEVF-01';
export const WEST_CAMERA = 'CAM-DEVF-02';
export const EAST_NAME = '东侧设备';
export const WEST_NAME = '西侧设备';
export const EAST_NOTE = '按设备筛选东侧';
export const WEST_NOTE = '按设备筛选西侧';
export const EAST_TITLE = '东侧设备告警';
export const WEST_TITLE = '西侧设备告警';

export const DEVICE_SPECS = [
  {
    code: EAST_CAMERA,
    name: EAST_NAME,
    note: EAST_NOTE,
    title: EAST_TITLE,
    side: 'east',
  },
  {
    code: WEST_CAMERA,
    name: WEST_NAME,
    note: WEST_NOTE,
    title: WEST_TITLE,
    side: 'west',
  },
];

export function deviceBody(spec) {
  return {
    code: spec.code,
    name: spec.name,
    type: 'camera',
    shedCode: DEVICE_SHED,
    note: spec.note,
  };
}

export function alertMessage(cameraCode) {
  return `棚区 ${DEVICE_SHED} 摄像头 ${cameraCode} 按设备筛选`;
}

export function pickReusable(items, spec) {
  return (
    items.find(
      (row) =>
        row &&
        row.cameraCode === spec.code &&
        row.shedCode === DEVICE_SHED &&
        row.title === spec.title &&
        row.status === 'open',
    ) || null
  );
}

export function assertDeviceRows(items, { code, requiredId, forbiddenIds = [] }) {
  if (!items.some((row) => row.id === requiredId)) {
    throw new Error(`按设备筛选后没有告警 ${requiredId}`);
  }
  for (const id of forbiddenIds) {
    if (items.some((row) => row.id === id)) {
      throw new Error(`按设备筛选后仍有另一台设备的告警 ${id}`);
    }
  }
  const stray = items.filter(
    (row) => row.cameraCode !== code && row.sensorCode !== code,
  );
  if (stray.length) {
    const codes = [...new Set(stray.map((row) => row.cameraCode || row.sensorCode || '（空）'))].join('、');
    throw new Error(`按设备 ${code} 筛选后仍有其他设备：${codes}`);
  }
}

export function assertBothPresent(items, ids) {
  const missing = ids.filter((id) => !items.some((row) => row.id === id));
  if (missing.length) throw new Error(`未按设备筛选的列表缺少 ${missing.join('、')}`);
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

async function getPage(token, path, params) {
  const url = new URL(`${apiBase()}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
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
  if (!Array.isArray(body.items) || !Number.isFinite(Number(body.total))) {
    throw new Error(`${path} 没有 items 或 total`);
  }
  return { items: body.items, total: Number(body.total) };
}

async function listAll(token, path, params, { maxPages = 20 } = {}) {
  const items = [];
  let total = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    const body = await getPage(token, path, { ...params, page: String(page), pageSize: '100' });
    total = body.total;
    items.push(...body.items);
    if (items.length >= total || body.items.length === 0) break;
  }
  if (items.length < total) {
    throw new Error(`${path} 超过 ${maxPages} 页，没有读完`);
  }
  return { items, total };
}

export async function listAllDevices(token) {
  return listAll(token, '/devices', {});
}

export async function listAllAlerts(token, params) {
  return listAll(token, '/alerts', params);
}

async function ensureDevice(token, spec) {
  let response;
  try {
    response = await fetch(`${apiBase()}/devices`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(deviceBody(spec)),
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
      `登记 ${spec.code} 失败 ${response.status} ${messageText(payload) || JSON.stringify(payload)}`,
    );
  }
  if (created) {
    if (!payload.id || payload.code !== spec.code || payload.shedCode !== DEVICE_SHED) {
      throw new Error(`新建 ${spec.code} 的档案与请求不一致`);
    }
    return { created: true, device: payload };
  }
  const listed = await listAllDevices(token);
  const found = listed.items.find((row) => row && row.code === spec.code);
  if (!found?.id) throw new Error(`设备列表里没有已存在的 ${spec.code}`);
  if (found.shedCode !== DEVICE_SHED) {
    throw new Error(`${spec.code} 在棚区 ${found.shedCode || '空'}。这一刀用 ${DEVICE_SHED}，不改已有档案。`);
  }
  return { created: false, device: found };
}

async function createAlert(token, spec) {
  const payload = {
    shedCode: DEVICE_SHED,
    cameraCode: spec.code,
    level: DEVICE_LEVEL,
    title: spec.title,
    message: alertMessage(spec.code),
  };
  let response;
  try {
    response = await fetch(`${apiBase()}/alerts`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new Error(`API 连不上（${apiBase()}/alerts）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const body = await readJson(response);
  if (response.status < 200 || response.status >= 300 || !body.id) {
    throw new Error(`新建告警失败 ${response.status} ${messageText(body) || JSON.stringify(body)}`);
  }
  if (body.cameraCode !== spec.code || body.title !== spec.title) {
    throw new Error(`新建告警的摄像头是 ${body.cameraCode || '（空）'}，标题是 ${body.title || '（空）'}`);
  }
  return body;
}

export function listUrl(deviceId, webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const params = new URLSearchParams();
  if (deviceId) params.set('deviceId', deviceId);
  params.set('q', TITLE_QUERY);
  return `${origin}/alerts?${params.toString()}`;
}

export function formatDeviceProof({
  devices,
  alerts,
  eastCount,
  westCount,
  allCount,
  webOrigin = webOriginFromEnv(),
}) {
  const east = devices.find((row) => row.code === EAST_CAMERA);
  const west = devices.find((row) => row.code === WEST_CAMERA);
  const lines = [
    `留下 ${devices.length} 台设备`,
    ...devices.map(
      (row) => `${row.code}: ${row.created ? '新建' : '已有，未改档案'} ${row.id}`,
    ),
    `留下 ${alerts.length} 条告警`,
    ...alerts.map(
      (row) => `${row.title}: ${row.created ? '新建' : '沿用'} ${row.id}`,
    ),
    `设备A条数: ${eastCount}`,
    `设备B条数: ${westCount}`,
    `全部条数: ${allCount}`,
    '设备A不含西侧: 是',
    '设备B不含东侧: 是',
    '全部含两台: 是',
    '摄像头编号仍可筛: 是',
    '待确认仍可叠加: 是',
    '状态下拉: 全部',
    '登录: admin / Admin@123456',
    `全部列表: ${listUrl('', webOrigin)}`,
    `设备A列表: ${listUrl(east.id, webOrigin)}`,
    `设备B列表: ${listUrl(west.id, webOrigin)}`,
  ];
  return lines.join('\n');
}

export async function sendDeviceFilterDemo() {
  const token = await login();
  const devices = [];
  for (const spec of DEVICE_SPECS) {
    const ensured = await ensureDevice(token, spec);
    devices.push({
      code: spec.code,
      title: spec.title,
      side: spec.side,
      id: ensured.device.id,
      created: ensured.created,
    });
  }
  const alerts = [];
  for (const spec of DEVICE_SPECS) {
    const listed = await listAllAlerts(token, {
      shedCode: DEVICE_SHED,
      cameraCode: spec.code,
      q: spec.title,
    });
    const existing = pickReusable(listed.items, spec);
    if (existing) {
      alerts.push({
        code: spec.code,
        title: spec.title,
        id: existing.id,
        created: false,
      });
      continue;
    }
    const created = await createAlert(token, spec);
    alerts.push({
      code: spec.code,
      title: spec.title,
      id: created.id,
      created: true,
    });
  }
  const eastDevice = devices.find((row) => row.code === EAST_CAMERA);
  const westDevice = devices.find((row) => row.code === WEST_CAMERA);
  const eastAlert = alerts.find((row) => row.code === EAST_CAMERA);
  const westAlert = alerts.find((row) => row.code === WEST_CAMERA);
  const shared = { q: TITLE_QUERY };
  const eastList = await listAllAlerts(token, { ...shared, deviceId: eastDevice.id });
  const westList = await listAllAlerts(token, { ...shared, deviceId: westDevice.id });
  const allList = await listAllAlerts(token, shared);
  assertDeviceRows(eastList.items, {
    code: EAST_CAMERA,
    requiredId: eastAlert.id,
    forbiddenIds: [westAlert.id],
  });
  assertDeviceRows(westList.items, {
    code: WEST_CAMERA,
    requiredId: westAlert.id,
    forbiddenIds: [eastAlert.id],
  });
  assertBothPresent(allList.items, [eastAlert.id, westAlert.id]);
  if (!(eastList.total < allList.total && westList.total < allList.total)) {
    throw new Error(
      `按设备筛选后的条数没有少于全部（全部 ${allList.total}，设备A ${eastList.total}，设备B ${westList.total}）`,
    );
  }
  const byCamera = await listAllAlerts(token, { ...shared, cameraCode: EAST_CAMERA });
  assertDeviceRows(byCamera.items, {
    code: EAST_CAMERA,
    requiredId: eastAlert.id,
    forbiddenIds: [westAlert.id],
  });
  const openEast = await listAllAlerts(token, {
    ...shared,
    deviceId: eastDevice.id,
    status: 'open',
  });
  assertDeviceRows(openEast.items, {
    code: EAST_CAMERA,
    requiredId: eastAlert.id,
    forbiddenIds: [westAlert.id],
  });
  return {
    devices,
    alerts,
    eastCount: eastList.total,
    westCount: westList.total,
    allCount: allList.total,
  };
}

function usage() {
  return `用法:
  node scripts/demo-alert-by-device.mjs

留下 ${EAST_CAMERA} 与 ${WEST_CAMERA} 各一条告警，并按设备 id 筛选。步骤见 docs/DEMO_ALERT_BY_DEVICE.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await sendDeviceFilterDemo();
    process.stdout.write(`${formatDeviceProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
