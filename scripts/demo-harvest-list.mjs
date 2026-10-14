#!/usr/bin/env node
/**
 * 写入一条采摘识别，再读当日清单和详情。
 * 样例文件 recognition.demo-one.json 不改。本次请求摄像头为 CAM-HAR-01。
 * 对照清单用 CAM-HAR-NONE，不应出现这一条。
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { apiBase, repoRoot } from './lib/ingest-wire.mjs';
import {
  sendDemo,
  validateDemoPayload,
  webOriginFromEnv,
  buildDemoPayload,
} from './demo-one-http-recognition.mjs';

const require = createRequire(import.meta.url);

export const DEMO_CAMERA = 'CAM-HAR-01';
export const DEMO_SHED = 'S01';
export const CONTRAST_CAMERA = 'CAM-HAR-NONE';
export const DEMO_MATURE = 5;
export const DEMO_MUSHROOM = 12;
export const DEMO_DIAMETER = 4.7;

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function shanghaiDay(now = new Date()) {
  return contracts().shanghaiDate(now);
}

export function buildHarvestPayload(now = new Date()) {
  const body = buildDemoPayload(now);
  body.cameraCode = DEMO_CAMERA;
  body.shedCode = DEMO_SHED;
  body.idempotencyKey = `demo-harvest-list-${now.getTime()}`;
  return body;
}

export function harvestListUrl({ date, cameraCode } = {}, webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const params = new URLSearchParams();
  if (date) params.set('date', date);
  if (cameraCode) params.set('cameraCode', cameraCode);
  const query = params.toString();
  return `${origin}/harvest${query ? `?${query}` : ''}`;
}

export function harvestDetailUrl(id, { date, cameraCode } = {}, webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const params = new URLSearchParams();
  if (date) params.set('date', date);
  if (cameraCode) params.set('cameraCode', cameraCode);
  const query = params.toString();
  return `${origin}/harvest/${encodeURIComponent(id)}${query ? `?${query}` : ''}`;
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

function harvestApiUrl(date, cameraCode) {
  const search = new URLSearchParams({ date });
  if (cameraCode) search.set('cameraCode', cameraCode);
  return `${apiBase()}/harvest/daily?${search.toString()}`;
}

async function getJson(token, url) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const body = await readJson(response);
  return { response, body };
}

export function assertHarvestRow(row, body) {
  if (!row?.id) throw new Error('采摘列表没有这条记录。');
  if (row.shedCode !== DEMO_SHED) {
    throw new Error(`棚区是 ${row.shedCode || '空'}，应为 ${DEMO_SHED}。`);
  }
  if (row.cameraCode !== DEMO_CAMERA) {
    throw new Error(`摄像头是 ${row.cameraCode || '空'}，应为 ${DEMO_CAMERA}。`);
  }
  if (row.matureCount !== body.matureCount) {
    throw new Error(`成熟数是 ${row.matureCount}，应为 ${body.matureCount}。`);
  }
  if (row.mushroomCount !== body.mushroomCount) {
    throw new Error(`蘑菇数是 ${row.mushroomCount}，应为 ${body.mushroomCount}。`);
  }
  if (body.matureCount !== DEMO_MATURE || body.mushroomCount !== DEMO_MUSHROOM) {
    throw new Error(`这次请求的成熟数或蘑菇数不是样例的 ${DEMO_MATURE} / ${DEMO_MUSHROOM}。`);
  }
  if (!row.recognizedAt) throw new Error('采摘记录没有时间。');
  const listed = new Date(row.recognizedAt).getTime();
  const sent = new Date(body.recognizedAt).getTime();
  if (!Number.isFinite(listed) || Math.abs(listed - sent) > 1000) {
    throw new Error(`列表时间 ${row.recognizedAt} 不是这次的 ${body.recognizedAt}。`);
  }
  return row;
}

export function assertHarvestDetail(detail, row) {
  if (!detail?.id || detail.id !== row.id) {
    throw new Error(`采摘详情 id 是 ${detail?.id || '空'}，列表是 ${row.id}。`);
  }
  if (detail.shedCode !== row.shedCode || detail.cameraCode !== row.cameraCode) {
    throw new Error('采摘详情的棚区或摄像头和列表不一致。');
  }
  if (detail.matureCount !== row.matureCount || detail.mushroomCount !== row.mushroomCount) {
    throw new Error('采摘详情的成熟数或蘑菇数和列表不一致。');
  }
  const listed = new Date(row.recognizedAt).getTime();
  const opened = new Date(detail.recognizedAt).getTime();
  if (!Number.isFinite(opened) || opened !== listed) {
    throw new Error('采摘详情的时间和列表不一致。');
  }
  if (Number(detail.avgCapDiameter) !== DEMO_DIAMETER) {
    throw new Error(`菌盖直径是 ${detail.avgCapDiameter}，应为 ${DEMO_DIAMETER}。`);
  }
  return detail;
}

export function assertContrastEmpty(page, id) {
  const items = Array.isArray(page?.items) ? page.items : [];
  if (items.some((item) => item?.id === id || item?.cameraCode === DEMO_CAMERA)) {
    throw new Error(`对照列表仍有 ${DEMO_CAMERA}。摄像头 ${CONTRAST_CAMERA} 不应看到这次的记录。`);
  }
  if (items.length !== 0) {
    throw new Error('对照列表不是空的。');
  }
  const mature = Number(page?.summary?.matureCount ?? 0);
  const mushrooms = Number(page?.summary?.mushroomCount ?? 0);
  if (mature !== 0 || mushrooms !== 0) {
    throw new Error('对照汇总不是 0。');
  }
}

export function formatHarvestProof({
  id,
  row,
  date,
  webOrigin = webOriginFromEnv(),
}) {
  const listUrl = harvestListUrl({ date, cameraCode: DEMO_CAMERA }, webOrigin);
  const contrastUrl = harvestListUrl({ date, cameraCode: CONTRAST_CAMERA }, webOrigin);
  const lines = [
    '采摘记录: 新建',
    `id: ${id}`,
    `时间: ${row.recognizedAt}`,
    `日期: ${date}`,
    `棚区: ${row.shedCode}`,
    `摄像头: ${row.cameraCode}`,
    `成熟数: ${row.matureCount}`,
    `蘑菇数: ${row.mushroomCount}`,
    `菌盖直径: ${DEMO_DIAMETER}`,
    '登录: admin / Admin@123456',
    `采摘列表: ${listUrl}`,
    `采摘详情: ${harvestDetailUrl(id, { date, cameraCode: DEMO_CAMERA }, webOrigin)}`,
    `对照列表: ${contrastUrl}`,
  ];
  return lines.join('\n');
}

export async function sendHarvestListDemo({ now = new Date() } = {}) {
  const body = buildHarvestPayload(now);
  validateDemoPayload(body, now);
  const sent = await sendDemo({ body, now });
  const token = await login();
  const date = shanghaiDay(new Date(body.recognizedAt));
  const listed = await getJson(token, harvestApiUrl(date, DEMO_CAMERA));
  if (!listed.response.ok) {
    throw new Error(
      `采摘列表失败 ${listed.response.status} ${messageText(listed.body) || JSON.stringify(listed.body)}`,
    );
  }
  const items = Array.isArray(listed.body.items) ? listed.body.items : [];
  const row = items.find((item) => item?.id === sent.id);
  if (!row) {
    throw new Error(
      `采摘列表里没有 ${sent.id}。页面 ${harvestListUrl({ date, cameraCode: DEMO_CAMERA })} 也看不到。`,
    );
  }
  assertHarvestRow(row, body);
  const opened = await getJson(token, `${apiBase()}/harvest/daily/${encodeURIComponent(sent.id)}`);
  if (!opened.response.ok) {
    throw new Error(
      `采摘详情失败 ${opened.response.status} ${messageText(opened.body) || JSON.stringify(opened.body)}`,
    );
  }
  assertHarvestDetail(opened.body, row);
  const contrast = await getJson(token, harvestApiUrl(date, CONTRAST_CAMERA));
  if (!contrast.response.ok) {
    throw new Error(
      `对照列表失败 ${contrast.response.status} ${messageText(contrast.body) || JSON.stringify(contrast.body)}`,
    );
  }
  assertContrastEmpty(contrast.body, sent.id);
  return {
    id: sent.id,
    row,
    body,
    date,
  };
}

function usage() {
  return `用法:
  node scripts/demo-harvest-list.mjs

写入 ${DEMO_CAMERA} 的一条采摘记录，并打印列表、详情和对照地址。步骤见 docs/DEMO_HARVEST_LIST.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const sent = await sendHarvestListDemo();
    process.stdout.write(`${formatHarvestProof(sent)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
