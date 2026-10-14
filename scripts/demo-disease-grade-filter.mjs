#!/usr/bin/env node
/**
 * 写入两条病害识别，按病害等级对照列表。
 * 样例文件 recognition.demo-one.json 不改。
 * CAM-DG-MILD 病害等级 1、病害数量 1；CAM-DG-SEV 病害等级 3、病害数量 2。
 * 严重等级会碰到种子规则「病害等级一般」「病害等级严重」，写入后关闭这两台摄像头上的未闭合告警。
 */
import { pathToFileURL } from 'node:url';
import { apiBase } from './lib/ingest-wire.mjs';
import {
  sendDemo,
  validateDemoPayload,
  webOriginFromEnv,
  buildDemoPayload,
} from './demo-one-http-recognition.mjs';

export const MILD_CAMERA = 'CAM-DG-MILD';
export const SEVERE_CAMERA = 'CAM-DG-SEV';
export const DEMO_SHED = 'S01';
export const MILD_LEVEL = 1;
export const SEVERE_LEVEL = 3;
export const MILD_COUNT = 1;
export const SEVERE_COUNT = 2;
export const CLOSE_NOTE = '病害等级筛选演示后关闭';

const GRADES = {
  mild: {
    cameraCode: MILD_CAMERA,
    diseaseLevel: MILD_LEVEL,
    diseaseCount: MILD_COUNT,
    keyPrefix: 'demo-disease-grade-mild',
  },
  severe: {
    cameraCode: SEVERE_CAMERA,
    diseaseLevel: SEVERE_LEVEL,
    diseaseCount: SEVERE_COUNT,
    keyPrefix: 'demo-disease-grade-sev',
  },
};

export function buildGradePayload(kind, now = new Date()) {
  const grade = GRADES[kind];
  if (!grade) throw new Error(`未知等级 ${kind}`);
  const body = buildDemoPayload(now);
  body.cameraCode = grade.cameraCode;
  body.shedCode = DEMO_SHED;
  body.diseaseCount = grade.diseaseCount;
  body.diseaseLevel = grade.diseaseLevel;
  body.idempotencyKey = `${grade.keyPrefix}-${now.getTime()}`;
  return body;
}

