#!/usr/bin/env node
/**
 * 写入一条病害识别，再读病害列表和详情。
 * 样例文件 recognition.demo-one.json 不改。本次请求摄像头为 CAM-DIS-01，
 * 病害数量 2，病害等级 1。对照列表用病害等级 3，不应出现这一条。
 */
import { pathToFileURL } from 'node:url';
import { apiBase } from './lib/ingest-wire.mjs';
import {
  sendDemo,
  validateDemoPayload,
  webOriginFromEnv,
  buildDemoPayload,
} from './demo-one-http-recognition.mjs';

export const DEMO_CAMERA = 'CAM-DIS-01';
export const DEMO_SHED = 'S01';
export const DEMO_LEVEL = 1;
export const DEMO_COUNT = 2;
export const CONTRAST_LEVEL = 3;

export function buildDiseasePayload(now = new Date()) {
  const body = buildDemoPayload(now);
  body.cameraCode = DEMO_CAMERA;
  body.shedCode = DEMO_SHED;
  body.diseaseCount = DEMO_COUNT;
  body.diseaseLevel = DEMO_LEVEL;
  body.idempotencyKey = `demo-disease-list-${now.getTime()}`;
  return body;
}

export function diseaseListUrl({ cameraCode, diseaseLevel } = {}, webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const params = new URLSearchParams();
  if (cameraCode) params.set('cameraCode', cameraCode);
  if (diseaseLevel !== undefined && diseaseLevel !== null && diseaseLevel !== '') {
    params.set('diseaseLevel', String(diseaseLevel));
  }
  const query = params.toString();
  return `${origin}/diseases${query ? `?${query}` : ''}`;
}

export function diseaseDetailUrl(id, webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  return `${origin}/diseases/${encodeURIComponent(id)}`;
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

function diseaseApiUrl(params) {
  const search = new URLSearchParams({ pageSize: '50', ...params });
  return `${apiBase()}/diseases?${search.toString()}`;
}

async function getJson(token, url) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const body = await readJson(response);
  return { response, body };
}

export function assertDiseaseRow(row, body) {
  if (!row?.id) throw new Error('病害列表没有这条记录。');
  if (row.shedCode !== DEMO_SHED) {
    throw new Error(`棚区是 ${row.shedCode || '空'}，应为 ${DEMO_SHED}。`);
  }
  if (row.cameraCode !== DEMO_CAMERA) {
    throw new Error(`位置是 ${row.cameraCode || '空'}，应为 ${DEMO_CAMERA}。`);
  }
  if (row.diseaseLevel !== DEMO_LEVEL) {
    throw new Error(`病害等级是 ${row.diseaseLevel}，应为 ${DEMO_LEVEL}。`);
  }
  if (!(Number(row.diseaseCount) > 0) || row.diseaseCount !== DEMO_COUNT) {
    throw new Error(`病害数量是 ${row.diseaseCount}，应为 ${DEMO_COUNT}。`);
  }
  if (!row.recognizedAt) throw new Error('病害记录没有时间。');
  const listed = new Date(row.recognizedAt).getTime();
  const sent = new Date(body.recognizedAt).getTime();
  if (!Number.isFinite(listed) || Math.abs(listed - sent) > 1000) {
    throw new Error(`列表时间 ${row.recognizedAt} 不是这次的 ${body.recognizedAt}。`);
  }
  if (!row.snapshotObjectKey && !row.snapshotUrl) {
    throw new Error('病害记录没有图片。');
  }
  return row;
}

export function assertDiseaseDetail(detail, row) {
  if (!detail?.id || detail.id !== row.id) {
    throw new Error(`病害详情 id 是 ${detail?.id || '空'}，列表是 ${row.id}。`);
  }
  if (detail.shedCode !== row.shedCode || detail.cameraCode !== row.cameraCode) {
    throw new Error('病害详情的棚区或位置和列表不一致。');
  }
  if (detail.diseaseLevel !== row.diseaseLevel || detail.diseaseCount !== row.diseaseCount) {
    throw new Error('病害详情的等级或数量和列表不一致。');
  }
  const listed = new Date(row.recognizedAt).getTime();
  const opened = new Date(detail.recognizedAt).getTime();
  if (!Number.isFinite(opened) || opened !== listed) {
    throw new Error('病害详情的时间和列表不一致。');
  }
  if ((detail.snapshotObjectKey || null) !== (row.snapshotObjectKey || null)) {
    throw new Error('病害详情的图片和列表不一致。');
  }
  return detail;
}

