#!/usr/bin/env node
/**
 * 告警列表上的确认和关闭。
 * 留下一条待确认，供列表点「确认」再点「关闭」。
 * 另外一条只确认，一条先确认再关闭。
 * 不改 demo-one-alert、demo-ack-one-alert、demo-close-one-alert、demo-alert-status-filter。
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { apiBase, repoRoot } from './lib/ingest-wire.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';
import { ACK_NOTE, CLOSE_NOTE } from './demo-ack-close-alert.mjs';

const require = createRequire(import.meta.url);

export { ACK_NOTE, CLOSE_NOTE };

export const ACK_SHED = 'S01';
export const ACK_LEVEL = 'warning';
export const OPEN_CAMERA = 'CAM-ACK-01';
export const ACKED_CAMERA = 'CAM-ACK-02';
export const CLOSED_CAMERA = 'CAM-ACK-03';
export const OPEN_TITLE = '待确认操作告警';
export const ACKED_TITLE = '已确认操作告警';
export const CLOSED_TITLE = '已关闭操作告警';
export const OPEN_STATUS = 'open';
export const ACKED_STATUS = 'acked';
export const CLOSED_STATUS = 'closed';
export const AUTO_ACK_NOTE = '关闭时自动确认';

export const ACK_ROWS = [
  { cameraCode: OPEN_CAMERA, title: OPEN_TITLE, status: OPEN_STATUS },
  { cameraCode: ACKED_CAMERA, title: ACKED_TITLE, status: ACKED_STATUS },
  { cameraCode: CLOSED_CAMERA, title: CLOSED_TITLE, status: CLOSED_STATUS },
];

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

function specFor(status) {
  const spec = ACK_ROWS.find((row) => row.status === status);
  if (!spec) throw new Error(`没有状态 ${status} 的演示告警`);
  return spec;
}

export function alertMessage(cameraCode) {
  return `棚区 ${ACK_SHED} 摄像头 ${cameraCode} 确认关闭演示`;
}

export function sameIdentity(row, spec) {
  return Boolean(
    row &&
      row.cameraCode === spec.cameraCode &&
      row.shedCode === ACK_SHED &&
      row.title === spec.title,
  );
}

export function isWalkedClosed(row) {
  const spec = specFor(CLOSED_STATUS);
  return Boolean(
    sameIdentity(row, spec) &&
      row.status === CLOSED_STATUS &&
      row.ackNote === ACK_NOTE &&
      row.closeNote === CLOSE_NOTE &&
      row.closeReason === 'resolved',
  );
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

async function listAlerts(token, params, { maxPages = 20 } = {}) {
  const items = [];
  let total = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    const body = await getPage(token, { ...params, page: String(page), pageSize: '100' });
    total = body.total;
    items.push(...body.items);
    if (items.length >= total || body.items.length === 0) break;
  }
  if (items.length < total) throw new Error(`告警列表超过 ${maxPages} 页，没有读完`);
  return { items, total };
}

async function createAlert(token, spec) {
  const payload = {
    shedCode: ACK_SHED,
    cameraCode: spec.cameraCode,
    level: ACK_LEVEL,
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

async function postNote(token, id, action, note) {
  let response;
  try {
    response = await fetch(`${apiBase()}/alerts/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ note }),
    });
  } catch (error) {
    throw new Error(`API 连不上（${apiBase()}）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const body = await readJson(response);
  if (!response.ok) {
    const verb = action === 'ack' ? '确认' : '关闭';
    throw new Error(`${verb}失败 ${response.status} ${messageText(body) || JSON.stringify(body)}`);
  }
  return body;
}

async function ackAlert(token, id) {
  const body = await postNote(token, id, 'ack', ACK_NOTE);
  if (body.status !== ACKED_STATUS || body.ackNote !== ACK_NOTE) {
    throw new Error(`确认后状态是 ${body.status || '空'}，备注是 ${body.ackNote || '空'}`);
  }
  return body;
}

async function closeAfterAck(token, id) {
  const body = await postNote(token, id, 'close', CLOSE_NOTE);
  if (body.status !== CLOSED_STATUS || body.closeNote !== CLOSE_NOTE) {
    throw new Error(`关闭后状态是 ${body.status || '空'}，备注是 ${body.closeNote || '空'}`);
  }
  if (body.closeReason !== 'resolved') {
    throw new Error(`关闭原因是 ${body.closeReason || '空'}，应为 resolved`);
  }
  if (body.ackNote !== ACK_NOTE) {
    throw new Error(
      `关闭后确认备注是 ${body.ackNote || '空'}，应为 ${ACK_NOTE}。先确认再关闭，不能从待确认直接关。`,
    );
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

function requireRow(items, id, status) {
  const found = items.find((row) => row.id === id);
  if (!found) throw new Error(`列表里没有告警 ${id}`);
  if (found.status !== status) throw new Error(`告警 ${id} 的状态是 ${found.status}，应为 ${status}`);
  return found;
}

function requireAbsent(items, id) {
  if (items.some((row) => row.id === id)) throw new Error(`列表里不该还有告警 ${id}`);
}

async function listed(token, cameraCode, status) {
  const params = { shedCode: ACK_SHED, cameraCode };
  if (status) params.status = status;
  return listAlerts(token, params);
}

export function alertListUrl(webOrigin = webOriginFromEnv()) {
  return `${String(webOrigin).replace(/\/$/, '')}/alerts`;
}

function howLabel(row) {
  if (row.how === 'walked') return '先确认再关闭';
  if (row.how === 'created' && row.status === ACKED_STATUS) return '新建并确认';
  if (row.how === 'created') return '新建';
  if (row.how === 'acked') return '确认';
  if (row.how === 'closed') return '关闭';
  return '沿用';
}

export function formatAlertAckProof({
  openRow,
  ackedRow,
  closedRow,
  openDetail,
  ackedDetail,
  closedDetail,
  webOrigin = webOriginFromEnv(),
}) {
  const labels = contracts();
  const reason = labels.ALERT_CLOSE_REASON_LABEL[closedDetail.closeReason] || closedDetail.closeReason;
  const lines = [
    '确认关闭演示留下 3 条告警',
    `待确认: ${howLabel(openRow)} ${openRow.id}`,
    `已确认: ${howLabel(ackedRow)} ${ackedRow.id}`,
    `已关闭: ${howLabel(closedRow)} ${closedRow.id}`,
    `待确认标题: ${openDetail.title}`,
    `待确认摄像头: ${OPEN_CAMERA}`,
    `待确认状态: ${labels.ALERT_STATUS_LABEL[openDetail.status] || openDetail.status}`,
    `已确认标题: ${ackedDetail.title}`,
    `已确认摄像头: ${ACKED_CAMERA}`,
    `已确认状态: ${labels.ALERT_STATUS_LABEL[ackedDetail.status] || ackedDetail.status}`,
    `已确认备注: ${ackedDetail.ackNote}`,
    `已关闭标题: ${closedDetail.title}`,
    `已关闭摄像头: ${CLOSED_CAMERA}`,
    '走查: 待确认 → 已确认 → 已关闭',
    `已关闭状态: ${labels.ALERT_STATUS_LABEL[closedDetail.status] || closedDetail.status}`,
    `确认备注: ${closedDetail.ackNote}`,
    `关闭备注: ${closedDetail.closeNote}`,
    `关闭原因: ${reason}`,
    '登录: admin / Admin@123456',
    `告警列表: ${alertListUrl(webOrigin)}`,
    '状态下拉保持「全部」。点「待确认操作告警」这一行的「确认」，状态变为已确认；再点「关闭」，状态变为已关闭。',
  ];
  return lines.join('\n');
}

async function ensureOpen(token) {
  const spec = specFor(OPEN_STATUS);
  const listedOpen = await listed(token, spec.cameraCode, OPEN_STATUS);
  const existing = listedOpen.items.find((row) => sameIdentity(row, spec) && row.status === OPEN_STATUS);
  if (existing) return { ...spec, id: existing.id, how: 'reused' };
  const created = await createAlert(token, spec);
  return { ...spec, id: created.id, how: 'created' };
}

async function ensureAcked(token) {
  const spec = specFor(ACKED_STATUS);
  const all = await listed(token, spec.cameraCode);
  const existing = all.items.find(
    (row) => sameIdentity(row, spec) && row.status === ACKED_STATUS && row.ackNote === ACK_NOTE,
  );
  if (existing) return { ...spec, id: existing.id, how: 'reused' };
  const open = all.items.find((row) => sameIdentity(row, spec) && row.status === OPEN_STATUS);
  const target = open || (await createAlert(token, spec));
  const acked = await ackAlert(token, target.id);
  const after = await listed(token, spec.cameraCode, ACKED_STATUS);
  requireRow(after.items, acked.id, ACKED_STATUS);
  const stillOpen = await listed(token, spec.cameraCode, OPEN_STATUS);
  requireAbsent(stillOpen.items, acked.id);
  return { ...spec, id: acked.id, how: open ? 'acked' : 'created' };
}

async function ensureWalkedClosed(token) {
  const spec = specFor(CLOSED_STATUS);
  const all = await listed(token, spec.cameraCode);
  const existing = all.items.find((row) => isWalkedClosed(row));
  if (existing) return { ...spec, id: existing.id, how: 'reused' };
  const acked = all.items.find(
    (row) => sameIdentity(row, spec) && row.status === ACKED_STATUS && row.ackNote === ACK_NOTE,
  );
  if (acked) {
    const closed = await closeAfterAck(token, acked.id);
    const after = await listed(token, spec.cameraCode, CLOSED_STATUS);
    requireRow(after.items, closed.id, CLOSED_STATUS);
    requireAbsent((await listed(token, spec.cameraCode, OPEN_STATUS)).items, closed.id);
    requireAbsent((await listed(token, spec.cameraCode, ACKED_STATUS)).items, closed.id);
    return { ...spec, id: closed.id, how: 'closed' };
  }
  const open = all.items.find((row) => sameIdentity(row, spec) && row.status === OPEN_STATUS);
  const target = open || (await createAlert(token, spec));
  const ackedBody = await ackAlert(token, target.id);
  requireRow((await listed(token, spec.cameraCode, ACKED_STATUS)).items, ackedBody.id, ACKED_STATUS);
  requireAbsent((await listed(token, spec.cameraCode, OPEN_STATUS)).items, ackedBody.id);
  const closed = await closeAfterAck(token, ackedBody.id);
  requireRow((await listed(token, spec.cameraCode, CLOSED_STATUS)).items, closed.id, CLOSED_STATUS);
  requireAbsent((await listed(token, spec.cameraCode, OPEN_STATUS)).items, closed.id);
  requireAbsent((await listed(token, spec.cameraCode, ACKED_STATUS)).items, closed.id);
  return { ...spec, id: closed.id, how: 'walked' };
}

function assertOpenDetail(detail, row) {
  if (detail?.id !== row.id) throw new Error('待确认详情 id 不对');
  if (detail.status !== OPEN_STATUS) throw new Error(`待确认详情状态是 ${detail.status}`);
  if (detail.cameraCode !== OPEN_CAMERA) throw new Error(`待确认摄像头是 ${detail.cameraCode}`);
  if (detail.title !== OPEN_TITLE) throw new Error(`待确认标题是 ${detail.title}`);
  if (detail.shedCode !== ACK_SHED) throw new Error(`待确认棚区是 ${detail.shedCode}`);
  return detail;
}

function assertAckedDetail(detail, row) {
  if (detail?.id !== row.id) throw new Error('已确认详情 id 不对');
  if (detail.status !== ACKED_STATUS) throw new Error(`已确认详情状态是 ${detail.status}`);
  if (detail.ackNote !== ACK_NOTE) throw new Error(`已确认备注是 ${detail.ackNote || '空'}`);
  if (detail.cameraCode !== ACKED_CAMERA) throw new Error(`已确认摄像头是 ${detail.cameraCode}`);
  if (detail.title !== ACKED_TITLE) throw new Error(`已确认标题是 ${detail.title}`);
  if (detail.closeReason) throw new Error('已确认不该有关闭原因');
  return detail;
}

function assertClosedDetail(detail, row) {
  if (!isWalkedClosed({ ...detail, cameraCode: detail.cameraCode, shedCode: detail.shedCode, title: detail.title })) {
    throw new Error('已关闭详情不是先确认再关闭');
  }
  if (detail.id !== row.id) throw new Error('已关闭详情 id 不对');
  if (detail.ackNote === AUTO_ACK_NOTE) throw new Error('已关闭的确认备注不该是关闭时自动确认');
  return detail;
}

export async function sendAlertAckDemo() {
  const token = await login();
  const openRow = await ensureOpen(token);
  const ackedRow = await ensureAcked(token);
  const closedRow = await ensureWalkedClosed(token);
  if (openRow.id === ackedRow.id || openRow.id === closedRow.id || ackedRow.id === closedRow.id) {
    throw new Error('三条演示告警 id 撞在一起');
  }
  requireRow((await listed(token, OPEN_CAMERA, OPEN_STATUS)).items, openRow.id, OPEN_STATUS);
  requireAbsent((await listed(token, OPEN_CAMERA, ACKED_STATUS)).items, openRow.id);
  requireAbsent((await listed(token, OPEN_CAMERA, CLOSED_STATUS)).items, openRow.id);
  requireRow((await listed(token, ACKED_CAMERA, ACKED_STATUS)).items, ackedRow.id, ACKED_STATUS);
  requireAbsent((await listed(token, ACKED_CAMERA, CLOSED_STATUS)).items, ackedRow.id);
  requireRow((await listed(token, CLOSED_CAMERA, CLOSED_STATUS)).items, closedRow.id, CLOSED_STATUS);
  requireAbsent((await listed(token, CLOSED_CAMERA, OPEN_STATUS)).items, closedRow.id);
  requireAbsent((await listed(token, CLOSED_CAMERA, ACKED_STATUS)).items, closedRow.id);
  const openDetail = assertOpenDetail(await readAlert(token, openRow.id), openRow);
  const ackedDetail = assertAckedDetail(await readAlert(token, ackedRow.id), ackedRow);
  const closedDetail = assertClosedDetail(await readAlert(token, closedRow.id), closedRow);
  return { openRow, ackedRow, closedRow, openDetail, ackedDetail, closedDetail };
}

function usage() {
  return `用法:
  node scripts/demo-alert-ack.mjs

留下待确认、已确认、已关闭各一条。已关闭是先确认再关闭。步骤见 docs/DEMO_ALERT_ACK.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await sendAlertAckDemo();
    process.stdout.write(`${formatAlertAckProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
