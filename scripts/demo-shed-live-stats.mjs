#!/usr/bin/env node
/**
 * 写入 CAM-SLS-01 当日一条识别，单棚实时页读出蘑菇、成熟、待成熟、病害。
 * 样例仍是 recognition.demo-growth-trend.json，只改本次请求的摄像头、数量、时间和幂等键。
 * 同一上海日再次运行沿用幂等键，不另建一行。
 * 病害等级 1，成熟占比 8/20。若仍留下未闭合告警，命令末尾关闭。
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  apiBase,
  ingestRecognitionUrl,
  ingestToken,
  postJson,
  readFixture,
  repoRoot,
} from './lib/ingest-wire.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';

const require = createRequire(import.meta.url);

export const DEMO_FIXTURE = 'recognition.demo-growth-trend.json';
export const DEMO_CAMERA = 'CAM-SLS-01';
export const DEMO_SHED = 'S01';
export const CONTRAST_CAMERA = 'CAM-SLS-NONE';
export const MUSHROOM_COUNT = 20;
export const MATURE_COUNT = 8;
export const DISEASE_COUNT = 2;
export const PENDING_COUNT = 12;
export const DISEASE_LEVEL = 1;
export const CLOSE_NOTE = '实时生长演示后关闭';

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function pendingMatureCount(mushroom, mature) {
  if (!Number.isFinite(mushroom) || mushroom <= 0) return 0;
  const pending = mushroom - mature;
  return pending > 0 ? pending : 0;
}

export function liveStatsNote(counts) {
  return `蘑菇 ${counts.mushroomCount} · 成熟 ${counts.matureCount} · 待成熟 ${counts.pendingMatureCount} · 病害 ${counts.diseaseCount}`;
}

export function buildShedLiveStatsPayload(now = new Date()) {
  const fixture = readFixture(DEMO_FIXTURE);
  const day = contracts().shanghaiDate(now);
  return {
    day,
    diseaseLevel: DISEASE_LEVEL,
    body: {
      idempotencyKey: `demo-shed-live-stats-${DEMO_CAMERA}-${day}`,
      shedCode: DEMO_SHED,
      cameraCode: DEMO_CAMERA,
      recognizedAt: now.toISOString(),
      mushroomCount: MUSHROOM_COUNT,
      matureCount: MATURE_COUNT,
      capDiameters: [4.2],
      diseaseCount: DISEASE_COUNT,
      diseaseLevel: DISEASE_LEVEL,
      snapshotBase64: fixture.snapshotBase64,
      temperature: fixture.temperature,
      humidity: fixture.humidity,
      co2: fixture.co2,
      substrateMoisture: fixture.substrateMoisture,
    },
  };
}

export function validateShedLiveStatsPayload(sample, now = new Date()) {
  const result = contracts().parseRecognitionIngress(sample.body, now);
  if (!result.ok) throw new Error(`样例未通过契约：${result.errors.join('；')}`);
  const value = result.value;
  if (value.shedCode !== DEMO_SHED) throw new Error(`棚区是 ${value.shedCode}，应为 ${DEMO_SHED}`);
  if (value.cameraCode !== DEMO_CAMERA) {
    throw new Error(`摄像头是 ${value.cameraCode}，应为 ${DEMO_CAMERA}`);
  }
  if (value.mushroomCount !== MUSHROOM_COUNT) {
    throw new Error(`蘑菇数是 ${value.mushroomCount}，应为 ${MUSHROOM_COUNT}`);
  }
  if (value.matureCount !== MATURE_COUNT) {
    throw new Error(`成熟数是 ${value.matureCount}，应为 ${MATURE_COUNT}`);
  }
  if (value.diseaseCount !== DISEASE_COUNT) {
    throw new Error(`病害数是 ${value.diseaseCount}，应为 ${DISEASE_COUNT}`);
  }
  if (value.diseaseLevel !== DISEASE_LEVEL) {
    throw new Error(`病害等级是 ${value.diseaseLevel}，应为 ${DISEASE_LEVEL}`);
  }
  const pending = pendingMatureCount(value.mushroomCount, value.matureCount);
  if (pending !== PENDING_COUNT) throw new Error(`待成熟是 ${pending}，应为 ${PENDING_COUNT}`);
  if (value.mushroomCount > 0 && value.matureCount / value.mushroomCount >= 0.6) {
    throw new Error('成熟占比达到种子规则「成熟占比一般」的 0.6');
  }
  if (value.diseaseCount >= 5) throw new Error('病害数量达到种子规则「病害数量一般」的 5');
  if (value.diseaseLevel >= 2) throw new Error('病害等级达到种子规则「病害等级一般」的 2');
  if (value.temperature !== 22.5) throw new Error(`温度是 ${value.temperature}，应为 22.5`);
  const day = contracts().shanghaiDate(new Date(value.recognizedAt));
  if (day !== sample.day) throw new Error(`识别日落在 ${day}，样例是 ${sample.day}`);
  if (sample.body.idempotencyKey !== `demo-shed-live-stats-${DEMO_CAMERA}-${sample.day}`) {
    throw new Error('幂等键没有按摄像头和上海日固定');
  }
  const fixture = readFixture(DEMO_FIXTURE);
  if (fixture.cameraCode !== 'CAM-GT-01') throw new Error('样例文件里的摄像头被改掉了');
  if (fixture.diseaseCount !== 0) throw new Error('样例文件里的病害数量被改掉了');
  if (fixture.body?.mushroomCount !== 21) throw new Error('样例文件里的蘑菇数被改掉了');
  return value;
}

export function shedLiveStatsUrl(
  { shedCode = DEMO_SHED, cameraCode = DEMO_CAMERA } = {},
  webOrigin = webOriginFromEnv(),
) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const params = new URLSearchParams({ shedCode });
  if (cameraCode) params.set('cameraCode', cameraCode);
  return `${origin}/shed-live-stats?${params.toString()}`;
}

export function assertLiveStats(body) {
  if (body?.available !== true) throw new Error('实时统计没有可用点');
  if (body.shedCode !== DEMO_SHED) throw new Error(`棚区是 ${body.shedCode}，应为 ${DEMO_SHED}`);
  if (body.cameraCode !== DEMO_CAMERA) {
    throw new Error(`摄像头是 ${body.cameraCode}，应为 ${DEMO_CAMERA}`);
  }
  if (body.mushroomCount !== MUSHROOM_COUNT) {
    throw new Error(`蘑菇数是 ${body.mushroomCount}，应为 ${MUSHROOM_COUNT}`);
  }
  if (body.matureCount !== MATURE_COUNT) {
    throw new Error(`成熟数是 ${body.matureCount}，应为 ${MATURE_COUNT}`);
  }
  if (body.diseaseCount !== DISEASE_COUNT) {
    throw new Error(`病害数是 ${body.diseaseCount}，应为 ${DISEASE_COUNT}`);
  }
  if (body.pendingMatureCount !== PENDING_COUNT) {
    throw new Error(`待成熟是 ${body.pendingMatureCount}，应为 ${PENDING_COUNT}`);
  }
  if (body.basis !== 'latest_per_camera') throw new Error('口径不是当日最新');
  return body;
}

export function assertLiveStatsEmpty(body) {
  if (body?.available !== false) throw new Error('对照仍有实时生长数据');
  if (body.mushroomCount !== null || body.pendingMatureCount !== null) {
    throw new Error('对照不该写出数字');
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

function liveApiUrl(cameraCode) {
  const params = new URLSearchParams({ shedCode: DEMO_SHED });
  if (cameraCode) params.set('cameraCode', cameraCode);
  return `${apiBase()}/growth-trends/live?${params.toString()}`;
}

async function getJson(token, url) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const body = await readJson(response);
  return { response, body };
}

function itemsOf(page) {
  return Array.isArray(page?.items) ? page.items : [];
}

function nestedFlag(payload, key) {
  return payload?.[key] === true || payload?.message?.[key] === true;
}

async function postRecognition(body) {
  let posted;
  try {
    posted = await postJson(ingestRecognitionUrl(), JSON.stringify(body), {
      'content-type': 'application/json',
      'x-ingest-token': ingestToken(),
    });
  } catch (error) {
    throw new Error(`API 连不上（${ingestRecognitionUrl()}）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const payload = posted.responseBody;
  const accepted = payload?.accepted === true || payload?.message?.accepted === true;
  const id = payload?.id || payload?.message?.id;
  const duplicate = Boolean(payload?.duplicate || payload?.message?.duplicate);
  if (posted.responseStatus < 200 || posted.responseStatus >= 300 || !accepted || !id) {
    throw new Error(
      `接入拒绝 ${posted.responseStatus} ${messageText(payload) || JSON.stringify(payload)}`,
    );
  }
  if (!duplicate && !nestedFlag(payload, 'snapshotStored')) {
    throw new Error(
      '识别已入库，但 AI抓拍图没有写入对象存储。先执行 make up，确认对象存储在 127.0.0.1:9000，然后重新 make api。',
    );
  }
  return { id, duplicate };
}

function alertsToClose(items) {
  return items.filter(
    (item) =>
      item?.cameraCode === DEMO_CAMERA &&
      (item.status === 'open' || item.status === 'acked') &&
      item.id,
  );
}

async function listAlerts(token, status) {
  const search = new URLSearchParams({
    cameraCode: DEMO_CAMERA,
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

async function closeAlerts(token) {
  const open = await listAlerts(token, 'open');
  const acked = await listAlerts(token, 'acked');
  const targets = alertsToClose([...open, ...acked]);
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
      throw new Error(`关闭 ${DEMO_CAMERA} 的告警失败。${error.message}`);
    }
    const body = await readJson(response);
    if (!response.ok) {
      throw new Error(
        `关闭 ${DEMO_CAMERA} 的告警失败 ${response.status} ${messageText(body) || JSON.stringify(body)}`,
      );
    }
  }
  const leftOpen = await listAlerts(token, 'open');
  const leftAcked = await listAlerts(token, 'acked');
  const left = alertsToClose([...leftOpen, ...leftAcked]);
  if (left.length) throw new Error(`${DEMO_CAMERA} 还有 ${left.length} 条未闭合告警。`);
  return targets.length;
}

export function formatShedLiveStatsProof({
  sample,
  duplicate = false,
  closed = 0,
  webOrigin = webOriginFromEnv(),
}) {
  const note = liveStatsNote({
    mushroomCount: MUSHROOM_COUNT,
    matureCount: MATURE_COUNT,
    pendingMatureCount: PENDING_COUNT,
    diseaseCount: DISEASE_COUNT,
  });
  const reused = duplicate ? '沿用' : '新建';
  const lines = [
    `棚区: ${DEMO_SHED}`,
    `摄像头: ${DEMO_CAMERA}`,
    note,
    `蘑菇数: ${MUSHROOM_COUNT}`,
    `成熟数: ${MATURE_COUNT}`,
    `待成熟: ${PENDING_COUNT}`,
    `病害数: ${DISEASE_COUNT}`,
    `病害等级: ${DISEASE_LEVEL}`,
    `关闭告警: ${closed}`,
    '登录: admin / Admin@123456',
    `${sample.day}: 蘑菇 ${MUSHROOM_COUNT}，成熟 ${MATURE_COUNT}，待成熟 ${PENDING_COUNT}，病害 ${DISEASE_COUNT}（${reused}）`,
    `打开: ${shedLiveStatsUrl({ cameraCode: DEMO_CAMERA }, webOrigin)}`,
    `对照: ${shedLiveStatsUrl({ cameraCode: CONTRAST_CAMERA }, webOrigin)}`,
  ];
  return lines.join('\n');
}

export async function sendShedLiveStatsDemo({ now = new Date() } = {}) {
  const sample = buildShedLiveStatsPayload(now);
  validateShedLiveStatsPayload(sample, now);
  const sent = await postRecognition(sample.body);
  const token = await login();
  const live = await getJson(token, liveApiUrl(DEMO_CAMERA));
  if (!live.response.ok) {
    throw new Error(`实时统计失败 ${live.response.status} ${messageText(live.body) || JSON.stringify(live.body)}`);
  }
  assertLiveStats(live.body);
  const contrast = await getJson(token, liveApiUrl(CONTRAST_CAMERA));
  if (!contrast.response.ok) {
    throw new Error(`对照失败 ${contrast.response.status} ${messageText(contrast.body) || JSON.stringify(contrast.body)}`);
  }
  assertLiveStatsEmpty(contrast.body);
  const closed = await closeAlerts(token);
  return { sample, duplicate: sent.duplicate, closed };
}

function usage() {
  return `用法:
  node scripts/demo-shed-live-stats.mjs

写入 ${DEMO_CAMERA} 当日一条识别，并打印单棚实时页地址。步骤见 docs/DEMO_SHED_LIVE_STATS.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const sent = await sendShedLiveStatsDemo();
    process.stdout.write(`${formatShedLiveStatsProof(sent)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
