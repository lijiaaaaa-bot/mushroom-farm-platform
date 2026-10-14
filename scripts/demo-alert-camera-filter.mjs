#!/usr/bin/env node
/**
 * 留下两条不同摄像头的告警，再按摄像头编号筛选。
 * 筛选 CAM-FILTER-02 只返回这台摄像头；不带 cameraCode 时两条都在。
 * 不发识别，不改阈值规则，不关闭已有告警。
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { apiBase, repoRoot } from './lib/ingest-wire.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';

const require = createRequire(import.meta.url);

export const FILTER_SHED = 'S01';
export const FILTER_CAMERA = 'CAM-FILTER-02';
export const OTHER_CAMERA = 'CAM-FILTER-01';
export const FILTER_LEVEL = 'warning';

export const FILTER_CAMERAS = [
  {
    cameraCode: OTHER_CAMERA,
    title: '东侧过道告警',
  },
  {
    cameraCode: FILTER_CAMERA,
    title: '西侧过道告警',
  },
];

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function alertMessage(cameraCode) {
  return `棚区 ${FILTER_SHED} 摄像头 ${cameraCode} 演示告警`;
}

export function pickReusable(items, cameraCode) {
  const spec = FILTER_CAMERAS.find((row) => row.cameraCode === cameraCode);
  if (!spec) return null;
  return (
    items.find(
      (row) =>
        row &&
        row.cameraCode === cameraCode &&
        row.shedCode === FILTER_SHED &&
        row.title === spec.title &&
        (row.status === 'open' || row.status === 'acked'),
    ) || null
  );
}

export function assertOnlyCamera(items, cameraCode, requiredId) {
  if (!items.some((row) => row.id === requiredId)) {
    throw new Error(`筛选 ${cameraCode} 后没有告警 ${requiredId}`);
  }
  const other = items.filter((row) => row.cameraCode !== cameraCode);
  if (other.length) {
    const codes = [...new Set(other.map((row) => row.cameraCode || '（空）'))].join('、');
    throw new Error(`筛选 ${cameraCode} 后仍有其他摄像头：${codes}`);
  }
}

export function assertBothPresent(items, ids) {
  const missing = ids.filter((id) => !items.some((row) => row.id === id));
  if (missing.length) throw new Error(`未筛选列表缺少 ${missing.join('、')}`);
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
    shedCode: FILTER_SHED,
    cameraCode: spec.cameraCode,
    level: FILTER_LEVEL,
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
  if (body.cameraCode !== spec.cameraCode || body.shedCode !== FILTER_SHED) {
    throw new Error(`新建告警的摄像头是 ${body.cameraCode || '（空）'}，棚区是 ${body.shedCode}`);
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
  if (detail?.shedCode !== FILTER_SHED) missing.push('棚区');
  if (detail?.title !== expected.title) missing.push('标题');
  if (!String(detail?.message || '').includes(expected.cameraCode)) missing.push('说明里的摄像头');
  if (missing.length) throw new Error(`告警详情缺少${missing.join('、')}`);
  return detail;
}

export function alertListUrl(webOrigin = webOriginFromEnv()) {
  return `${String(webOrigin).replace(/\/$/, '')}/alerts`;
}

export function filteredListUrl(webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  return `${origin}/alerts?cameraCode=${encodeURIComponent(FILTER_CAMERA)}`;
}

export function alertDetailUrl(id, webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  return `${origin}/alerts/${encodeURIComponent(id)}?cameraCode=${encodeURIComponent(FILTER_CAMERA)}`;
}

export function formatFilterProof({
  seeded,
  filteredCount,
  detail,
  webOrigin = webOriginFromEnv(),
}) {
  const labels = contracts();
  const lines = [
    `留下 ${seeded.length} 条告警`,
    ...seeded.map(
      (row) => `${row.cameraCode}: ${row.created ? '新建' : '沿用'} ${row.id}`,
    ),
    `筛选摄像头: ${FILTER_CAMERA}`,
    `筛选后条数: ${filteredCount}`,
    '筛选后其他摄像头: 无',
    '详情可打开: 是',
    `详情摄像头: ${detail.cameraCode}`,
    `标题: ${detail.title}`,
    `说明: ${detail.message}`,
    `级别: ${labels.ALERT_LEVEL_LABEL[detail.level] || detail.level}`,
    `状态: ${labels.ALERT_STATUS_LABEL[detail.status] || detail.status}`,
    '未筛选仍含这两台: 是',
    '登录: admin / Admin@123456',
    `告警列表: ${alertListUrl(webOrigin)}`,
    `按摄像头筛选: ${filteredListUrl(webOrigin)}`,
    `告警详情: ${alertDetailUrl(detail.id, webOrigin)}`,
  ];
  return lines.join('\n');
}

export async function sendCameraFilterDemo() {
  const token = await login();
  const seeded = [];
  for (const spec of FILTER_CAMERAS) {
    const listed = await listAllAlerts(token, {
      shedCode: FILTER_SHED,
      cameraCode: spec.cameraCode,
    });
    const existing = pickReusable(listed.items, spec.cameraCode);
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
  const focus = seeded.find((row) => row.cameraCode === FILTER_CAMERA);
  const other = seeded.find((row) => row.cameraCode === OTHER_CAMERA);
  const filtered = await listAllAlerts(token, { cameraCode: FILTER_CAMERA });
  assertOnlyCamera(filtered.items, FILTER_CAMERA, focus.id);
  if (filtered.items.some((row) => row.id === other.id)) {
    throw new Error(`筛选 ${FILTER_CAMERA} 后仍能看到 ${OTHER_CAMERA}`);
  }
  const detail = assertDetail(await readAlert(token, focus.id), focus);
  const all = await listAllAlerts(token, { shedCode: FILTER_SHED });
  assertBothPresent(
    all.items,
    seeded.map((row) => row.id),
  );
  const seen = new Set(
    all.items.filter((row) => seeded.some((item) => item.id === row.id)).map((row) => row.cameraCode),
  );
  if (!seen.has(FILTER_CAMERA) || !seen.has(OTHER_CAMERA)) {
    throw new Error('未筛选列表没有同时留下两台摄像头');
  }
  return { seeded, filteredCount: filtered.total, detail };
}

function usage() {
  return `用法:
  node scripts/demo-alert-camera-filter.mjs

留下 ${OTHER_CAMERA} 与 ${FILTER_CAMERA} 各一条告警，并按 ${FILTER_CAMERA} 筛选。步骤见 docs/DEMO_ALERT_CAMERA_FILTER.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await sendCameraFilterDemo();
    process.stdout.write(`${formatFilterProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
