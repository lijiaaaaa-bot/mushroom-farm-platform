#!/usr/bin/env node
/**
 * 写入两台当日成熟数大于 0 的摄像头，生成采摘任务，再排人员和班次。
 * 样例文件 recognition.demo-one.json 不改。不改采摘记录列表和筛选演示。
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

export const MORNING_CAMERA = 'CAM-HT-01';
export const AFTERNOON_CAMERA = 'CAM-HT-02';
export const DEMO_SHED = 'S01';
export const MORNING_ASSIGNEE = '王早';
export const AFTERNOON_ASSIGNEE = '李午';
export const MORNING_MATURE = 5;
export const MORNING_MUSHROOM = 12;
export const AFTERNOON_MATURE = 9;
export const AFTERNOON_MUSHROOM = 17;

export const TASK_CAMERAS = [
  {
    cameraCode: MORNING_CAMERA,
    shedCode: DEMO_SHED,
    matureCount: MORNING_MATURE,
    mushroomCount: MORNING_MUSHROOM,
    assignee: MORNING_ASSIGNEE,
    shift: 'morning',
    status: 'scheduled',
  },
  {
    cameraCode: AFTERNOON_CAMERA,
    shedCode: DEMO_SHED,
    matureCount: AFTERNOON_MATURE,
    mushroomCount: AFTERNOON_MUSHROOM,
    assignee: AFTERNOON_ASSIGNEE,
    shift: 'afternoon',
    status: 'scheduled',
  },
];

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function shanghaiDay(now = new Date()) {
  return contracts().shanghaiDate(now);
}

export function shiftLabel(shift) {
  if (shift === 'morning') return '上午';
  if (shift === 'afternoon') return '下午';
  return '未排';
}

export function buildHarvestTaskPayload(now, camera) {
  const body = buildDemoPayload(now);
  body.cameraCode = camera.cameraCode;
  body.shedCode = camera.shedCode;
  body.matureCount = camera.matureCount;
  body.mushroomCount = camera.mushroomCount;
  body.idempotencyKey = `demo-harvest-task-${camera.cameraCode}-${now.getTime()}`;
  return body;
}

export function harvestTaskUrl(date, webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const params = new URLSearchParams();
  if (date) params.set('date', date);
  const query = params.toString();
  return `${origin}/harvest${query ? `?${query}` : ''}`;
}

export function schedulePatch(camera) {
  return {
    assignee: camera.assignee,
    shift: camera.shift,
    status: camera.status,
  };
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

export function rowByCamera(page, cameraCode) {
  return itemsOf(page).find((item) => item?.cameraCode === cameraCode) || null;
}

function tasksUrl(date) {
  return `${apiBase()}/harvest/tasks?date=${encodeURIComponent(date)}`;
}

function generateUrl(date) {
  return `${apiBase()}/harvest/tasks/generate?date=${encodeURIComponent(date)}`;
}

async function getJson(token, url) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const body = await readJson(response);
  return { response, body };
}

async function sendJson(token, method, url, body) {
  const headers = { authorization: `Bearer ${token}` };
  const init = { method, headers };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(url, init);
  const payload = await readJson(response);
  return { response, body: payload };
}

export function assertGeneratedTasks(page, date) {
  if (page?.date !== date) {
    throw new Error(`清单日期是 ${page?.date || '空'}，应为 ${date}。`);
  }
  if (!page?.schedule || typeof page.schedule.morning !== 'number' || typeof page.schedule.afternoon !== 'number' || typeof page.schedule.unassigned !== 'number') {
    throw new Error('清单没有上午、下午、未排计数。');
  }
  const found = [];
  for (const camera of TASK_CAMERAS) {
    const row = rowByCamera(page, camera.cameraCode);
    if (!row?.id) throw new Error(`生成后的清单没有 ${camera.cameraCode}。`);
    if (row.shedCode !== camera.shedCode) {
      throw new Error(`${camera.cameraCode} 棚区是 ${row.shedCode || '空'}，应为 ${camera.shedCode}。`);
    }
    if (row.matureCount !== camera.matureCount) {
      throw new Error(`${camera.cameraCode} 成熟数是 ${row.matureCount}，应为 ${camera.matureCount}。`);
    }
    if (row.mushroomCount !== camera.mushroomCount) {
      throw new Error(`${camera.cameraCode} 蘑菇数是 ${row.mushroomCount}，应为 ${camera.mushroomCount}。`);
    }
    found.push(row);
  }
  return {
    rows: found,
    count: itemsOf(page).length,
    schedule: page.schedule,
  };
}

export function assertScheduledTasks(page) {
  if (!page?.schedule || typeof page.schedule.unassigned !== 'number') {
    throw new Error('排班后的清单没有上午、下午、未排计数。');
  }
  const rows = [];
  for (const camera of TASK_CAMERAS) {
    const row = rowByCamera(page, camera.cameraCode);
    if (!row?.id) throw new Error(`排班后的清单没有 ${camera.cameraCode}。`);
    if (row.assignee !== camera.assignee) {
      throw new Error(`${camera.cameraCode} 人员是 ${row.assignee || '空'}，应为 ${camera.assignee}。`);
    }
    if (row.shift !== camera.shift) {
      throw new Error(`${camera.cameraCode} 班次是 ${shiftLabel(row.shift)}，应为 ${shiftLabel(camera.shift)}。`);
    }
    if (row.status !== camera.status) {
      throw new Error(`${camera.cameraCode} 状态是 ${row.status || '空'}，应为 ${camera.status}。`);
    }
    if (row.matureCount !== camera.matureCount) {
      throw new Error(`${camera.cameraCode} 排班后成熟数是 ${row.matureCount}，应为 ${camera.matureCount}。`);
    }
    rows.push(row);
  }
  if (page.schedule.morning < 1 || page.schedule.afternoon < 1) {
    throw new Error(
      `排班计数是上午 ${page.schedule.morning}、下午 ${page.schedule.afternoon}，上午和下午都至少要有 1 条。`,
    );
  }
  return {
    rows,
    count: itemsOf(page).length,
    schedule: page.schedule,
  };
}

export function contrastText(morning, afternoon) {
  return `${MORNING_CAMERA} ${morning.assignee} ${shiftLabel(morning.shift)}；${AFTERNOON_CAMERA} ${afternoon.assignee} ${shiftLabel(afternoon.shift)}`;
}

export function formatHarvestTaskProof({
  date,
  generatedCount,
  schedule,
  morning,
  afternoon,
  webOrigin = webOriginFromEnv(),
}) {
  const lines = [
    '采摘任务: 已生成并排班',
    `日期: ${date}`,
    `生成行数: ${generatedCount}`,
    `排班: 上午 ${schedule.morning} 条，下午 ${schedule.afternoon} 条，未排 ${schedule.unassigned} 条`,
    `对照: ${contrastText(morning, afternoon)}`,
    '登录: admin / Admin@123456',
    `打开: ${harvestTaskUrl(date, webOrigin)}`,
  ];
  return lines.join('\n');
}

export async function ingestHarvestTaskCameras({ now = new Date() } = {}) {
  const bodies = TASK_CAMERAS.map((camera) => buildHarvestTaskPayload(now, camera));
  for (const body of bodies) validateDemoPayload(body, now);
  const sent = [];
  for (const body of bodies) {
    sent.push(await sendDemo({ body, now }));
  }
  const date = shanghaiDay(new Date(bodies[0].recognizedAt));
  return { now, date, bodies, sent };
}

export async function scheduleHarvestTasks(token, date) {
  const generatedResponse = await sendJson(token, 'POST', generateUrl(date));
  if (!generatedResponse.response.ok) {
    throw new Error(
      `生成采摘任务失败 ${generatedResponse.response.status} ${messageText(generatedResponse.body) || JSON.stringify(generatedResponse.body)}`,
    );
  }
  const generated = assertGeneratedTasks(generatedResponse.body, date);
  for (const camera of TASK_CAMERAS) {
    const row = rowByCamera(generatedResponse.body, camera.cameraCode);
    const patched = await sendJson(
      token,
      'PATCH',
      `${apiBase()}/harvest/tasks/${encodeURIComponent(row.id)}`,
      schedulePatch(camera),
    );
    if (!patched.response.ok) {
      throw new Error(
        `排班 ${camera.cameraCode} 失败 ${patched.response.status} ${messageText(patched.body) || JSON.stringify(patched.body)}`,
      );
    }
  }
  const listed = await getJson(token, tasksUrl(date));
  if (!listed.response.ok) {
    throw new Error(
      `读取采摘任务失败 ${listed.response.status} ${messageText(listed.body) || JSON.stringify(listed.body)}`,
    );
  }
  const scheduled = assertScheduledTasks(listed.body);
  if (scheduled.count !== generated.count) {
    throw new Error(`排班后行数是 ${scheduled.count}，生成时是 ${generated.count}。`);
  }
  return {
    date,
    generatedCount: generated.count,
    schedule: scheduled.schedule,
    morning: scheduled.rows[0],
    afternoon: scheduled.rows[1],
  };
}

export async function sendHarvestTaskDemo({ now = new Date() } = {}) {
  const ingested = await ingestHarvestTaskCameras({ now });
  const token = await login();
  const scheduled = await scheduleHarvestTasks(token, ingested.date);
  return scheduled;
}

function usage() {
  return `用法:
  node scripts/demo-harvest-task.mjs

写入 ${MORNING_CAMERA} 与 ${AFTERNOON_CAMERA}，生成当日采摘任务并排班。步骤见 docs/DEMO_HARVEST_TASK.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const sent = await sendHarvestTaskDemo();
    process.stdout.write(`${formatHarvestTaskProof(sent)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