export function gradeListUrl({ diseaseLevel } = {}, webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  if (diseaseLevel === undefined || diseaseLevel === null || diseaseLevel === '') {
    return `${origin}/diseases`;
  }
  return `${origin}/diseases?diseaseLevel=${encodeURIComponent(String(diseaseLevel))}`;
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

function itemsOf(page) {
  return Array.isArray(page?.items) ? page.items : [];
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

function sameInstant(row, body) {
  const listed = new Date(row?.recognizedAt).getTime();
  const sent = new Date(body?.recognizedAt).getTime();
  return Number.isFinite(listed) && Number.isFinite(sent) && Math.abs(listed - sent) <= 1000;
}

export function assertGradeRow(row, body, cameraCode, diseaseLevel, diseaseCount) {
  if (!row?.id) throw new Error(`病害列表没有 ${cameraCode}。`);
  if (row.shedCode !== DEMO_SHED) {
    throw new Error(`${cameraCode} 的棚区是 ${row.shedCode || '空'}，应为 ${DEMO_SHED}。`);
  }
  if (row.cameraCode !== cameraCode) {
    throw new Error(`位置是 ${row.cameraCode || '空'}，应为 ${cameraCode}。`);
  }
  if (row.diseaseLevel !== diseaseLevel) {
    throw new Error(`${cameraCode} 的病害等级是 ${row.diseaseLevel}，应为 ${diseaseLevel}。`);
  }
  if (row.diseaseCount !== diseaseCount) {
    throw new Error(`${cameraCode} 的病害数量是 ${row.diseaseCount}，应为 ${diseaseCount}。`);
  }
  if (!sameInstant(row, body)) {
    throw new Error(`${cameraCode} 的时间 ${row.recognizedAt} 不是这次的 ${body.recognizedAt}。`);
  }
  if (!row.snapshotObjectKey && !row.snapshotUrl) {
    throw new Error(`${cameraCode} 没有图片。`);
  }
  return row;
}

function findOwn(items, sent) {
  return items.find((item) => item?.id === sent.id || item?.cameraCode === sent.body.cameraCode);
}

export function assertGradeSplit({ mildPage, severePage, mild, severe }) {
  const mildItems = itemsOf(mildPage);
  const severeItems = itemsOf(severePage);
  if (!mildItems.length || mildPage?.total === 0) throw new Error('轻度列表是空的。');
  if (!severeItems.length || severePage?.total === 0) throw new Error('严重列表是空的。');
  const mildRow = findOwn(mildItems, mild);
  if (!mildRow) throw new Error(`轻度列表里没有 ${MILD_CAMERA}。`);
  assertGradeRow(mildRow, mild.body, MILD_CAMERA, MILD_LEVEL, MILD_COUNT);
  if (mildItems.some((item) => item?.cameraCode === SEVERE_CAMERA || item?.id === severe.id)) {
    throw new Error(`轻度列表仍有 ${SEVERE_CAMERA}。病害等级 ${MILD_LEVEL} 不应看到严重这一条。`);
  }
  if (mildItems.some((item) => item?.diseaseLevel !== MILD_LEVEL)) {
    throw new Error('轻度列表里有不是轻度的行。');
  }
  const severeRow = findOwn(severeItems, severe);
  if (!severeRow) throw new Error(`严重列表里没有 ${SEVERE_CAMERA}。`);
  assertGradeRow(severeRow, severe.body, SEVERE_CAMERA, SEVERE_LEVEL, SEVERE_COUNT);
  if (severeItems.some((item) => item?.cameraCode === MILD_CAMERA || item?.id === mild.id)) {
    throw new Error(`严重列表仍有 ${MILD_CAMERA}。病害等级 ${SEVERE_LEVEL} 不应看到轻度这一条。`);
  }
  if (severeItems.some((item) => item?.diseaseLevel !== SEVERE_LEVEL)) {
    throw new Error('严重列表里有不是严重的行。');
  }
  return { mildRow, severeRow };
}

export function assertBothGrades(page, mild, severe) {
  const items = itemsOf(page);
  const mildRow = findOwn(items, mild);
  const severeRow = findOwn(items, severe);
  if (!mildRow || !severeRow) {
    throw new Error('不按等级筛选时，轻度与严重应同时出现。');
  }
  if (mildRow.diseaseLevel !== MILD_LEVEL || severeRow.diseaseLevel !== SEVERE_LEVEL) {
    throw new Error('不按等级筛选时，两行的病害等级不对。');
  }
  return { mildRow, severeRow };
}

export function alertsToClose(items, cameraCode) {
  return itemsOf({ items }).filter(
    (item) =>
      item?.cameraCode === cameraCode &&
      (item.status === 'open' || item.status === 'acked') &&
      item.id,
  );
}

export function assertNoOpenAlerts(page, cameraCode) {
  const left = alertsToClose(itemsOf(page), cameraCode);
  if (left.length) {
    throw new Error(`${cameraCode} 还有 ${left.length} 条未闭合告警。`);
  }
}

export function formatGradeProof({
  mild,
  severe,
  closed,
  webOrigin = webOriginFromEnv(),
}) {
  const lines = [
    '轻度: 新建',
    '严重: 新建',
    `轻度 id: ${mild.id}`,
    `严重 id: ${severe.id}`,
    `棚区: ${DEMO_SHED}`,
    `轻度位置: ${MILD_CAMERA}`,
    `严重位置: ${SEVERE_CAMERA}`,
    `轻度等级: ${MILD_LEVEL}`,
    `严重等级: ${SEVERE_LEVEL}`,
    `轻度数量: ${MILD_COUNT}`,
    `严重数量: ${SEVERE_COUNT}`,
    `关闭告警: ${closed}`,
    '登录: admin / Admin@123456',
    `轻度列表: ${gradeListUrl({ diseaseLevel: MILD_LEVEL }, webOrigin)}`,
    `严重列表: ${gradeListUrl({ diseaseLevel: SEVERE_LEVEL }, webOrigin)}`,
    `全部等级: ${gradeListUrl({}, webOrigin)}`,
  ];
  return lines.join('\n');
}

async function listAlerts(token, cameraCode, status) {
  const search = new URLSearchParams({
    cameraCode,
    status,
    pageSize: '50',
  });
  const listed = await getJson(token, `${apiBase()}/alerts?${search.toString()}`);
  if (!listed.response.ok) {
    throw new Error(
      `告警列表失败 ${listed.response.status} ${messageText(listed.body) || JSON.stringify(listed.body)}`,
    );
  }
  return itemsOf(listed.body);
}

async function closeAlerts(token, cameraCode) {
  const open = await listAlerts(token, cameraCode, 'open');
  const acked = await listAlerts(token, cameraCode, 'acked');
  const targets = alertsToClose([...open, ...acked], cameraCode);
  for (const row of targets) {
    let response;
    try {
      response = await fetch(`${apiBase()}/alerts/${encodeURIComponent(row.id)}/close`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ note: CLOSE_NOTE }),
      });
    } catch (error) {
      throw new Error(`关闭 ${cameraCode} 的告警失败。${error.message}`);
    }
    const body = await readJson(response);
    if (!response.ok) {
      throw new Error(
        `关闭 ${cameraCode} 的告警失败 ${response.status} ${messageText(body) || JSON.stringify(body)}`,
      );
    }
  }
  const leftOpen = await listAlerts(token, cameraCode, 'open');
  assertNoOpenAlerts({ items: leftOpen }, cameraCode);
  return targets.length;
}

