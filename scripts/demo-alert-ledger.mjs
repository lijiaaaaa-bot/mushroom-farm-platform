#!/usr/bin/env node
/**
 * 留下棚区 S01 的待确认和已关闭告警各一条，核对告警闭环台账预览和 xlsx。
 * 同标题同状态已在则沿用。关闭走 POST /alerts/:id/close。
 * 不发识别，不改园区生长报表演示，不改接入观测。
 */
import { inflateRawSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { apiBase } from './lib/ingest-wire.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';

export const LEDGER_SHED = 'S01';
export const LEDGER_LEVEL = 'warning';
export const OPEN_CAMERA = 'CAM-ALED-OPEN';
export const CLOSED_CAMERA = 'CAM-ALED-CLOSED';
export const OPEN_TITLE = '台账待确认告警';
export const CLOSED_TITLE = '台账已关闭告警';
export const OPEN_STATUS = 'open';
export const CLOSED_STATUS = 'closed';
export const CLOSE_NOTE = '台账关闭';
export const CLOSE_REASON = 'resolved';
export const DEMO_KIND = 'alerts';
export const SHEET_PREVIEW = '告警闭环';
export const SHEET_ALERTS = '告警';

function messageText(payload) {
  const message = payload?.message ?? payload?.error;
  if (Array.isArray(message)) return message.join('；');
  if (typeof message === 'string') return message;
  return '';
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

function shanghaiDate(value) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

export function coveringRange(instants) {
  const days = [...new Set(instants.map((value) => shanghaiDate(new Date(value))))].sort();
  if (!days.length || days.some((day) => !/^\d{4}-\d{2}-\d{2}$/.test(day))) {
    throw new Error('没有可覆盖两条告警的日期');
  }
  return { from: days[0], to: days[days.length - 1] };
}

export function previewSearch(range, { status = '', shedCode = LEDGER_SHED } = {}) {
  const params = {
    kind: DEMO_KIND,
    from: range.from,
    to: range.to,
    shedCode,
  };
  if (status) params.status = status;
  return params;
}

export function reportPageUrl(range, { status = '', shedCode = LEDGER_SHED, webOrigin = webOriginFromEnv() } = {}) {
  const origin = String(webOrigin).replace(/\/$/, '');
  return `${origin}/reports?${new URLSearchParams(previewSearch(range, { status, shedCode }))}`;
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

async function listByTitle(token, title) {
  const items = [];
  let total = 0;
  for (let page = 1; page <= 20; page += 1) {
    const body = await getPage(token, {
      shedCode: LEDGER_SHED,
      q: title,
      page: String(page),
      pageSize: '100',
    });
    total = body.total;
    items.push(...body.items);
    if (items.length >= total || body.items.length === 0) break;
  }
  if (items.length < total) throw new Error('告警列表超过 20 页，没有读完');
  return items.filter((row) => row.title === title && row.shedCode === LEDGER_SHED);
}

function alertMessage(cameraCode) {
  return `棚区 ${LEDGER_SHED} 摄像头 ${cameraCode} 告警闭环台账`;
}

async function createAlert(token, cameraCode, title) {
  const payload = {
    shedCode: LEDGER_SHED,
    cameraCode,
    level: LEDGER_LEVEL,
    title,
    message: alertMessage(cameraCode),
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
  if (body.status !== OPEN_STATUS || body.title !== title || body.cameraCode !== cameraCode) {
    throw new Error(`新建告警不是待确认的 ${title}`);
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
  if (body.status !== CLOSED_STATUS || body.closeNote !== CLOSE_NOTE || body.closeReason !== CLOSE_REASON) {
    throw new Error(
      `关闭后状态是 ${body.status || '空'}，备注是 ${body.closeNote || '空'}，原因是 ${body.closeReason || '空'}`,
    );
  }
  return body;
}

export async function readAlert(token, id) {
  let response;
  try {
    response = await fetch(`${apiBase()}/alerts/${encodeURIComponent(id)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (error) {
    throw new Error(`API 连不上（${apiBase()}）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`告警详情失败 ${response.status} ${messageText(body) || JSON.stringify(body)}`);
  }
  return body;
}

function pick(items, status, cameraCode) {
  return (
    items.find((row) => row.status === status && row.cameraCode === cameraCode) ||
    items.find((row) => row.status === status) ||
    null
  );
}

async function ensureOpen(token) {
  const items = await listByTitle(token, OPEN_TITLE);
  const existing = pick(items, OPEN_STATUS, OPEN_CAMERA);
  if (existing) return { row: existing, how: 'reused' };
  const created = await createAlert(token, OPEN_CAMERA, OPEN_TITLE);
  return { row: created, how: 'created' };
}

async function ensureClosed(token) {
  const items = await listByTitle(token, CLOSED_TITLE);
  const existing = pick(items, CLOSED_STATUS, CLOSED_CAMERA);
  if (existing) return { row: existing, how: 'reused' };
  const closable = items.find((row) => row.status === OPEN_STATUS || row.status === 'acked');
  const target = closable || (await createAlert(token, CLOSED_CAMERA, CLOSED_TITLE));
  const closed = await closeAlert(token, target.id);
  return { row: closed, how: closable ? 'closed' : 'created' };
}

export function assertLedgerPreview(body, { range, shedCode = LEDGER_SHED, required, forbiddenTitles, onlyStatus }) {
  if (body?.kind !== DEMO_KIND || body?.title !== SHEET_PREVIEW) {
    throw new Error(`预览不是告警闭环（${body?.kind || '空'} / ${body?.title || '空'}）`);
  }
  if (body.from !== range.from || body.to !== range.to) {
    throw new Error(`预览日期是 ${body.from || '空'} 至 ${body.to || '空'}，不是 ${range.from} 至 ${range.to}`);
  }
  if ((body.shedCode || null) !== shedCode) {
    throw new Error(`预览棚区是 ${body.shedCode || '全部'}，不是 ${shedCode}`);
  }
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (onlyStatus) {
    const other = rows.filter((row) => row?.status !== onlyStatus);
    if (other.length) throw new Error(`预览仍有其他状态 ${other.map((row) => row.status).join('、')}`);
  }
  for (const spec of required) {
    const hit = rows.find(
      (row) =>
        row?.title === spec.title &&
        row?.cameraCode === spec.cameraCode &&
        row?.status === spec.status &&
        row?.shedCode === LEDGER_SHED,
    );
    if (!hit) throw new Error(`预览没有 ${spec.title}`);
    if (spec.status === CLOSED_STATUS && !hit.closeReason) {
      throw new Error('已关闭行没有关闭原因');
    }
  }
  for (const title of forbiddenTitles) {
    if (rows.some((row) => row?.title === title)) throw new Error(`预览仍有 ${title}`);
  }
  return { count: rows.length };
}

export function readZipEntries(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error('导出的文件不是 xlsx');
  }
  const entries = [];
  let offset = 0;
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const method = bytes.readUInt16LE(offset + 8);
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const nameLen = bytes.readUInt16LE(offset + 26);
    const extraLen = bytes.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = bytes.slice(nameStart, nameStart + nameLen).toString('utf8');
    const dataStart = nameStart + nameLen + extraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) throw new Error('xlsx 不完整');
    let text = '';
    if (name.endsWith('.xml')) {
      const compressed = bytes.slice(dataStart, dataEnd);
      const raw = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : null;
      if (raw) text = raw.toString('utf8');
    }
    entries.push({ name, text });
    offset = dataEnd;
  }
  if (!entries.some((entry) => entry.name === 'xl/workbook.xml')) {
    throw new Error('xlsx 里没有工作簿');
  }
  return entries;
}

export function assertAlertWorkbook(buffer, { sheetName, requiredText, forbiddenText = [] }) {
  const entries = readZipEntries(buffer);
  const sheet = entries.find((entry) => entry.name === 'xl/worksheets/sheet1.xml');
  const shared = entries.find((entry) => entry.name === 'xl/sharedStrings.xml');
  const book = entries.find((entry) => entry.name === 'xl/workbook.xml');
  const text = `${book?.text || ''}\n${sheet?.text || ''}\n${shared?.text || ''}`;
  const rows = sheet?.text ? (sheet.text.match(/<row[\s>]/g) || []).length : 0;
  if (rows < 2) throw new Error('xlsx 工作表没有数据行');
  if (!text.includes(sheetName)) throw new Error(`xlsx 工作表名称不是${sheetName}`);
  for (const piece of requiredText) {
    if (!text.includes(piece)) throw new Error(`xlsx 里没有 ${piece}`);
  }
  for (const piece of forbiddenText) {
    if (text.includes(piece)) throw new Error(`xlsx 里仍有 ${piece}`);
  }
  return { bytes: Buffer.byteLength(buffer), rows, sheetName };
}

async function downloadWorkbook(token, url, filename, check) {
  let response;
  try {
    response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  } catch (error) {
    throw new Error(`API 连不上（${url}）。先执行 make up、make migrate、make api。${error.message}`);
  }
  if (!response.ok) {
    const body = await readJson(response);
    throw new Error(`导出失败 ${response.status} ${messageText(body) || JSON.stringify(body)}`);
  }
  const type = response.headers.get('content-type') || '';
  if (!type.includes('spreadsheetml.sheet')) {
    throw new Error(`导出响应不是 xlsx（${type || '无类型'}）`);
  }
  const disposition = response.headers.get('content-disposition') || '';
  if (!disposition.includes(filename)) {
    throw new Error(`导出文件名不是 ${filename}（${disposition || '无文件名'}）`);
  }
  return check(Buffer.from(await response.arrayBuffer()));
}

function howLabel(how, status) {
  if (how === 'created' && status === CLOSED_STATUS) return '新建并关闭';
  if (how === 'created') return '新建';
  if (how === 'closed') return '关闭';
  return '沿用';
}

export function formatLedgerProof({
  openRow,
  closedRow,
  openHow,
  closedHow,
  range,
  allCount,
  openCount,
  closedCount,
  workbook,
  alertsBook,
  webOrigin = webOriginFromEnv(),
}) {
  const lines = [
    '留下 2 条告警',
    `待确认: ${howLabel(openHow, OPEN_STATUS)} ${openRow.id}`,
    `已关闭: ${howLabel(closedHow, CLOSED_STATUS)} ${closedRow.id}`,
    `棚区: ${LEDGER_SHED}`,
    `待确认摄像头: ${openRow.cameraCode}  标题: ${OPEN_TITLE}`,
    `已关闭摄像头: ${closedRow.cameraCode}  标题: ${CLOSED_TITLE}`,
    `关闭备注: ${closedRow.closeNote || CLOSE_NOTE}`,
    `关闭原因: ${closedRow.closeReason}`,
    `预览: ${SHEET_PREVIEW} ${range.from} 至 ${range.to}`,
    `全部行数: ${allCount}`,
    `待确认行数: ${openCount}`,
    `已关闭行数: ${closedCount}`,
    `xlsx: ${workbook.bytes} 字节，工作表 ${workbook.sheetName}，${workbook.rows} 行`,
    `alerts.xlsx: ${alertsBook.bytes} 字节，工作表 ${alertsBook.sheetName}`,
    '登录: admin / Admin@123456',
    `预览（全部）: ${reportPageUrl(range, { webOrigin })}`,
    `预览（待确认）: ${reportPageUrl(range, { status: OPEN_STATUS, webOrigin })}`,
    `预览（已关闭）: ${reportPageUrl(range, { status: CLOSED_STATUS, webOrigin })}`,
  ];
  return lines.join('\n');
}

export async function sendAlertLedgerDemo() {
  const token = await login();
  const openKept = await ensureOpen(token);
  const closedKept = await ensureClosed(token);
  const openDetail = await readAlert(token, openKept.row.id);
  const closedDetail = await readAlert(token, closedKept.row.id);
  if (openDetail.status !== OPEN_STATUS || openDetail.title !== OPEN_TITLE) {
    throw new Error('待确认告警详情对不上');
  }
  if (closedDetail.status !== CLOSED_STATUS || closedDetail.title !== CLOSED_TITLE) {
    throw new Error('已关闭告警详情对不上');
  }
  if (!closedDetail.closeReason) throw new Error('已关闭告警没有关闭原因');
  if (closedKept.how !== 'reused') {
    if (closedDetail.closeNote !== CLOSE_NOTE || closedDetail.closeReason !== CLOSE_REASON) {
      throw new Error('这次关闭的备注或原因不对');
    }
  }
  if (!openDetail.createdAt || !closedDetail.createdAt) throw new Error('告警没有创建时间');
  const range = coveringRange([openDetail.createdAt, closedDetail.createdAt]);
  const all = assertLedgerPreview(await getPreview(token, previewSearch(range)), {
    range,
    required: [openDetail, closedDetail],
    forbiddenTitles: [],
  });
  const openPreview = assertLedgerPreview(await getPreview(token, previewSearch(range, { status: OPEN_STATUS })), {
    range,
    required: [openDetail],
    forbiddenTitles: [CLOSED_TITLE],
    onlyStatus: OPEN_STATUS,
  });
  const closedPreview = assertLedgerPreview(
    await getPreview(token, previewSearch(range, { status: CLOSED_STATUS })),
    {
      range,
      required: [closedDetail],
      forbiddenTitles: [OPEN_TITLE],
      onlyStatus: CLOSED_STATUS,
    },
  );
  if (openPreview.count >= all.count) {
    throw new Error(`待确认 ${openPreview.count} 行，不少于全部 ${all.count} 行`);
  }
  if (closedPreview.count >= all.count) {
    throw new Error(`已关闭 ${closedPreview.count} 行，不少于全部 ${all.count} 行`);
  }
  const closedParams = previewSearch(range, { status: CLOSED_STATUS });
  const exportUrl = new URL(`${apiBase()}/reports/export.xlsx`);
  for (const [key, value] of Object.entries(closedParams)) {
    if (value) exportUrl.searchParams.set(key, String(value));
  }
  const workbook = await downloadWorkbook(token, exportUrl, 'export.xlsx', (bytes) =>
    assertAlertWorkbook(bytes, {
      sheetName: SHEET_PREVIEW,
      requiredText: [closedDetail.title, closedDetail.cameraCode],
      forbiddenText: [OPEN_TITLE],
    }),
  );
  const alertsBook = await downloadWorkbook(token, `${apiBase()}/reports/alerts.xlsx`, 'alerts.xlsx', (bytes) =>
    assertAlertWorkbook(bytes, {
      sheetName: SHEET_ALERTS,
      requiredText: [closedDetail.title, closedDetail.cameraCode],
    }),
  );
  return {
    openRow: openDetail,
    closedRow: closedDetail,
    openHow: openKept.how,
    closedHow: closedKept.how,
    range,
    allCount: all.count,
    openCount: openPreview.count,
    closedCount: closedPreview.count,
    workbook,
    alertsBook,
  };
}

async function getPreview(token, params) {
  const url = new URL(`${apiBase()}/reports/preview`);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, String(value));
  }
  let response;
  try {
    response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  } catch (error) {
    throw new Error(`API 连不上（${url}）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`报表预览失败 ${response.status} ${messageText(body) || JSON.stringify(body)}`);
  }
  return body;
}

function usage() {
  return `用法:
  node scripts/demo-alert-ledger.mjs

留下待确认和已关闭各一条告警，打开告警闭环台账并下载 xlsx。步骤见 docs/DEMO_ALERT_LEDGER.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await sendAlertLedgerDemo();
    process.stdout.write(`${formatLedgerProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
