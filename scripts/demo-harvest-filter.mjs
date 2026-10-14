#!/usr/bin/env node
/**
 * 写入两条采摘识别：S01 在 3 小时前，S02 在当前时刻。
 * 宽窗口能看到两棚；只看 S01 时没有 S02；窄窗口没有 3 小时前那条。
 * 样例文件 recognition.demo-one.json 不改。不生成采摘任务。
 */
import { pathToFileURL } from 'node:url';
import { apiBase } from './lib/ingest-wire.mjs';
import {
  sendDemo,
  validateDemoPayload,
  webOriginFromEnv,
  buildDemoPayload,
} from './demo-one-http-recognition.mjs';

export const S01_CAMERA = 'CAM-HF-S01';
export const S02_CAMERA = 'CAM-HF-S02';
export const S01_SHED = 'S01';
export const S02_SHED = 'S02';
export const S01_MATURE = 5;
export const S01_MUSHROOM = 12;
export const S02_MATURE = 9;
export const S02_MUSHROOM = 17;
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

export function harvestFilterUrl(
  { shedCode, from, to } = {},
  webOrigin = webOriginFromEnv(),
) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const params = new URLSearchParams();
  if (from) params.set('from', from instanceof Date ? from.toISOString() : String(from));
  if (to) params.set('to', to instanceof Date ? to.toISOString() : String(to));
  if (shedCode) params.set('shedCode', shedCode);
  const query = params.toString();
  return `${origin}/harvest${query ? `?${query}` : ''}`;
}

export function filterWindow(now = new Date()) {
  return {
    now,
    older: new Date(now.getTime() - 3 * HOUR),
    wideFrom: new Date(now.getTime() - 4 * HOUR),
    narrowFrom: new Date(now.getTime() - 30 * MINUTE),
    to: new Date(now.getTime() + MINUTE),
  };
}

export function buildHarvestFilterPayload(now, { shedCode, cameraCode, recognizedAt, matureCount, mushroomCount, key }) {
  const body = buildDemoPayload(now);
  body.shedCode = shedCode;
  body.cameraCode = cameraCode;
  body.recognizedAt = recognizedAt.toISOString();
  body.matureCount = matureCount;
  body.mushroomCount = mushroomCount;
  body.idempotencyKey = key;
  return body;
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

function harvestApiUrl({ from, to, shedCode }) {
  const search = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
  });
  if (shedCode) search.set('shedCode', shedCode);
  return `${apiBase()}/harvest/daily?${search.toString()}`;
}

async function getJson(token, url) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const body = await readJson(response);
  return { response, body };
}

function itemsOf(page) {
  return Array.isArray(page?.items) ? page.items : [];
}

function rowOf(page, id) {
  return itemsOf(page).find((item) => item?.id === id);
}

export function assertWidePage(page, s01, s02) {
  const items = itemsOf(page);
  const left = rowOf(page, s01.id);
  const right = rowOf(page, s02.id);
  if (!left) throw new Error(`宽窗口没有 ${S01_CAMERA}。`);
  if (!right) throw new Error(`宽窗口没有 ${S02_CAMERA}。`);
  if (left.shedCode !== S01_SHED || left.cameraCode !== S01_CAMERA) {
    throw new Error(`宽窗口里 ${S01_CAMERA} 的棚区或摄像头不对。`);
  }
  if (left.matureCount !== S01_MATURE || left.mushroomCount !== S01_MUSHROOM) {
    throw new Error(`宽窗口里 ${S01_CAMERA} 的成熟数或蘑菇数不是 ${S01_MATURE} / ${S01_MUSHROOM}。`);
  }
  if (right.shedCode !== S02_SHED || right.cameraCode !== S02_CAMERA) {
    throw new Error(`宽窗口里 ${S02_CAMERA} 的棚区或摄像头不对。`);
  }
  if (right.matureCount !== S02_MATURE || right.mushroomCount !== S02_MUSHROOM) {
    throw new Error(`宽窗口里 ${S02_CAMERA} 的成熟数或蘑菇数不是 ${S02_MATURE} / ${S02_MUSHROOM}。`);
  }
  if (items.length < 2) throw new Error('宽窗口少于两条。');
  return items.length;
}

export function assertShedPage(page, s01, s02, wideCount) {
  const items = itemsOf(page);
  if (!rowOf(page, s01.id)) throw new Error(`棚区 ${S01_SHED} 没有 ${S01_CAMERA}。`);
  if (rowOf(page, s02.id) || items.some((item) => item?.cameraCode === S02_CAMERA || item?.shedCode === S02_SHED)) {
    throw new Error(`棚区 ${S01_SHED} 仍有 ${S02_SHED}。`);
  }
  if (items.some((item) => item?.shedCode && item.shedCode !== S01_SHED)) {
    throw new Error(`棚区 ${S01_SHED} 的列表里有其他棚。`);
  }
  if (items.length >= wideCount) {
    throw new Error(`棚区 ${S01_SHED} 有 ${items.length} 条，不少于全部棚区的 ${wideCount} 条。`);
  }
  return items.length;
}

export function assertNarrowPage(page, s01, s02, wideCount) {
  const items = itemsOf(page);
  if (rowOf(page, s01.id) || items.some((item) => item?.cameraCode === S01_CAMERA)) {
    throw new Error(`窄窗口仍有 ${S01_CAMERA}。`);
  }
  const right = rowOf(page, s02.id);
  if (!right) throw new Error(`窄窗口没有 ${S02_CAMERA}。`);
  if (right.shedCode !== S02_SHED || right.matureCount !== S02_MATURE) {
    throw new Error(`窄窗口里 ${S02_CAMERA} 的棚区或成熟数不对。`);
  }
  if (items.length >= wideCount) {
    throw new Error(`窄窗口有 ${items.length} 条，不少于宽窗口的 ${wideCount} 条。`);
  }
  return items.length;
}

