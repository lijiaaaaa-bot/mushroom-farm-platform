#!/usr/bin/env node
/**
 * 写入 CAM-SDT-01 四天识别，单棚病害趋势页读出日桶病害数量。
 * 样例仍是 recognition.demo-growth-trend.json，只改本次请求的摄像头、病害数量、时间和幂等键。
 * 同一上海日再次运行沿用幂等键，不另建一行。
 * 病害数量 6 和 10 会碰到种子规则「病害数量一般」（阈值 5）。写入后关闭这台摄像头上的未闭合告警。
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
const DAY_MS = 24 * 60 * 60 * 1000;

export const DEMO_FIXTURE = 'recognition.demo-growth-trend.json';
export const DEMO_CAMERA = 'CAM-SDT-01';
export const DEMO_SHED = 'S01';
export const CONTRAST_CAMERA = 'CAM-SDT-NONE';
export const DISEASE_LEVEL = 1;
export const CLOSE_NOTE = '病害趋势演示后关闭';
export const DISEASE_COUNTS = [1, 3, 6, 10];

const COUNTS = [
  { offsetDays: 5, diseaseCount: 1 },
  { offsetDays: 3, diseaseCount: 3 },
  { offsetDays: 1, diseaseCount: 6 },
  { offsetDays: 0, diseaseCount: 10 },
];

const MUSHROOM_COUNT = 40;
const MATURE_COUNT = 4;

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

function pointInstant(now, offsetDays) {
  return new Date(now.getTime() - offsetDays * DAY_MS);
}

function diameterFor(offsetDays) {
  return Math.round((4.2 + (5 - offsetDays) * 0.1) * 100) / 100;
}

export function diseaseNote(values) {
  if (!Array.isArray(values) || values.length < 2) return '';
  const first = values[0];
  const last = values[values.length - 1];
  const change = last > first ? '升' : last < first ? '降' : '平';
  return `病害 ${values.join(' → ')}（${change}）`;
}

export function buildShedDiseaseTrendPayloads(now = new Date()) {
  const fixture = readFixture(DEMO_FIXTURE);
  return COUNTS.map((point) => {
    const at = pointInstant(now, point.offsetDays);
    const day = contracts().shanghaiDate(at);
    const diameter = diameterFor(point.offsetDays);
    return {
      offsetDays: point.offsetDays,
      day,
      diameter,
      diseaseCount: point.diseaseCount,
      diseaseLevel: DISEASE_LEVEL,
      body: {
        idempotencyKey: `demo-shed-disease-trend-${DEMO_CAMERA}-${day}`,
        shedCode: DEMO_SHED,
        cameraCode: DEMO_CAMERA,
        recognizedAt: at.toISOString(),
        mushroomCount: MUSHROOM_COUNT,
        matureCount: MATURE_COUNT,
        capDiameters: [diameter],
        diseaseCount: point.diseaseCount,
        diseaseLevel: DISEASE_LEVEL,
        snapshotBase64: fixture.snapshotBase64,
        temperature: fixture.temperature,
        humidity: fixture.humidity,
        co2: fixture.co2,
        substrateMoisture: fixture.substrateMoisture,
      },
    };
  });
}

export function validateShedDiseaseTrendPayloads(samples, now = new Date()) {
  if (samples.length < 4) throw new Error('病害趋势样例至少要四个上海日');
  const parsed = samples.map((sample) => {
    const result = contracts().parseRecognitionIngress(sample.body, now);
    if (!result.ok) throw new Error(`样例未通过契约：${result.errors.join('；')}`);
    return { sample, value: result.value };
  });
  for (const { sample, value } of parsed) {
    if (value.shedCode !== DEMO_SHED) throw new Error(`棚区是 ${value.shedCode}，应为 ${DEMO_SHED}`);
    if (value.cameraCode !== DEMO_CAMERA) {
      throw new Error(`摄像头是 ${value.cameraCode}，应为 ${DEMO_CAMERA}`);
    }
    if (value.diseaseCount !== sample.diseaseCount) {
      throw new Error(`${sample.day} 病害数量是 ${value.diseaseCount}，应为 ${sample.diseaseCount}`);
    }
    if (value.diseaseLevel !== DISEASE_LEVEL) {
      throw new Error(`病害等级是 ${value.diseaseLevel}，应为 ${DISEASE_LEVEL}`);
    }
    if (value.matureCount / value.mushroomCount >= 0.6) {
      throw new Error('成熟占比达到种子规则「成熟占比一般」的 0.6');
    }
    if (value.temperature !== 22.5) throw new Error(`温度是 ${value.temperature}，应为 22.5`);
    const day = contracts().shanghaiDate(new Date(value.recognizedAt));
    if (day !== sample.day) throw new Error(`识别日落在 ${day}，样例是 ${sample.day}`);
    if (sample.body.idempotencyKey !== `demo-shed-disease-trend-${DEMO_CAMERA}-${sample.day}`) {
      throw new Error('幂等键没有按摄像头和上海日固定');
    }
  }
  const ordered = [...parsed].sort((a, b) => a.sample.day.localeCompare(b.sample.day));
  const counts = ordered.map((item) => item.value.diseaseCount);
  if (counts.join(',') !== DISEASE_COUNTS.join(',')) {
    throw new Error(`病害数量是 ${counts.join(' / ')}，应为 ${DISEASE_COUNTS.join(' / ')}`);
  }
  if (!(counts[counts.length - 1] > counts[0])) throw new Error('病害数量没有升高');
  const keys = new Set(parsed.map((item) => item.sample.body.idempotencyKey));
  if (keys.size !== parsed.length) throw new Error('各天的幂等键重复了');
  const days = new Set(parsed.map((item) => item.sample.day));
  if (days.size !== parsed.length) throw new Error('各天的上海日重复了');
  const fixture = readFixture(DEMO_FIXTURE);
  if (fixture.cameraCode !== 'CAM-GT-01') throw new Error('样例文件里的摄像头被改掉了');
  if (fixture.diseaseCount !== 0) throw new Error('样例文件里的病害数量被改掉了');
  return parsed.map((item) => item.value);
}

export function shedDiseaseTrendUrl(
  { days = 7, shedCode = DEMO_SHED, cameraCode = DEMO_CAMERA } = {},
  webOrigin = webOriginFromEnv(),
) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const params = new URLSearchParams({
    days: String(days),
    shedCode,
    cameraCode,
  });
  return `${origin}/shed-disease-trend?${params.toString()}`;
}

function cameraPoints(series) {
  const sheds = Array.isArray(series?.sheds) ? series.sheds : [];
  const shed = sheds.find((item) => item?.shedCode === DEMO_SHED);
  if (!shed) throw new Error(`趋势里没有棚区 ${DEMO_SHED}`);
  const camera = (shed.cameras || []).find((item) => item?.cameraCode === DEMO_CAMERA);
  if (!camera) throw new Error(`趋势里没有摄像头 ${DEMO_CAMERA}`);
  return Array.isArray(camera.points) ? camera.points : [];
}

export function assertDiseasePoints(series, samples) {
  const points = cameraPoints(series);
  const wanted = new Set(samples.map((sample) => sample.day));
  const matched = points.filter((point) => wanted.has(point?.day));
  if (matched.length !== samples.length) {
    throw new Error(`日桶是 ${matched.length} 天，应为 ${samples.length} 天`);
  }
  for (const sample of samples) {
    const point = matched.find((item) => item?.day === sample.day);
    if (point.diseaseCount !== sample.diseaseCount) {
      throw new Error(`${sample.day} 病害数量是 ${point.diseaseCount}，应为 ${sample.diseaseCount}`);
    }
  }
  const ordered = [...matched].sort((a, b) => a.day.localeCompare(b.day));
  const extras = points.filter(
    (point) => point.day >= ordered[0].day && point.day <= ordered[ordered.length - 1].day && !wanted.has(point.day),
  );
  if (extras.length) throw new Error('窗口里有这次没写入的日桶');
  const counts = ordered.map((point) => point.diseaseCount);
  if (counts.join(',') !== DISEASE_COUNTS.join(',')) {
    throw new Error(`接口里的病害数量是 ${counts.join('、')}，读不出 ${DISEASE_COUNTS.join(' → ')}`);
  }
  return counts;
}

export function assertContrastEmpty(series) {
  const sheds = Array.isArray(series?.sheds) ? series.sheds : [];
  if (sheds.length !== 0) throw new Error('对照趋势不是空的');
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

function trendApiUrl(days, cameraCode) {
  const params = new URLSearchParams({
    days: String(days),
    shedCode: DEMO_SHED,
  });
  if (cameraCode) params.set('cameraCode', cameraCode);
  return `${apiBase()}/diseases/trends?${params.toString()}`;
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

export function formatShedDiseaseTrendProof({
  samples,
  duplicates,
  closed = 0,
  webOrigin = webOriginFromEnv(),
}) {
  const ordered = [...samples].sort((a, b) => a.day.localeCompare(b.day));
  const counts = ordered.map((sample) => sample.diseaseCount);
  const lines = [
    `病害趋势: ${ordered.length} 个日桶`,
    `棚区: ${DEMO_SHED}`,
    `摄像头: ${DEMO_CAMERA}`,
    diseaseNote(counts),
    `病害等级: ${DISEASE_LEVEL}`,
    `关闭告警: ${closed}`,
    '登录: admin / Admin@123456',
  ];
  for (const sample of ordered) {
    const reused = duplicates.get(sample.day) ? '沿用' : '新建';
    lines.push(`${sample.day}: 病害数量 ${sample.diseaseCount}，病害等级 ${DISEASE_LEVEL}（${reused}）`);
  }
  lines.push(`打开: ${shedDiseaseTrendUrl({ days: 7 }, webOrigin)}`);
  lines.push(`三十日: ${shedDiseaseTrendUrl({ days: 30 }, webOrigin)}`);
  lines.push(`对照: ${shedDiseaseTrendUrl({ days: 7, cameraCode: CONTRAST_CAMERA }, webOrigin)}`);
  return lines.join('\n');
}

export async function sendShedDiseaseTrendDemo({ now = new Date() } = {}) {
  const samples = buildShedDiseaseTrendPayloads(now);
  validateShedDiseaseTrendPayloads(samples, now);
  const duplicates = new Map();
  for (const sample of samples) {
    const sent = await postRecognition(sample.body);
    duplicates.set(sample.day, sent.duplicate);
  }
  const token = await login();
  const week = await getJson(token, trendApiUrl(7, DEMO_CAMERA));
  if (!week.response.ok) {
    throw new Error(`7 日趋势失败 ${week.response.status} ${messageText(week.body) || JSON.stringify(week.body)}`);
  }
  if (week.body.days !== 7) throw new Error(`天数是 ${week.body.days}，应为 7`);
  assertDiseasePoints(week.body, samples);
  const month = await getJson(token, trendApiUrl(30, DEMO_CAMERA));
  if (!month.response.ok) {
    throw new Error(`30 日趋势失败 ${month.response.status} ${messageText(month.body) || JSON.stringify(month.body)}`);
  }
  if (month.body.days !== 30) throw new Error(`天数是 ${month.body.days}，应为 30`);
  assertDiseasePoints(month.body, samples);
  const contrast = await getJson(token, trendApiUrl(7, CONTRAST_CAMERA));
  if (!contrast.response.ok) {
    throw new Error(`对照趋势失败 ${contrast.response.status} ${messageText(contrast.body) || JSON.stringify(contrast.body)}`);
  }
  assertContrastEmpty(contrast.body);
  const closed = await closeAlerts(token);
  return { samples, duplicates, closed };
}

function usage() {
  return `用法:
  node scripts/demo-shed-disease-trend.mjs

写入 ${DEMO_CAMERA} 四天的病害日桶，并打印单棚病害趋势页地址。步骤见 docs/DEMO_SHED_DISEASE_TREND.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const sent = await sendShedDiseaseTrendDemo();
    process.stdout.write(`${formatShedDiseaseTrendProof(sent)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
