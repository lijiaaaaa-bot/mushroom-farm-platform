#!/usr/bin/env node
/**
 * 留下三条发生时间不同的告警，再按起止时间筛选。
 * 时间列是 createdAt。宽窗口三条都在；窄窗口只有窗内两条。
 * 状态下拉仍是全部，不改 status 筛选。
 * 不发识别，不确认，不关闭。
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { apiBase, repoRoot } from './lib/ingest-wire.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';

const require = createRequire(import.meta.url);

export const TIME_SHED = 'S01';
export const TIME_LEVEL = 'warning';
export const TITLE_QUERY = '时间窗';
export const OUTSIDE_CAMERA = 'CAM-TIME-01';
export const INSIDE_OLDER_CAMERA = 'CAM-TIME-02';
export const INSIDE_NOW_CAMERA = 'CAM-TIME-03';
export const OUTSIDE_MS = 3 * 60 * 60 * 1000;
export const INSIDE_OLDER_MS = 8 * 60 * 1000;
export const WIDE_BEFORE_MS = 4 * 60 * 60 * 1000;
export const NARROW_BEFORE_MS = 30 * 60 * 1000;
export const AFTER_MS = 60 * 1000;

export function demoWindows(now = new Date()) {
  return {
    now,
    outsideAt: new Date(now.getTime() - OUTSIDE_MS),
    insideOlderAt: new Date(now.getTime() - INSIDE_OLDER_MS),
    insideNowAt: new Date(now.getTime()),
    wideFrom: new Date(now.getTime() - WIDE_BEFORE_MS),
    narrowFrom: new Date(now.getTime() - NARROW_BEFORE_MS),
    to: new Date(now.getTime() + AFTER_MS),
  };
}

export function timeSpecs(clock = demoWindows()) {
  return [
    {
      cameraCode: OUTSIDE_CAMERA,
      title: '时间窗外告警',
      createdAt: clock.outsideAt,
      place: 'outside',
    },
    {
      cameraCode: INSIDE_OLDER_CAMERA,
      title: '时间窗内较早告警',
      createdAt: clock.insideOlderAt,
      place: 'inside',
    },
    {
      cameraCode: INSIDE_NOW_CAMERA,
      title: '时间窗内当前告警',
      createdAt: clock.insideNowAt,
      place: 'inside',
    },
  ];
}

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function alertMessage(cameraCode) {
  return `棚区 ${TIME_SHED} 摄像头 ${cameraCode} 起止时间演示`;
}

export function sameInstant(value, date) {
  const at = new Date(value).getTime();
  return Number.isFinite(at) && at === date.getTime();
}

export function inWindow(value, from, to) {
  const at = new Date(value).getTime();
  return Number.isFinite(at) && at >= from.getTime() && at <= to.getTime();
}

export function assertWindow(items, { from, to, requiredIds, forbiddenIds = [] }) {
  for (const id of requiredIds) {
    const row = items.find((item) => item.id === id);
    if (!row) throw new Error(`时间窗口内没有告警 ${id}`);
    if (!inWindow(row.createdAt, from, to)) {
      throw new Error(`告警 ${id} 的 createdAt 不在窗口内`);
    }
  }
  for (const id of forbiddenIds) {
    if (items.some((item) => item.id === id)) {
      throw new Error(`时间窗口内仍有窗外告警 ${id}`);
    }
  }
  const stray = items.filter((item) => !inWindow(item.createdAt, from, to));
  if (stray.length) {
    throw new Error(`时间窗口内仍有 createdAt 超出起止的告警 ${stray.map((item) => item.id).join('、')}`);
  }
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
    shedCode: TIME_SHED,
    cameraCode: spec.cameraCode,
    level: TIME_LEVEL,
    title: spec.title,
    message: alertMessage(spec.cameraCode),
    createdAt: spec.createdAt.toISOString(),
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
  if (!sameInstant(body.createdAt, spec.createdAt)) {
    throw new Error(`告警 ${spec.cameraCode} 的 createdAt 不是 ${payload.createdAt}`);
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

export function rangedListUrl(from, to, webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const params = new URLSearchParams({
    q: TITLE_QUERY,
    from: from.toISOString(),
    to: to.toISOString(),
  });
  return `${origin}/alerts?${params.toString()}`;
}

export function formatTimeProof({
  seeded,
  clock,
  wideCount,
  narrowCount,
  detail,
  webOrigin = webOriginFromEnv(),
}) {
  const labels = contracts();
  const lines = [
    `留下 ${seeded.length} 条告警`,
    '比较字段: createdAt（列表「时间」列）',
    ...seeded.map(
      (row) =>
        `${row.cameraCode}: ${row.created ? '新建' : '沿用'} ${row.id} ${row.title} ${row.createdAt}`,
    ),
    `宽窗口: ${clock.wideFrom.toISOString()} 至 ${clock.to.toISOString()}`,
    `宽窗口条数: ${wideCount}`,
    `窄窗口: ${clock.narrowFrom.toISOString()} 至 ${clock.to.toISOString()}`,
    `窄窗口条数: ${narrowCount}`,
    '窄窗口少于宽窗口: 是',
    '窗外告警不在窄窗口: 是',
    '窗内两条仍在窄窗口: 是',
    '状态下拉: 全部',
    `详情标题: ${detail.title}`,
    `详情时间: ${detail.createdAt}`,
    `级别: ${labels.ALERT_LEVEL_LABEL[detail.level] || detail.level}`,
    `状态: ${labels.ALERT_STATUS_LABEL[detail.status] || detail.status}`,
    '登录: admin / Admin@123456',
    `宽窗口列表: ${rangedListUrl(clock.wideFrom, clock.to, webOrigin)}`,
    `窄窗口列表: ${rangedListUrl(clock.narrowFrom, clock.to, webOrigin)}`,
  ];
  return lines.join('\n');
}

export async function sendTimeRangeDemo(now = new Date()) {
  const clock = demoWindows(now);
  const specs = timeSpecs(clock);
  const token = await login();
  const seeded = [];
  for (const spec of specs) {
    const listed = await listAllAlerts(token, {
      shedCode: TIME_SHED,
      cameraCode: spec.cameraCode,
      q: spec.title,
    });
    const existing = listed.items.find(
      (row) => row.cameraCode === spec.cameraCode && row.title === spec.title && row.shedCode === TIME_SHED,
    );
    const saved = await createAlert(token, spec);
    if (existing && saved.id !== existing.id) {
      throw new Error(`同摄像头同标题应沿用 ${existing.id}，实际是 ${saved.id}`);
    }
    seeded.push({
      cameraCode: spec.cameraCode,
      title: spec.title,
      id: saved.id,
      createdAt: spec.createdAt.toISOString(),
      place: spec.place,
      created: !existing,
    });
  }
  const outside = seeded.find((row) => row.place === 'outside');
  const inside = seeded.filter((row) => row.place === 'inside');
  const rangeQuery = { q: TITLE_QUERY };
  const wide = await listAllAlerts(token, {
    ...rangeQuery,
    from: clock.wideFrom.toISOString(),
    to: clock.to.toISOString(),
  });
  const narrow = await listAllAlerts(token, {
    ...rangeQuery,
    from: clock.narrowFrom.toISOString(),
    to: clock.to.toISOString(),
  });
  assertWindow(wide.items, {
    from: clock.wideFrom,
    to: clock.to,
    requiredIds: seeded.map((row) => row.id),
  });
  assertWindow(narrow.items, {
    from: clock.narrowFrom,
    to: clock.to,
    requiredIds: inside.map((row) => row.id),
    forbiddenIds: [outside.id],
  });
  if (!(narrow.total < wide.total)) {
    throw new Error(`窄窗口条数 ${narrow.total} 没有少于宽窗口 ${wide.total}`);
  }
  const openNarrow = await listAllAlerts(token, {
    ...rangeQuery,
    status: 'open',
    from: clock.narrowFrom.toISOString(),
    to: clock.to.toISOString(),
  });
  assertWindow(openNarrow.items, {
    from: clock.narrowFrom,
    to: clock.to,
    requiredIds: inside.map((row) => row.id),
    forbiddenIds: [outside.id],
  });
  const detail = await readAlert(token, inside[inside.length - 1].id);
  if (detail.title !== '时间窗内当前告警') {
    throw new Error(`详情标题是 ${detail.title || '（空）'}`);
  }
  if (!sameInstant(detail.createdAt, clock.insideNowAt)) {
    throw new Error('详情 createdAt 不是窗内当前时刻');
  }
  return {
    seeded,
    clock,
    wideCount: wide.total,
    narrowCount: narrow.total,
    detail,
  };
}

function usage() {
  return `用法:
  node scripts/demo-alert-time-range.mjs

留下三条 createdAt 不同的告警，并按起止时间筛选。步骤见 docs/DEMO_ALERT_TIME_RANGE.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await sendTimeRangeDemo();
    process.stdout.write(`${formatTimeProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
