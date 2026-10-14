#!/usr/bin/env node
/**
 * 留下两条不同标题的告警，再按标题关键词搜索。
 * q=东侧标题 只返回标题里含这段文字的告警；不带 q 或 q 只有空白时两条都在。
 * 不发识别，不改阈值规则，不关闭已有告警。
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { apiBase, repoRoot } from './lib/ingest-wire.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';

const require = createRequire(import.meta.url);

export const TITLE_SHED = 'S01';
export const TITLE_LEVEL = 'warning';
export const MATCH_CAMERA = 'CAM-TITLE-01';
export const OTHER_CAMERA = 'CAM-TITLE-02';
export const TITLE_KEYWORD = '东侧标题';
export const MATCH_TITLE = '东侧标题搜索告警';
export const OTHER_TITLE = '西侧过道对照告警';

export const TITLE_ROWS = [
  {
    cameraCode: MATCH_CAMERA,
    title: MATCH_TITLE,
  },
  {
    cameraCode: OTHER_CAMERA,
    title: OTHER_TITLE,
  },
];

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function alertMessage(cameraCode) {
  return `棚区 ${TITLE_SHED} 摄像头 ${cameraCode} 对照演示`;
}

export function titleMatches(title, keyword) {
  const needle = String(keyword || '').trim().toLowerCase();
  if (!needle) return true;
  return String(title || '').toLowerCase().includes(needle);
}

export function pickReusable(items, title) {
  const spec = TITLE_ROWS.find((row) => row.title === title);
  if (!spec) return null;
  return (
    items.find(
      (row) =>
        row &&
        row.cameraCode === spec.cameraCode &&
        row.shedCode === TITLE_SHED &&
        row.title === spec.title &&
        (row.status === 'open' || row.status === 'acked'),
    ) || null
  );
}

export function assertOnlyTitle(items, keyword, requiredId, forbiddenId) {
  if (!items.some((row) => row.id === requiredId && titleMatches(row.title, keyword))) {
    throw new Error(`搜索「${keyword.trim()}」后没有告警 ${requiredId}`);
  }
  if (forbiddenId && items.some((row) => row.id === forbiddenId)) {
    throw new Error(`搜索「${keyword.trim()}」后仍有另一条演示告警 ${forbiddenId}`);
  }
  const other = items.filter((row) => !titleMatches(row.title, keyword));
  if (other.length) {
    const titles = [...new Set(other.map((row) => row.title || '（空）'))].join('、');
    throw new Error(`搜索「${keyword.trim()}」后仍有不匹配标题：${titles}`);
  }
}

export function assertBothPresent(items, ids) {
  const missing = ids.filter((id) => !items.some((row) => row.id === id));
  if (missing.length) throw new Error(`未搜索列表缺少 ${missing.join('、')}`);
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
    shedCode: TITLE_SHED,
    cameraCode: spec.cameraCode,
    level: TITLE_LEVEL,
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
  if (body.title !== spec.title || body.cameraCode !== spec.cameraCode || body.shedCode !== TITLE_SHED) {
    throw new Error(`新建告警的标题是 ${body.title || '（空）'}，摄像头是 ${body.cameraCode || '（空）'}`);
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
  if (detail?.cameraCode !== expected.cameraCode) missing.push('摄像头');
  if (detail?.shedCode !== TITLE_SHED) missing.push('棚区');
  if (detail?.title !== expected.title) missing.push('标题');
  if (!titleMatches(detail?.title, TITLE_KEYWORD)) missing.push('标题里的关键词');
  if (!String(detail?.message || '').includes(expected.cameraCode)) missing.push('说明里的摄像头');
  if (missing.length) throw new Error(`告警详情缺少${missing.join('、')}`);
  return detail;
}

export function alertListUrl(webOrigin = webOriginFromEnv()) {
  return `${String(webOrigin).replace(/\/$/, '')}/alerts`;
}

export function searchedListUrl(webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  return `${origin}/alerts?q=${encodeURIComponent(TITLE_KEYWORD)}`;
}

export function alertDetailUrl(id, webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  return `${origin}/alerts/${encodeURIComponent(id)}?q=${encodeURIComponent(TITLE_KEYWORD)}`;
}

export function formatTitleProof({
  seeded,
  filteredCount,
  detail,
  webOrigin = webOriginFromEnv(),
}) {
  const labels = contracts();
  const lines = [
    `留下 ${seeded.length} 条告警`,
    ...seeded.map(
      (row) => `${row.title}: ${row.created ? '新建' : '沿用'} ${row.id}`,
    ),
    `搜索关键词: ${TITLE_KEYWORD}`,
    `搜索后条数: ${filteredCount}`,
    '搜索后不匹配标题: 无',
    '详情可打开: 是',
    `详情标题: ${detail.title}`,
    `说明: ${detail.message}`,
    `级别: ${labels.ALERT_LEVEL_LABEL[detail.level] || detail.level}`,
    `状态: ${labels.ALERT_STATUS_LABEL[detail.status] || detail.status}`,
    '不带关键词仍含这两条: 是',
    '空白关键词仍含这两条: 是',
    '登录: admin / Admin@123456',
    `告警列表: ${alertListUrl(webOrigin)}`,
    `按标题搜索: ${searchedListUrl(webOrigin)}`,
    `告警详情: ${alertDetailUrl(detail.id, webOrigin)}`,
  ];
  return lines.join('\n');
}

export async function sendTitleSearchDemo() {
  const token = await login();
  const seeded = [];
  const listed = await listAllAlerts(token, { shedCode: TITLE_SHED });
  for (const spec of TITLE_ROWS) {
    const existing = pickReusable(listed.items, spec.title);
    if (existing) {
      seeded.push({
        cameraCode: spec.cameraCode,
        title: spec.title,
        id: existing.id,
        created: false,
      });
      continue;
    }
    const created = await createAlert(token, spec);
    seeded.push({
      cameraCode: spec.cameraCode,
      title: spec.title,
      id: created.id,
      created: true,
    });
  }
  const focus = seeded.find((row) => row.title === MATCH_TITLE);
  const other = seeded.find((row) => row.title === OTHER_TITLE);
  const filtered = await listAllAlerts(token, { q: ` ${TITLE_KEYWORD} ` });
  assertOnlyTitle(filtered.items, TITLE_KEYWORD, focus.id, other.id);
  const detail = assertDetail(await readAlert(token, focus.id), focus);
  const all = await listAllAlerts(token, { shedCode: TITLE_SHED });
  assertBothPresent(
    all.items,
    seeded.map((row) => row.id),
  );
  const blank = await listAllAlerts(token, { shedCode: TITLE_SHED, q: '   ' });
  assertBothPresent(
    blank.items,
    seeded.map((row) => row.id),
  );
  const seen = new Set(
    all.items.filter((row) => seeded.some((item) => item.id === row.id)).map((row) => row.title),
  );
  if (!seen.has(MATCH_TITLE) || !seen.has(OTHER_TITLE)) {
    throw new Error('未搜索列表没有同时留下两条标题');
  }
  return { seeded, filteredCount: filtered.total, detail };
}

function usage() {
  return `用法:
  node scripts/demo-alert-title-search.mjs

留下「${MATCH_TITLE}」与「${OTHER_TITLE}」，并按「${TITLE_KEYWORD}」搜索。步骤见 docs/DEMO_ALERT_TITLE_SEARCH.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await sendTitleSearchDemo();
    process.stdout.write(`${formatTitleProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
