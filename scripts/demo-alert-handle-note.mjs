#!/usr/bin/env node
/**
 * 从一条待确认告警开始，确认时写入处理说明，再读两次详情。
 * 不发识别，不改阈值规则，不确认或关闭其他告警。
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { apiBase, repoRoot } from './lib/ingest-wire.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';

const require = createRequire(import.meta.url);

export const NOTE_SHED = 'S01';
export const NOTE_CAMERA = 'CAM-NOTE-01';
export const NOTE_TITLE = '处理说明告警';
export const NOTE_LEVEL = 'warning';
export const HANDLE_NOTE = '现场已开窗通风';

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function alertMessage() {
  return `棚区 ${NOTE_SHED} 摄像头 ${NOTE_CAMERA} 处理说明演示`;
}

export function pickOpen(items) {
  return (
    items.find(
      (row) =>
        row &&
        row.shedCode === NOTE_SHED &&
        row.cameraCode === NOTE_CAMERA &&
        row.title === NOTE_TITLE &&
        row.status === 'open',
    ) || null
  );
}

export function assertNoted(detail, id) {
  if (!detail?.id) throw new Error('刷新后没有告警 id');
  if (detail.id !== id) throw new Error(`刷新后 id 是 ${detail.id}`);
  if (detail.shedCode !== NOTE_SHED) throw new Error(`刷新后棚区是 ${detail.shedCode}`);
  if (detail.cameraCode !== NOTE_CAMERA) throw new Error(`刷新后摄像头是 ${detail.cameraCode}`);
  if (detail.title !== NOTE_TITLE) throw new Error(`刷新后标题是 ${detail.title}`);
  if (detail.status !== 'acked') {
    throw new Error(`刷新后状态是 ${detail.status}，应为已确认`);
  }
  if (detail.ackNote !== HANDLE_NOTE) {
    throw new Error(`处理说明是 ${detail.ackNote ?? '空'}，应为 ${HANDLE_NOTE}`);
  }
  return detail;
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

async function listShedAlerts(token) {
  const items = [];
  let total = 0;
  const maxPages = 20;
  for (let page = 1; page <= maxPages; page += 1) {
    const body = await getPage(token, {
      shedCode: NOTE_SHED,
      page: String(page),
      pageSize: '100',
    });
    total = body.total;
    items.push(...body.items);
    if (items.length >= total || body.items.length === 0) break;
  }
  if (items.length < total) {
    throw new Error(`告警列表超过 ${maxPages} 页，没有读完`);
  }
  return items;
}

async function createAlert(token) {
  const payload = {
    shedCode: NOTE_SHED,
    cameraCode: NOTE_CAMERA,
    level: NOTE_LEVEL,
    title: NOTE_TITLE,
    message: alertMessage(),
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
  if (body.status !== 'open' || body.title !== NOTE_TITLE || body.cameraCode !== NOTE_CAMERA) {
    throw new Error(`新建告警的状态是 ${body.status || '（空）'}，标题是 ${body.title || '（空）'}`);
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

async function ackAlert(token, id) {
  let response;
  try {
    response = await fetch(`${apiBase()}/alerts/${encodeURIComponent(id)}/ack`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ note: HANDLE_NOTE }),
    });
  } catch (error) {
    throw new Error(`API 连不上（${apiBase()}）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`确认失败 ${response.status} ${messageText(body) || JSON.stringify(body)}`);
  }
  return body;
}

export function alertDetailUrl(id, webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  return `${origin}/alerts/${encodeURIComponent(id)}`;
}

export function formatHandleProof({
  created,
  detail,
  refreshed,
  webOrigin = webOriginFromEnv(),
}) {
  const labels = contracts();
  const lines = [
    created ? '来源: 新建一条待确认告警' : '来源: 沿用待确认告警',
    `告警 id: ${detail.id}`,
    `标题: ${detail.title}`,
    `棚区: ${NOTE_SHED}`,
    `摄像头编号: ${NOTE_CAMERA}`,
    '动作: 确认',
    `处理说明: ${detail.ackNote}`,
    `刷新后状态: ${labels.ALERT_STATUS_LABEL[detail.status] || detail.status}`,
    `再读一次处理说明: ${refreshed.ackNote}`,
    '登录: admin / Admin@123456',
    `告警详情: ${alertDetailUrl(detail.id, webOrigin)}`,
  ];
  return lines.join('\n');
}

export async function sendHandleNoteDemo() {
  const token = await login();
  const listed = await listShedAlerts(token);
  const existing = pickOpen(listed);
  const created = existing ? null : await createAlert(token);
  const target = existing || created;
  await ackAlert(token, target.id);
  const detail = assertNoted(await readAlert(token, target.id), target.id);
  const refreshed = assertNoted(await readAlert(token, target.id), target.id);
  if (refreshed.ackNote !== detail.ackNote) {
    throw new Error('再读一次时处理说明变了');
  }
  return { created: !existing, detail, refreshed };
}

function usage() {
  return `用法:
  node scripts/demo-alert-handle-note.mjs

从棚区 ${NOTE_SHED} 摄像头 ${NOTE_CAMERA} 的待确认「${NOTE_TITLE}」开始，确认时写入「${HANDLE_NOTE}」，再读两次详情。步骤见 docs/DEMO_ALERT_HANDLE_NOTE.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await sendHandleNoteDemo();
    process.stdout.write(`${formatHandleProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