export function assertContrastEmpty(page, id) {
  const items = Array.isArray(page?.items) ? page.items : [];
  if (items.some((item) => item?.id === id || item?.cameraCode === DEMO_CAMERA)) {
    throw new Error(`对照列表仍有 ${DEMO_CAMERA}。病害等级 ${CONTRAST_LEVEL} 不应看到这次的轻度记录。`);
  }
  if (items.length !== 0 || page?.total !== 0) {
    throw new Error('对照列表不是空的。');
  }
}

export function formatDiseaseProof({
  id,
  row,
  webOrigin = webOriginFromEnv(),
  snapshotObjectKey,
}) {
  const listUrl = diseaseListUrl({ cameraCode: DEMO_CAMERA }, webOrigin);
  const contrastUrl = diseaseListUrl(
    { cameraCode: DEMO_CAMERA, diseaseLevel: CONTRAST_LEVEL },
    webOrigin,
  );
  const lines = [
    '病害记录: 新建',
    `id: ${id}`,
    `时间: ${row.recognizedAt}`,
    `棚区: ${row.shedCode}`,
    `位置: ${row.cameraCode}`,
    `病害等级: ${row.diseaseLevel}`,
    `病害数量: ${row.diseaseCount}`,
    `图片: ${snapshotObjectKey || row.snapshotObjectKey ? '有' : '无'}`,
    '登录: admin / Admin@123456',
    `病害列表: ${listUrl}`,
    `病害详情: ${diseaseDetailUrl(id, webOrigin)}`,
    `对照列表: ${contrastUrl}`,
  ];
  if (snapshotObjectKey || row.snapshotObjectKey) {
    lines.push(`抓拍对象键: ${snapshotObjectKey || row.snapshotObjectKey}`);
  }
  return lines.join('\n');
}

export async function sendDiseaseListDemo({ now = new Date() } = {}) {
  const body = buildDiseasePayload(now);
  validateDemoPayload(body, now);
  const sent = await sendDemo({ body, now });
  const token = await login();
  const listed = await getJson(
    token,
    diseaseApiUrl({ cameraCode: DEMO_CAMERA }),
  );
  if (!listed.response.ok) {
    throw new Error(
      `病害列表失败 ${listed.response.status} ${messageText(listed.body) || JSON.stringify(listed.body)}`,
    );
  }
  const items = Array.isArray(listed.body.items) ? listed.body.items : [];
  const row = items.find((item) => item?.id === sent.id);
  if (!row) {
    throw new Error(
      `病害列表里没有 ${sent.id}。页面 ${diseaseListUrl({ cameraCode: DEMO_CAMERA })} 也看不到。`,
    );
  }
  assertDiseaseRow(row, body);
  const opened = await getJson(token, `${apiBase()}/diseases/${encodeURIComponent(sent.id)}`);
  if (!opened.response.ok) {
    throw new Error(
      `病害详情失败 ${opened.response.status} ${messageText(opened.body) || JSON.stringify(opened.body)}`,
    );
  }
  assertDiseaseDetail(opened.body, row);
  const contrast = await getJson(
    token,
    diseaseApiUrl({ cameraCode: DEMO_CAMERA, diseaseLevel: String(CONTRAST_LEVEL) }),
  );
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
    snapshotObjectKey: sent.snapshotObjectKey,
  };
}

function usage() {
  return `用法:
  node scripts/demo-disease-list.mjs

写入 ${DEMO_CAMERA} 的一条病害记录，并打印列表、详情和对照地址。步骤见 docs/DEMO_DISEASE_LIST.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const sent = await sendDiseaseListDemo();
    process.stdout.write(`${formatDiseaseProof(sent)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
