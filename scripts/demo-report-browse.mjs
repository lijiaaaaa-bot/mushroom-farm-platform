#!/usr/bin/env node
/**
 * 写入 S01 与 S02 各一条识别，让园区生长预览的全部棚比只看 S02 行更多，并下载 export.xlsx。
 * 样例文件里的 CAM-DEMO-01 不改。不确认、不关闭告警。不改接入观测。
 */
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
import { previewSearch, readZipEntries, reportDay, reportPageUrl } from './demo-report-xlsx.mjs';

const require = createRequire(import.meta.url);

export const DEMO_FIXTURE = 'recognition.demo-one.json';
export const FIXTURE_CAMERA = 'CAM-DEMO-01';
export const NARROW_SHED = 'S02';
export const BROWSE_ROWS = [
  { shedCode: 'S01', cameraCode: 'CAM-RB-S01', mushroomCount: 11, matureCount: 4 },
  { shedCode: 'S02', cameraCode: 'CAM-RB-S02', mushroomCount: 17, matureCount: 9 },
];

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function browseKey(shedCode, now = new Date()) {
  return `demo-report-browse-${shedCode}-${reportDay(now)}`;
}

export function buildBrowsePayload(spec, now = new Date()) {
  const fixture = readFixture(DEMO_FIXTURE);
  const body = withRuntimeClock({ ...fixture.body }, now);
  body.shedCode = spec.shedCode;
  body.cameraCode = spec.cameraCode;
  body.mushroomCount = spec.mushroomCount;
  body.matureCount = spec.matureCount;
  body.idempotencyKey = browseKey(spec.shedCode, now);
  return body;
}

export function validateBrowsePayload(body, spec, now = new Date()) {
  const parsed = contracts().parseRecognitionIngress(body, now);
  if (!parsed.ok) {
    throw new Error(`样例未通过契约：${parsed.errors.join('；')}`);
  }
  const value = parsed.value;
  if (value.shedCode !== spec.shedCode) throw new Error(`棚区是 ${value.shedCode}，应为 ${spec.shedCode}`);
  if (value.cameraCode !== spec.cameraCode) {
    throw new Error(`摄像头是 ${value.cameraCode}，应为 ${spec.cameraCode}`);
  }
  if (value.mushroomCount !== spec.mushroomCount) {
    throw new Error(`蘑菇数量是 ${value.mushroomCount}，应为 ${spec.mushroomCount}`);
  }
  if (value.matureCount !== spec.matureCount) {
    throw new Error(`成熟数量是 ${value.matureCount}，应为 ${spec.matureCount}`);
  }
  const onDisk = JSON.parse(readFileSync(fixtureFile(DEMO_FIXTURE), 'utf8'));
  if (onDisk.body.cameraCode !== FIXTURE_CAMERA) {
    throw new Error(`样例文件摄像头被改成 ${onDisk.body.cameraCode}`);
  }
  return value;
}