async function readDiseasePage(token, params, label) {
  const listed = await getJson(token, diseaseApiUrl(params));
  if (!listed.response.ok) {
    throw new Error(
      `${label}失败 ${listed.response.status} ${messageText(listed.body) || JSON.stringify(listed.body)}`,
    );
  }
  return listed.body;
}

export async function sendGradeFilterDemo({ now = new Date() } = {}) {
  const mildAt = now;
  const severeAt = new Date(now.getTime() + 1000);
  const mildBody = buildGradePayload('mild', mildAt);
  const severeBody = buildGradePayload('severe', severeAt);
  validateDemoPayload(mildBody, mildAt);
  validateDemoPayload(severeBody, severeAt);
  const mildSent = await sendDemo({ body: mildBody, now: mildAt });
  const severeSent = await sendDemo({ body: severeBody, now: severeAt });
  const mild = { id: mildSent.id, body: mildBody };
  const severe = { id: severeSent.id, body: severeBody };
  const token = await login();
  const mildPage = await readDiseasePage(token, { diseaseLevel: String(MILD_LEVEL) }, '轻度列表');
  const severePage = await readDiseasePage(
    token,
    { diseaseLevel: String(SEVERE_LEVEL) },
    '严重列表',
  );
  const allPage = await readDiseasePage(token, {}, '全部等级');
  assertGradeSplit({ mildPage, severePage, mild, severe });
  assertBothGrades(allPage, mild, severe);
  const closed =
    (await closeAlerts(token, MILD_CAMERA)) + (await closeAlerts(token, SEVERE_CAMERA));
  return { mild, severe, closed };
}

function usage() {
  return `用法:
  node scripts/demo-disease-grade-filter.mjs

写入 ${MILD_CAMERA}（轻度）和 ${SEVERE_CAMERA}（严重），并打印两份按等级筛选的地址。步骤见 docs/DEMO_DISEASE_GRADE_FILTER.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const sent = await sendGradeFilterDemo();
    process.stdout.write(`${formatGradeProof(sent)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
