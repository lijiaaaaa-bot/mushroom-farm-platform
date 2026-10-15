#!/usr/bin/env node
/**
 * 写入 CAM-MR-01 四天识别，生长趋势页同屏写出成熟率%。
 * 样例仍是 recognition.demo-growth-trend.json，只改本次请求的摄像头、数量、时间和幂等键。
 * 同一上海日再次运行沿用幂等键，不另建一行。
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
export const DEMO_CAMERA = 'CAM-MR-01';
export const DEMO_SHED = 'S01';

const COUNTS = [
  { offsetDays: 5, mushroomCount: 0, matureCount: 0 },
  { offsetDays: 3, mushroomCount: 20, matureCount: 2 },
  { offsetDays: 1, mushroomCount: 20, matureCount: 6 },
  { offsetDays: 0, mushroomCount: 20, matureCount: 10 },
];

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function maturityPercent(mushroomCount, matureCount) {
  if (!Number.isFinite(mushroomCount) || mushroomCount <= 0) return null;
  if (!Number.isFinite(matureCount)) return null;
  return Math.round((matureCount / mushroomCount) * 1000) / 10;
}

export function formatRate(value) {
  if (value === null) return '—';
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

function pointInstant(now, offsetDays) {
  return new Date(now.getTime() - offsetDays * DAY_MS);
}

function diameterFor(day, offsetDays) {
  const epoch = Date.parse('2026-01-01T00:00:00.000Z');
  const dayIndex = Math.round((Date.parse(`${day}T00:00:00.000Z`) - epoch) / 86400000);
  return Math.round((4 + dayIndex * 0.02 + (5 - offsetDays) * 0.05) * 100) / 100;
}

export function buildMaturityPayloads(now = new Date()) {
  const fixture = readFixture(DEMO_FIXTURE);
  return COUNTS.map((point) => {
    const at = pointInstant(now, point.offsetDays);
    const day = contracts().shanghaiDate(at);
    const diameter = diameterFor(day, point.offsetDays);
    const maturityRate = maturityPercent(point.mushroomCount, point.matureCount);
    return {
      offsetDays: point.offsetDays,
      day,
      diameter,
      mushroomCount: point.mushroomCount,
      matureCount: point.matureCount,
      maturityRate,
      body: {
        idempotencyKey: `demo-maturity-rate-${DEMO_CAMERA}-${day}`,
        shedCode: DEMO_SHED,
        cameraCode: DEMO_CAMERA,
        recognizedAt: at.toISOString(),
        mushroomCount: point.mushroomCount,
        matureCount: point.matureCount,
        capDiameters: [diameter],
        diseaseCount: fixture.diseaseCount,
        diseaseLevel: fixture.diseaseLevel,
        snapshotBase64: fixture.snapshotBase64,
        temperature: fixture.temperature,
        humidity: fixture.humidity,
        co2: fixture.co2,
        substrateMoisture: fixture.substrateMoisture,
      },
    };
  });
}

export function validateMaturityPayloads(samples, now = new Date()) {
  if (samples.length < 2) throw new Error('成熟率样例至少要两个点');
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
    if (value.mushroomCount !== sample.mushroomCount || value.matureCount !== sample.matureCount) {
      throw new Error('报文里的蘑菇数或成熟数和这次请求不一致');
    }
    if (value.matureCount > value.mushroomCount) throw new Error('成熟数不能大于蘑菇数');
    if (value.mushroomCount > 0 && value.matureCount / value.mushroomCount >= 0.6) {
      throw new Error('成熟占比达到种子规则「成熟占比一般」的 0.6');
    }
    if (value.diseaseCount !== 0 || value.diseaseLevel !== 0) {
      throw new Error('这次样例的病害数量或等级不是 0');
    }
    if (value.temperature !== 22.5) throw new Error(`温度是 ${value.temperature}，应为 22.5`);
    const day = contracts().shanghaiDate(new Date(value.recognizedAt));
    if (day !== sample.day) throw new Error(`识别日落在 ${day}，样例是 ${sample.day}`);
    if (sample.body.idempotencyKey !== `demo-maturity-rate-${DEMO_CAMERA}-${sample.day}`) {
      throw new Error('幂等键没有按摄像头和上海日固定');
    }
    if (sample.maturityRate !== maturityPercent(sample.mushroomCount, sample.matureCount)) {
      throw new Error('成熟率和蘑菇数、成熟数对不上');
    }
  }
  const rates = parsed
    .map((item) => item.sample.maturityRate)
    .filter((rate) => rate !== null);
  if (rates.length < 2) throw new Error('至少要两个非空成熟率');
  if (new Set(rates).size < 2) throw new Error('成熟率没有差别');
  if (!(rates[0] < rates[rates.length - 1])) throw new Error('近日成熟率没有高于前几日');
  if (!parsed.some((item) => item.sample.mushroomCount === 0 && item.sample.maturityRate === null)) {
    throw new Error('缺少蘑菇数为 0、成熟率为空的一天');
  }
  const keys = new Set(parsed.map((item) => item.sample.body.idempotencyKey));
  if (keys.size !== parsed.length) throw new Error('各天的幂等键重复了');
  const fixture = readFixture(DEMO_FIXTURE);
  if (fixture.cameraCode !== 'CAM-GT-01') throw new Error('样例文件里的摄像头被改掉了');
  return parsed.map((item) => item.value);
}

export function maturityRateUrl(
  { days = 7, shedCode = DEMO_SHED, cameraCode = DEMO_CAMERA } = {},
  webOrigin = webOriginFromEnv(),
) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const params = new URLSearchParams({
    days: String(days),
    shedCode,
    cameraCode,
  });
  return `${origin}/growth-trends?${params.toString()}`;
}

function deltaText(current, previous) {
  if (previous === undefined || previous === null || current === null) return '—';
  const delta = Math.round((current - previous) * 10) / 10;
  if (delta > 0) return `升 ${Number.isInteger(delta) ? delta : delta.toFixed(1)}`;
  if (delta < 0) return `降 ${Number.isInteger(Math.abs(delta)) ? Math.abs(delta) : Math.abs(delta).toFixed(1)}`;
  return '平';
}

export function assertMaturityPoints(series, samples) {
  const sheds = Array.isArray(series?.sheds) ? series.sheds : [];
  const shed = sheds.find((item) => item?.shedCode === DEMO_SHED);
  if (!shed) throw new Error(`趋势里没有棚区 ${DEMO_SHED}`);
  const camera = (shed.cameras || []).find((item) => item?.cameraCode === DEMO_CAMERA);
  if (!camera) throw new Error(`趋势里没有摄像头 ${DEMO_CAMERA}`);
  const points = Array.isArray(camera.points) ? camera.points : [];
  if (points.length < 2) throw new Error(`点数是 ${points.length}，至少要 2 个`);
  for (const sample of samples) {
    const point = points.find((item) => item?.day === sample.day);
    if (!point) throw new Error(`没有 ${sample.day} 的点`);
    if (point.mushroomCount !== sample.mushroomCount) {
      throw new Error(`${sample.day} 蘑菇数量是 ${point.mushroomCount}，应为 ${sample.mushroomCount}`);
    }
    if (point.matureCount !== sample.matureCount) {
      throw new Error(`${sample.day} 成熟数量是 ${point.matureCount}，应为 ${sample.matureCount}`);
    }
    if (point.maturityRate !== sample.maturityRate) {
      throw new Error(
        `${sample.day} 成熟率是 ${point.maturityRate}，应为 ${sample.maturityRate === null ? '空' : sample.maturityRate}`,
      );
    }
  }
  const rates = [...samples]
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((sample) => sample.maturityRate)
    .filter((rate) => rate !== null);
  if (rates.length < 2 || rates[0] === rates[rates.length - 1]) {
    throw new Error('接口里的成熟率看不出升降');
  }
  return camera;
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

function trendApiUrl(days) {
  const params = new URLSearchParams({
    days: String(days),
    shedCode: DEMO_SHED,
    cameraCode: DEMO_CAMERA,
  });
  return `${apiBase()}/growth-trends?${params.toString()}`;
}

async function getJson(token, url) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const body = await readJson(response);
  return { response, body };
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

export function formatMaturityProof({ samples, duplicates, webOrigin = webOriginFromEnv() }) {
  const ordered = [...samples].sort((a, b) => a.day.localeCompare(b.day));
  const rates = ordered.map((sample) => sample.maturityRate).filter((rate) => rate !== null);
  const direction = rates[rates.length - 1] > rates[0] ? '升' : '降';
  const lines = [
    `成熟率: ${ordered.length} 个点`,
    `棚区: ${DEMO_SHED}`,
    `摄像头: ${DEMO_CAMERA}`,
    `成熟率 ${rates.map((rate) => formatRate(rate)).join(' → ')}（${direction}）`,
    '登录: admin / Admin@123456',
  ];
  let previous;
  for (const sample of ordered) {
    const reused = duplicates.get(sample.day) ? '沿用' : '新建';
    lines.push(
      `${sample.day}: 蘑菇 ${sample.mushroomCount}，成熟 ${sample.matureCount}，成熟率 ${formatRate(sample.maturityRate)}，升降 ${deltaText(sample.maturityRate, previous)}（${reused}）`,
    );
    previous = sample.maturityRate;
  }
  lines.push(`打开: ${maturityRateUrl({ days: 7 }, webOrigin)}`);
  return lines.join('\n');
}

export async function sendMaturityRateDemo({ now = new Date() } = {}) {
  const samples = buildMaturityPayloads(now);
  validateMaturityPayloads(samples, now);
  const duplicates = new Map();
  for (const sample of samples) {
    const sent = await postRecognition(sample.body);
    duplicates.set(sample.day, sent.duplicate);
  }
  const token = await login();
  const week = await getJson(token, trendApiUrl(7));
  if (!week.response.ok) {
    throw new Error(`7 日趋势失败 ${week.response.status} ${messageText(week.body) || JSON.stringify(week.body)}`);
  }
  if (week.body.days !== 7) throw new Error(`天数是 ${week.body.days}，应为 7`);
  assertMaturityPoints(week.body, samples);
  return { samples, duplicates };
}

function usage() {
  return `用法:
  node scripts/demo-maturity-rate.mjs

写入 ${DEMO_CAMERA} 四天的成熟率点，并打印生长趋势页地址。步骤见 docs/DEMO_MATURITY_RATE.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const sent = await sendMaturityRateDemo();
    process.stdout.write(`${formatMaturityProof(sent)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
