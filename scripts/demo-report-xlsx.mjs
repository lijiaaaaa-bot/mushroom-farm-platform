#!/usr/bin/env node
/**
 * 写入一条识别，让园区生长预览出现 S02 的行，并下载 export.xlsx。
 * 样例文件里的 CAM-DEMO-01 不改。不确认、不关闭告警。
 */
import { inflateRawSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  apiBase,
  fixtureFile,
  ingestRecognitionUrl,
  ingestToken,
  postJson,
  readFixture,
  repoRoot,
  withRuntimeClock,
} from './lib/ingest-wire.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';

const require = createRequire(import.meta.url);

export const DEMO_FIXTURE = 'recognition.demo-one.json';
export const DEMO_KIND = 'growth';
export const DEMO_GRAIN = 'day';
export const DEMO_SHED = 'S02';
export const DEMO_CAMERA = 'CAM-RPT-01';
export const DEMO_MUSHROOM = 17;
export const DEMO_MATURE = 9;
export const FIXTURE_CAMERA = 'CAM-DEMO-01';

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function reportDay(now = new Date()) {
  return contracts().todayShanghai(now);
}

export function buildReportPayload(now = new Date()) {
  const fixture = readFixture(DEMO_FIXTURE);
  const body = withRuntimeClock({ ...fixture.body }, now);
  body.shedCode = DEMO_SHED;
  body.cameraCode = DEMO_CAMERA;
  body.mushroomCount = DEMO_MUSHROOM;
  body.matureCount = DEMO_MATURE;
  body.idempotencyKey = `demo-report-xlsx-${now.getTime()}`;
  return body;
}

export function validateReportPayload(body, now = new Date()) {
  const parsed = contracts().parseRecognitionIngress(body, now);
  if (!parsed.ok) {
    throw new Error(`样例未通过契约：${parsed.errors.join('；')}`);
  }
  const value = parsed.value;
  if (value.shedCode !== DEMO_SHED) throw new Error(`棚区是 ${value.shedCode}，应为 ${DEMO_SHED}`);
  if (value.cameraCode !== DEMO_CAMERA) {
    throw new Error(`摄像头是 ${value.cameraCode}，应为 ${DEMO_CAMERA}`);
  }
  if (value.mushroomCount !== DEMO_MUSHROOM) {
    throw new Error(`蘑菇数量是 ${value.mushroomCount}，应为 ${DEMO_MUSHROOM}`);
  }
  if (value.matureCount !== DEMO_MATURE) {
    throw new Error(`成熟数量是 ${value.matureCount}，应为 ${DEMO_MATURE}`);
  }
  const onDisk = JSON.parse(readFileSync(fixtureFile(DEMO_FIXTURE), 'utf8'));
  if (onDisk.body.cameraCode !== FIXTURE_CAMERA) {
    throw new Error(`样例文件摄像头被改成 ${onDisk.body.cameraCode}`);
  }
  return value;
}

export function previewSearch(day, shedCode = DEMO_SHED) {
  const params = {
    kind: DEMO_KIND,
    grain: DEMO_GRAIN,
    from: day,
    to: day,
  };
  if (shedCode) params.shedCode = shedCode;
  return params;
}

