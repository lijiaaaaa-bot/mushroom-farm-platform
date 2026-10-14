#!/usr/bin/env node
/**
 * 留下一条待确认告警和一条已关闭告警，再按状态筛选。
 * status=open 只有待确认；status=closed 只有已关闭；不带 status 时两条都在。
 * 关闭沿用 demo-close-one-alert 的备注「已关闭」，不改那条温度过高告警。
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { apiBase, repoRoot } from './lib/ingest-wire.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';
import { CLOSE_NOTE } from './demo-ack-close-alert.mjs';

const require = createRequire(import.meta.url);

export const STATUS_SHED = 'S01';
export const STATUS_LEVEL = 'warning';
export const OPEN_CAMERA = 'CAM-STATUS-01';
export const CLOSED_CAMERA = 'CAM-STATUS-02';
export const OPEN_STATUS = 'open';
export const CLOSED_STATUS = 'closed';

export const STATUS_ROWS = [
  {
    cameraCode: OPEN_CAMERA,
    title: '待确认筛选告警',
    status: OPEN_STATUS,
  },
  {
    cameraCode: CLOSED_CAMERA,
    title: '已关闭筛选告警',
    status: CLOSED_STATUS,
  },
];

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function alertMessage(cameraCode) {
  return `棚区 ${STATUS_SHED} 摄像头 ${cameraCode} 状态筛选演示`;
}

export function sameIdentity(row, spec) {
  return Boolean(
    row &&
      row.cameraCode === spec.cameraCode &&
      row.shedCode === STATUS_SHED &&
      row.title === spec.title,
  );
}

export function pickOpen(items) {
  const spec = STATUS_ROWS[0];
  return items.find((row) => sameIdentity(row, spec) && row.status === OPEN_STATUS) || null;
}

export function pickClosed(items) {
  const spec = STATUS_ROWS[1];
  return items.find((row) => sameIdentity(row, spec) && row.status === CLOSED_STATUS) || null;
}

export function pickClosable(items) {
  const spec = STATUS_ROWS[1];
  return (
    items.find(
      (row) =>
        sameIdentity(row, spec) && (row.status === OPEN_STATUS || row.status === 'acked'),
    ) || null
  );
}

function statusLabel(status) {
  if (status === OPEN_STATUS) return '待确认';
  if (status === CLOSED_STATUS) return '已关闭';
  return status;
}

export function assertOnlyStatus(items, status, requiredId, forbiddenId) {
  const label = statusLabel(status);
  if (!items.some((row) => row.id === requiredId && row.status === status)) {
    throw new Error(`筛选${label}后没有告警 ${requiredId}`);
  }
  if (forbiddenId && items.some((row) => row.id === forbiddenId)) {
    throw new Error(`筛选${label}后仍有另一条演示告警 ${forbiddenId}`);
  }
  const other = items.filter((row) => row.status !== status);
  if (other.length) {
    const seen = [...new Set(other.map((row) => statusLabel(row.status)))].join('、');
    throw new Error(`筛选${label}后仍有其他状态：${seen}`);
  }
}

export function assertBothPresent(items, ids) {
  const missing = ids.filter((id) => !items.some((row) => row.id === id));
  if (missing.length) throw new Error(`全部列表缺少 ${missing.join('、')}`);
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

async function login() {
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
  const session = await readJson(response);
  if (!response.ok || !session.accessToken) {
    throw new Error(`登录失败 ${response.status}。确认 API 已用种子账号启动。`);
  }
  return session.accessToken;
}

async function getPage(token, params) {
  const url = new URL(`${apiBase()}/alerts`);
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
    throw new Error(`告警列表失败 ${response.status} ${messageText(body) || JSON.stringify(body)}`);
  }
  if (!Array.isArray(body.items) || !Number.isFinite(Number(body.total))) {
    throw new Error('告警列表没有 items 或 total');
  }
  return { items: body.items, total: Number(body.total) };
}

export async function listAllAlerts(token, params, { maxPages = 20 } = {}) {
  const items = [];
  let total = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    const body = await getPage(token, { ...params, page: String(page), pageSize: '100' });
    total = body.total;
    items.push(...body.items);
    if (items.length >= total || body.items.length === 0) break;
  }
  if (items.length < total) {
    throw new Error(`告警列表超过 ${maxPages} 页，没有读完`);
  }
  return { items, total };
}

async function createAlert(token, spec) {
  const payload = {
    shedCode: STATUS_SHED,
    cameraCode: spec.cameraCode,
    level: STATUS_LEVEL,
    title: spec.title,
    message: alertMessage(spec.cameraCode),
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
  if (body.status !== OPEN_STATUS) {
    throw new Error(`新建告警的状态是 ${body.status}，应为待确认`);
  }
  return body;
}

async function closeAlert(token, id) {
  let response;
  try {
    response = await fetch(`${apiBase()}/alerts/${encodeURIComponent(id)}/close`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ note: CLOSE_NOTE }),
    });
  } catch (error) {
    throw new Error(`API 连不上（${apiBase()}）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`关闭失败 ${response.status} ${messageText(body) || JSON.stringify(body)}`);
  }
  if (body.status !== CLOSED_STATUS || body.closeNote !== CLOSE_NOTE) {
    throw new Error(`关闭后状态是 ${body.status || '空'}，备注是 ${body.closeNote || '空'}`);
  }
  return body;
}

export async function readAlert(token, id) {
  const response = await fetch(`${apiBase()}/alerts/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`告警详情失败 ${response.status} ${messageText(body) || JSON.stringify(body)}`);
  }
  return body;
}

export function assertDetail(detail, expected) {
  const missing = [];
  if (detail?.id !== expected.id) missing.push('id');
  if (detail?.status !== expected.status) missing.push('状态');
  if (detail?.cameraCode !== expected.cameraCode) missing.push('摄像头');
  if (detail?.shedCode !== STATUS_SHED) missing.push('棚区');
  if (detail?.title !== expected.title) missing.push('标题');
  if (!String(detail?.message || '').includes(expected.cameraCode)) missing.push('说明里的摄像头');
  if (missing.length) throw new Error(`告警详情缺少${missing.join('、')}`);
  return detail;
}

export function alertListUrl(webOrigin = webOriginFromEnv()) {
  return `${String(webOrigin).replace(/\/$/, '')}/alerts`;
}

export function statusListUrl(status, webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  return `${origin}/alerts?status=${encodeURIComponent(status)}`;
}

export function alertDetailUrl(id, status, webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  return `${origin}/alerts/${encodeURIComponent(id)}?status=${encodeURIComponent(status)}`;
}

function howLabel(row) {
  if (row.how === 'created' && row.status === CLOSED_STATUS) return '新建并关闭';
  if (row.how === 'created') return '新建';
  if (row.how === 'closed') return '关闭';
  return '沿用';
}

export function formatStatusProof({
  openRow,
  closedRow,
  openCount,
  closedCount,
  openDetail,
  closedDetail,
  webOrigin = webOriginFromEnv(),
}) {
  const labels = contracts();
  const lines = [
    '留下 2 条告警',
    `待确认: ${howLabel(openRow)} ${openRow.id}`,
    `已关闭: ${howLabel(closedRow)} ${closedRow.id}`,
    `筛选待确认条数: ${openCount}`,
    '筛选后已关闭: 无',
    '待确认详情可打开: 是',
    `待确认详情状态: ${labels.ALERT_STATUS_LABEL[openDetail.status] || openDetail.status}`,
    `筛选已关闭条数: ${closedCount}`,
    '筛选后待确认: 无',
    '已关闭详情可打开: 是',
    `已关闭详情状态: ${labels.ALERT_STATUS_LABEL[closedDetail.status] || closedDetail.status}`,
    '全部仍含这两条: 是',
    '登录: admin / Admin@123456',
    `告警列表: ${alertListUrl(webOrigin)}`,
    `待确认: ${statusListUrl(OPEN_STATUS, webOrigin)}`,
    `已关闭: ${statusListUrl(CLOSED_STATUS, webOrigin)}`,
    `待确认详情: ${alertDetailUrl(openDetail.id, OPEN_STATUS, webOrigin)}`,
    `已关闭详情: ${alertDetailUrl(closedDetail.id, CLOSED_STATUS, webOrigin)}`,
  ];
  return lines.join('\n');
}

export async function sendStatusFilterDemo() {
  const token = await login();
  const openSpec = STATUS_ROWS[0];
  const closedSpec = STATUS_ROWS[1];

  const openListed = await listAllAlerts(token, {
    shedCode: STATUS_SHED,
    cameraCode: openSpec.cameraCode,
  });
  const existingOpen = pickOpen(openListed.items);
  let openRow;
  if (existingOpen) {
    openRow = {
      ...openSpec,
      id: existingOpen.id,
      how: 'reused',
    };
  } else {
    const created = await createAlert(token, openSpec);
    openRow = { ...openSpec, id: created.id, how: 'created' };
  }

  const closedListed = await listAllAlerts(token, {
    shedCode: STATUS_SHED,
    cameraCode: closedSpec.cameraCode,
  });
  const existingClosed = pickClosed(closedListed.items);
  let closedRow;
  if (existingClosed) {
    closedRow = { ...closedSpec, id: existingClosed.id, how: 'reused' };
  } else {
    const closable = pickClosable(closedListed.items);
    const target = closable || (await createAlert(token, closedSpec));
    const closed = await closeAlert(token, target.id);
    closedRow = {
      ...closedSpec,
      id: closed.id,
      how: closable ? 'closed' : 'created',
    };
  }

  const openList = await listAllAlerts(token, { status: OPEN_STATUS });
  assertOnlyStatus(openList.items, OPEN_STATUS, openRow.id, closedRow.id);
  const closedList = await listAllAlerts(token, { status: CLOSED_STATUS });
  assertOnlyStatus(closedList.items, CLOSED_STATUS, closedRow.id, openRow.id);
  const openDetail = assertDetail(await readAlert(token, openRow.id), openRow);
  const closedDetail = assertDetail(await readAlert(token, closedRow.id), closedRow);
  const all = await listAllAlerts(token, { shedCode: STATUS_SHED });
  assertBothPresent(all.items, [openRow.id, closedRow.id]);
  const seen = new Set(
    all.items.filter((row) => row.id === openRow.id || row.id === closedRow.id).map((row) => row.status),
  );
  if (!seen.has(OPEN_STATUS) || !seen.has(CLOSED_STATUS)) {
    throw new Error('全部列表没有同时留下待确认和已关闭');
  }
  return {
    openRow,
    closedRow,
    openCount: openList.total,
    closedCount: closedList.total,
    openDetail,
    closedDetail,
  };
}

function usage() {
  return `用法:
  node scripts/demo-alert-status-filter.mjs

留下一条待确认和一条已关闭告警，并按状态筛选。步骤见 docs/DEMO_ALERT_STATUS_FILTER.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await sendStatusFilterDemo();
    process.stdout.write(`${formatStatusProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