export function exportUrl(day, shedCode = NARROW_SHED) {
  const url = new URL(`${apiBase()}/reports/export.xlsx`);
  for (const [key, value] of Object.entries(previewSearch(day, shedCode))) {
    if (value) url.searchParams.set(key, String(value));
  }
  return url.toString();
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

async function findRecognition(token, body, spec, { id, timeoutMs = 3000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const items = await listByCamera(token, body.cameraCode);
    const found = items.find((row) => {
      if (id && row.id === id) return true;
      return row.idempotencyKey === body.idempotencyKey;
    });
    if (found) {
      if (found.shedCode !== spec.shedCode || found.cameraCode !== spec.cameraCode) {
        throw new Error(`识别记录棚区或摄像头不是 ${spec.shedCode} / ${spec.cameraCode}`);
      }
      if (Number(found.mushroomCount) !== spec.mushroomCount || Number(found.matureCount) !== spec.matureCount) {
        throw new Error(
          `识别记录蘑菇数量 ${found.mushroomCount}、成熟数量 ${found.matureCount}，不是 ${spec.mushroomCount} / ${spec.matureCount}`,
        );
      }
      return found;
    }
    if (Date.now() + 400 > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`识别列表里没有 ${spec.cameraCode}`);
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

export function assertBrowsePreview(body, { day, shedFilter, specs, onlyShed }) {
  if (body?.kind !== 'growth' || body?.title !== '园区生长') {
    throw new Error(`预览不是园区生长（${body?.kind || '空'} / ${body?.title || '空'}）`);
  }
  if (body.grain !== 'day') throw new Error(`预览粒度是 ${body.grain || '空'}，应为 day`);
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
    const other = rows.filter((row) => row?.shedCode !== onlyShed);
    if (other.length) throw new Error(`只看 ${onlyShed} 时预览仍有其他棚区`);
  }
  for (const spec of specs) {
    const row = rows.find((item) => item?.shedCode === spec.shedCode && item?.period === day);
    if (!row) throw new Error(`预览没有棚区 ${spec.shedCode} 在 ${day} 的行`);
    const mushroomCount = Number(row.mushroomCount);
    const matureCount = Number(row.matureCount);
    if (!Number.isFinite(mushroomCount) || mushroomCount < spec.mushroomCount) {
      throw new Error(`棚区 ${spec.shedCode} 蘑菇数量是 ${row.mushroomCount}，应至少 ${spec.mushroomCount}`);
    }
    if (!Number.isFinite(matureCount) || matureCount < spec.matureCount) {
      throw new Error(`棚区 ${spec.shedCode} 成熟数量是 ${row.matureCount}，应至少 ${spec.matureCount}`);
    }
  }
  return { count: rows.length, rows };
}

export function assertBrowseWorkbook(buffer, { requireSheds = [], forbidSheds = [] } = {}) {
  const entries = readZipEntries(buffer);
  const sheet = entries.find((entry) => entry.name === 'xl/worksheets/sheet1.xml');
  const shared = entries.find((entry) => entry.name === 'xl/sharedStrings.xml');
  const book = entries.find((entry) => entry.name === 'xl/workbook.xml');
  const text = `${book?.text || ''}\n${sheet?.text || ''}\n${shared?.text || ''}`;
  const rows = sheet?.text ? (sheet.text.match(/<row[\s>]/g) || []).length : 0;
  if (rows < 2) throw new Error('xlsx 工作表没有数据行');
  if (!text.includes('园区生长')) throw new Error('xlsx 工作表名称不是园区生长');
  for (const shed of requireSheds) {
    if (!text.includes(shed)) throw new Error(`xlsx 里没有棚区 ${shed}`);
  }
  for (const shed of forbidSheds) {
    if (text.includes(shed)) throw new Error(`xlsx 里仍有棚区 ${shed}`);
  }
  return { bytes: Buffer.byteLength(buffer), rows };
}

async function downloadExport(token, params, expect) {
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
  return assertBrowseWorkbook(bytes, expect);
}

export function formatBrowseProof({
  posted,
  day,
  wideCount,
  narrowCount,
  workbook,
  webOrigin = webOriginFromEnv(),
}) {
  const lines = [
    `写入 ${posted.length} 条识别`,
    ...posted.map(
      (row) =>
        `${row.spec.shedCode} ${row.spec.cameraCode} 蘑菇 ${row.spec.mushroomCount} 成熟 ${row.spec.matureCount} id: ${row.id} 重复: ${row.duplicate ? '是' : '否'}`,
    ),
    `预览: 园区生长 ${day}`,
    `全部棚行数: ${wideCount}`,
    `只看 ${NARROW_SHED} 行数: ${narrowCount}`,
    `xlsx: ${workbook.bytes} 字节，工作表 ${workbook.rows} 行，含 ${NARROW_SHED}，不含 S01`,
    '登录: admin / Admin@123456',
    `预览（全部棚）: ${reportPageUrl(day, { shedCode: '', webOrigin })}`,
    `预览（S02）: ${reportPageUrl(day, { shedCode: NARROW_SHED, webOrigin })}`,
    `导出: ${exportUrl(day, NARROW_SHED)}`,
  ];
  return lines.join('\n');
}

export async function sendReportBrowseDemo(now = new Date()) {
  const bodies = BROWSE_ROWS.map((spec) => {
    const body = buildBrowsePayload(spec, now);
    validateBrowsePayload(body, spec, now);
    return { spec, body };
  });
  const posted = [];
  for (const item of bodies) {
    const result = await postRecognition(item.body);
    posted.push({ ...item, ...result });
  }
  const token = await login();
  for (const item of posted) {
    await findRecognition(token, item.body, item.spec, { id: item.id });
  }
  const day = reportDay(now);
  const wide = assertBrowsePreview(await getPreview(token, previewSearch(day, '')), {
    day,
    shedFilter: null,
    specs: BROWSE_ROWS,
  });
  const narrow = assertBrowsePreview(await getPreview(token, previewSearch(day, NARROW_SHED)), {
    day,
    shedFilter: NARROW_SHED,
    specs: BROWSE_ROWS.filter((spec) => spec.shedCode === NARROW_SHED),
    onlyShed: NARROW_SHED,
  });
  if (wide.count <= narrow.count) {
    throw new Error(`全部棚 ${wide.count} 行，不多于只看 ${NARROW_SHED} 的 ${narrow.count} 行`);
  }
  const workbook = await downloadExport(token, previewSearch(day, NARROW_SHED), {
    requireSheds: [NARROW_SHED],
    forbidSheds: ['S01'],
  });
  return {
    posted,
    day,
    wideCount: wide.count,
    narrowCount: narrow.count,
    workbook,
  };
}

function usage() {
  return `用法:
  node scripts/demo-report-browse.mjs

写入 S01 与 S02 的识别，对照园区生长的全部棚和只看 S02，并下载 xlsx。步骤见 docs/DEMO_REPORT_BROWSE.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await sendReportBrowseDemo();
    process.stdout.write(`${formatBrowseProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