export function reportPageUrl(day, { shedCode = DEMO_SHED, webOrigin = webOriginFromEnv() } = {}) {
  const origin = String(webOrigin).replace(/\/$/, '');
  return `${origin}/reports?${new URLSearchParams(previewSearch(day, shedCode))}`;
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

function nested(payload, key) {
  return payload?.[key] ?? payload?.message?.[key];
}

async function postRecognition(body) {
  let posted;
  try {
    posted = await postJson(ingestRecognitionUrl(), JSON.stringify(body), {
      'content-type': 'application/json',
      'x-ingest-token': ingestToken(),
    });
  } catch (error) {
    throw new Error(
      `API 连不上（${ingestRecognitionUrl()}）。先执行 make up、make migrate、make api。${error.message}`,
    );
  }
  const payload = posted.responseBody;
  const accepted = nested(payload, 'accepted') === true;
  const id = nested(payload, 'id');
  if (posted.responseStatus < 200 || posted.responseStatus >= 300 || !accepted || !id) {
    throw new Error(`接入拒绝 ${posted.responseStatus} ${messageText(payload) || JSON.stringify(payload)}`);
  }
  return { id, duplicate: Boolean(nested(payload, 'duplicate')) };
}

async function listByCamera(token, cameraCode) {
  const url = `${apiBase()}/ingest/recognitions?cameraCode=${encodeURIComponent(cameraCode)}&pageSize=50`;
  let response;
  try {
    response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  } catch (error) {
    throw new Error(`API 连不上（${url}）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`识别列表失败 ${response.status} ${messageText(body) || JSON.stringify(body)}`);
  }
  return Array.isArray(body.items) ? body.items : [];
}

export async function findRecognition(token, body, { id, timeoutMs = 3000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const items = await listByCamera(token, body.cameraCode);
    const found = items.find((row) => {
      if (id && row.id === id) return true;
      return row.idempotencyKey === body.idempotencyKey;
    });
    if (found) {
      if (found.shedCode !== DEMO_SHED || found.cameraCode !== DEMO_CAMERA) {
        throw new Error(`识别记录棚区或摄像头不是 ${DEMO_SHED} / ${DEMO_CAMERA}`);
      }
      if (Number(found.mushroomCount) !== DEMO_MUSHROOM || Number(found.matureCount) !== DEMO_MATURE) {
        throw new Error(
          `识别记录蘑菇数量 ${found.mushroomCount}、成熟数量 ${found.matureCount}，不是 ${DEMO_MUSHROOM} / ${DEMO_MATURE}`,
        );
      }
      return found;
    }
    if (Date.now() + 400 > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`识别列表里没有 ${DEMO_CAMERA}`);
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

export function assertGrowthPreview(body, { day, shedFilter, mushroom, mature, onlyShed }) {
  if (body?.kind !== DEMO_KIND || body?.title !== '园区生长') {
    throw new Error(`预览不是园区生长（${body?.kind || '空'} / ${body?.title || '空'}）`);
  }
  if (body.grain !== DEMO_GRAIN) throw new Error(`预览粒度是 ${body.grain || '空'}，应为 ${DEMO_GRAIN}`);
  if (body.from !== day || body.to !== day) {
    throw new Error(`预览日期是 ${body.from || '空'} 至 ${body.to || '空'}，不是 ${day}`);
  }
  const echoed = body.shedCode || null;
  if (echoed !== shedFilter) {
    throw new Error(`预览棚区筛选是 ${echoed || '全部'}，不是 ${shedFilter || '全部'}`);
  }
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) throw new Error('预览没有行');
  if (onlyShed) {
    const other = rows.filter((row) => row?.shedCode !== DEMO_SHED);
    if (other.length) throw new Error('只看 S02 时预览仍有其他棚区');
  }
  const row = rows.find((item) => item?.shedCode === DEMO_SHED && item?.period === day);
  if (!row) throw new Error(`预览没有棚区 ${DEMO_SHED} 在 ${day} 的行`);
  const mushroomCount = Number(row.mushroomCount);
  const matureCount = Number(row.matureCount);
  if (!Number.isFinite(mushroomCount) || mushroomCount < mushroom) {
    throw new Error(`蘑菇数量是 ${row.mushroomCount}，应至少 ${mushroom}`);
  }
  if (!Number.isFinite(matureCount) || matureCount < mature) {
    throw new Error(`成熟数量是 ${row.matureCount}，应至少 ${mature}`);
  }
  return { row, count: rows.length };
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

export function assertWorkbook(buffer) {
  const entries = readZipEntries(buffer);
  const sheet = entries.find((entry) => entry.name === 'xl/worksheets/sheet1.xml');
  const shared = entries.find((entry) => entry.name === 'xl/sharedStrings.xml');
  const book = entries.find((entry) => entry.name === 'xl/workbook.xml');
  const text = `${book?.text || ''}\n${sheet?.text || ''}\n${shared?.text || ''}`;
  const rows = sheet?.text ? (sheet.text.match(/<row[\s>]/g) || []).length : 0;
  if (rows < 2) throw new Error('xlsx 工作表没有数据行');
  if (!text.includes('园区生长')) throw new Error('xlsx 工作表名称不是园区生长');
  if (!text.includes(DEMO_SHED)) throw new Error(`xlsx 里没有棚区 ${DEMO_SHED}`);
  return { bytes: Buffer.byteLength(buffer), rows };
}

async function downloadExport(token, params) {
  const url = new URL(`${apiBase()}/reports/export.xlsx`);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, String(value));
  }
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
  if (!disposition.includes('export.xlsx')) {
    throw new Error(`导出文件名不是 export.xlsx（${disposition || '无文件名'}）`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return assertWorkbook(bytes);
}

export function formatReportProof({
  id,
  duplicate,
  day,
  filteredCount,
  allCount,
  workbook,
  webOrigin = webOriginFromEnv(),
}) {
  const lines = [
    '写入 1 条识别',
    `id: ${id}`,
    `重复: ${duplicate ? '是' : '否'}`,
    `棚区: ${DEMO_SHED}`,
    `摄像头: ${DEMO_CAMERA}`,
    `蘑菇数量: ${DEMO_MUSHROOM}  成熟数量: ${DEMO_MATURE}`,
    `预览: 园区生长 ${day}`,
    `只看 ${DEMO_SHED} 的行数: ${filteredCount}`,
    `全部棚的行数: ${allCount}`,
    `xlsx: ${workbook.bytes} 字节，工作表 ${workbook.rows} 行`,
    '登录: admin / Admin@123456',
    `预览（${DEMO_SHED}）: ${reportPageUrl(day, { shedCode: DEMO_SHED, webOrigin })}`,
    `预览（全部棚）: ${reportPageUrl(day, { shedCode: '', webOrigin })}`,
  ];
  return lines.join('\n');
}

export async function sendReportXlsxDemo(now = new Date()) {
  const body = buildReportPayload(now);
  validateReportPayload(body, now);
  const posted = await postRecognition(body);
  const token = await login();
  await findRecognition(token, body, { id: posted.id });
  const day = reportDay(now);
  const filtered = assertGrowthPreview(await getPreview(token, previewSearch(day, DEMO_SHED)), {
    day,
    shedFilter: DEMO_SHED,
    mushroom: DEMO_MUSHROOM,
    mature: DEMO_MATURE,
    onlyShed: true,
  });
  const all = assertGrowthPreview(await getPreview(token, previewSearch(day, '')), {
    day,
    shedFilter: null,
    mushroom: DEMO_MUSHROOM,
    mature: DEMO_MATURE,
    onlyShed: false,
  });
  if (all.count < filtered.count) {
    throw new Error(`全部棚 ${all.count} 行，少于只看 ${DEMO_SHED} 的 ${filtered.count} 行`);
  }
  const workbook = await downloadExport(token, previewSearch(day, DEMO_SHED));
  return {
    id: posted.id,
    duplicate: posted.duplicate,
    day,
    filteredCount: filtered.count,
    allCount: all.count,
    workbook,
    body,
  };
}

function usage() {
  return `用法:
  node scripts/demo-report-xlsx.mjs

写入 ${DEMO_CAMERA} 的识别，打开园区生长预览，并下载 xlsx。步骤见 docs/DEMO_REPORT_XLSX.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await sendReportXlsxDemo();
    process.stdout.write(`${formatReportProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