export function assertSummarySmaller(narrower, wider, label) {
  const left = Number(narrower?.summary?.matureCount);
  const right = Number(wider?.summary?.matureCount);
  if (!Number.isFinite(left) || !Number.isFinite(right) || left >= right) {
    throw new Error(`${label} 的成熟数汇总是 ${left}，不少于宽窗口的 ${right}。`);
  }
}

export function formatHarvestFilterProof({
  s01,
  s02,
  window,
  wideCount,
  shedCount,
  narrowCount,
  webOrigin = webOriginFromEnv(),
}) {
  const allUrl = harvestFilterUrl({ from: window.wideFrom, to: window.to }, webOrigin);
  const shedUrl = harvestFilterUrl(
    { from: window.wideFrom, to: window.to, shedCode: S01_SHED },
    webOrigin,
  );
  const narrowUrl = harvestFilterUrl({ from: window.narrowFrom, to: window.to }, webOrigin);
  const lines = [
    '采摘筛选: 新建',
    `S01 id: ${s01.id}`,
    `S01 时间: ${s01.recognizedAt}`,
    `S01 棚区: ${S01_SHED}`,
    `S01 摄像头: ${S01_CAMERA}`,
    `S01 成熟数: ${S01_MATURE}`,
    `S01 蘑菇数: ${S01_MUSHROOM}`,
    `S02 id: ${s02.id}`,
    `S02 时间: ${s02.recognizedAt}`,
    `S02 棚区: ${S02_SHED}`,
    `S02 摄像头: ${S02_CAMERA}`,
    `S02 成熟数: ${S02_MATURE}`,
    `S02 蘑菇数: ${S02_MUSHROOM}`,
    `宽窗口条数: ${wideCount}`,
    `棚区 S01 条数: ${shedCount}`,
    `窄窗口条数: ${narrowCount}`,
    '登录: admin / Admin@123456',
    `全部棚区: ${allUrl}`,
    `棚区 S01: ${shedUrl}`,
    `窄窗口: ${narrowUrl}`,
  ];
  return lines.join('\n');
}

export async function sendHarvestFilterDemo({ now = new Date() } = {}) {
  const window = filterWindow(now);
  const s01Body = buildHarvestFilterPayload(now, {
    shedCode: S01_SHED,
    cameraCode: S01_CAMERA,
    recognizedAt: window.older,
    matureCount: S01_MATURE,
    mushroomCount: S01_MUSHROOM,
    key: `demo-harvest-filter-s01-${now.getTime()}`,
  });
  const s02Body = buildHarvestFilterPayload(now, {
    shedCode: S02_SHED,
    cameraCode: S02_CAMERA,
    recognizedAt: window.now,
    matureCount: S02_MATURE,
    mushroomCount: S02_MUSHROOM,
    key: `demo-harvest-filter-s02-${now.getTime()}`,
  });
  validateDemoPayload(s01Body, now);
  validateDemoPayload(s02Body, now);
  const sentS01 = await sendDemo({ body: s01Body, now });
  const sentS02 = await sendDemo({ body: s02Body, now });
  const token = await login();
  const wide = await getJson(token, harvestApiUrl({ from: window.wideFrom, to: window.to }));
  if (!wide.response.ok) {
    throw new Error(`宽窗口失败 ${wide.response.status} ${messageText(wide.body) || JSON.stringify(wide.body)}`);
  }
  const wideCount = assertWidePage(wide.body, { id: sentS01.id }, { id: sentS02.id });
  const shed = await getJson(
    token,
    harvestApiUrl({ from: window.wideFrom, to: window.to, shedCode: S01_SHED }),
  );
  if (!shed.response.ok) {
    throw new Error(`棚区筛选失败 ${shed.response.status} ${messageText(shed.body) || JSON.stringify(shed.body)}`);
  }
  const shedCount = assertShedPage(shed.body, { id: sentS01.id }, { id: sentS02.id }, wideCount);
  assertSummarySmaller(shed.body, wide.body, `棚区 ${S01_SHED}`);
  const narrow = await getJson(token, harvestApiUrl({ from: window.narrowFrom, to: window.to }));
  if (!narrow.response.ok) {
    throw new Error(`窄窗口失败 ${narrow.response.status} ${messageText(narrow.body) || JSON.stringify(narrow.body)}`);
  }
  const narrowCount = assertNarrowPage(narrow.body, { id: sentS01.id }, { id: sentS02.id }, wideCount);
  assertSummarySmaller(narrow.body, wide.body, '窄窗口');
  return {
    s01: { id: sentS01.id, recognizedAt: s01Body.recognizedAt },
    s02: { id: sentS02.id, recognizedAt: s02Body.recognizedAt },
    window,
    wideCount,
    shedCount,
    narrowCount,
  };
}

function usage() {
  return `用法:
  node scripts/demo-harvest-filter.mjs

写入 ${S01_CAMERA}（${S01_SHED}，3 小时前）和 ${S02_CAMERA}（${S02_SHED}，当前时刻），并打印全部棚区、棚区 S01、窄窗口三个地址。步骤见 docs/DEMO_HARVEST_FILTER.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const sent = await sendHarvestFilterDemo();
    process.stdout.write(`${formatHarvestFilterProof(sent)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
