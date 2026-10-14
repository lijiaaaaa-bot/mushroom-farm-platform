#!/usr/bin/env node
/**
 * 写入 CAM-GT-01 三天识别，生长趋势页能看到蘑菇数和成熟数的变化。
 * 样例文件 recognition.demo-growth-trend.json 不改识别时间以外的数量。
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
const DIAMETER_BONUS = { 5: 0, 2: 0.4, 0: 0.9 };

export const DEMO_FIXTURE = 'recognition.demo-growth-trend.json';
export const DEMO_CAMERA = 'CAM-GT-01';
export const DEMO_SHED = 'S01';
export const CONTRAST_CAMERA = 'CAM-GT-NONE';

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function pointInstant(now, offsetDays) {
  return new Date(now.getTime() - offsetDays * DAY_MS);
}

export function diameterFor(day, offsetDays) {
  const epoch = Date.parse('2026-01-01T00:00:00.000Z');
  const dayIndex = Math.round((Date.parse(`${day}T00:00:00.000Z`) - epoch) / 86400000);
  const bonus = DIAMETER_BONUS[offsetDays] ?? 0;
  return Math.round((3 + dayIndex * 0.06 + bonus) * 100) / 100;
}

export function buildGrowthPayloads(now = new Date()) {
  const fixture = readFixture(DEMO_FIXTURE);
  const points = [...fixture.points].sort((a, b) => b.offsetDays - a.offsetDays);
  return points.map((point) => {
    const at = pointInstant(now, point.offsetDays);
    const day = contracts().shanghaiDate(at);
    const diameter = diameterFor(day, point.offsetDays);
    return {
      offsetDays: point.offsetDays,
      day,
      diameter,
      mushroomCount: point.mushroomCount,
      matureCount: point.matureCount,
      body: {
        idempotencyKey: `demo-growth-trend-${fixture.cameraCode}-${day}`,
        shedCode: fixture.shedCode,
        cameraCode: fixture.cameraCode,
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

export function validateGrowthPayloads(samples, now = new Date()) {
  if (samples.length < 2) throw new Error('生长趋势样例至少要两个点');
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
      throw new Error('报文里的蘑菇数或成熟数和样例不一致');
    }
    if (value.matureCount > value.mushroomCount) throw new Error('成熟数不能大于蘑菇数');
    if (value.mushroomCount <= 0 || value.matureCount / value.mushroomCount >= 0.6) {
      throw new Error('成熟占比达到种子规则「成熟占比一般」的 0.6');
    }
    if (value.diseaseCount !== 0 || value.diseaseLevel !== 0) {
      throw new Error('这次样例的病害数量或等级不是 0');
    }
    if (value.temperature !== 22.5) throw new Error(`温度是 ${value.temperature}，应为 22.5`);
    if (value.capDiameters.length !== 1 || value.capDiameters[0] !== sample.diameter) {
      throw new Error('菌盖直径和这次计算的不一致');
    }
    const day = contracts().shanghaiDate(new Date(value.recognizedAt));
    if (day !== sample.day) throw new Error(`识别日落在 ${day}，样例是 ${sample.day}`);
    if (sample.body.idempotencyKey !== `demo-growth-trend-${DEMO_CAMERA}-${sample.day}`) {
      throw new Error('幂等键没有按摄像头和上海日固定');
    }
  }
  const ordered = [...parsed].sort((a, b) => a.sample.day.localeCompare(b.sample.day));
  for (let index = 1; index < ordered.length; index += 1) {
    const prev = ordered[index - 1].sample;
    const next = ordered[index].sample;
    if (next.mushroomCount <= prev.mushroomCount) throw new Error('蘑菇数量没有随日期变大');
    if (next.matureCount <= prev.matureCount) throw new Error('成熟数量没有随日期变大');
    if (next.diameter <= prev.diameter) throw new Error('菌盖直径没有随日期变大');
  }
  const keys = new Set(parsed.map((item) => item.sample.body.idempotencyKey));
  if (keys.size !== parsed.length) throw new Error('三天的幂等键重复了');
  return parsed.map((item) => item.value);
}

export function growthTrendUrl(
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

export function assertCameraPoints(series, samples) {
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
    if (point.capDiameterMean !== sample.diameter) {
      throw new Error(`${sample.day} 菌盖直径是 ${point.capDiameterMean}，应为 ${sample.diameter}`);
    }
  }
  return camera;
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

export function formatGrowthProof({ samples, duplicates, webOrigin = webOriginFromEnv() }) {
  const lines = [
    `生长趋势: ${samples.length} 个点`,
    `棚区: ${DEMO_SHED}`,
    `摄像头: ${DEMO_CAMERA}`,
    `天数: 7`,
    '登录: admin / Admin@123456',
  ];
  for (const sample of [...samples].sort((a, b) => a.day.localeCompare(b.day))) {
    const reused = duplicates.get(sample.day) ? '沿用' : '新建';
    lines.push(
      `${sample.day}: 蘑菇 ${sample.mushroomCount}，成熟 ${sample.matureCount}，菌盖 ${sample.diameter}（${reused}）`,
    );
  }
  lines.push(`打开: ${growthTrendUrl({ days: 7 }, webOrigin)}`);
  lines.push(`三十日: ${growthTrendUrl({ days: 30 }, webOrigin)}`);
  lines.push(
    `对照: ${growthTrendUrl({ days: 7, cameraCode: CONTRAST_CAMERA }, webOrigin)}`,
  );
  return lines.join('\n');
}

export async function sendGrowthTrendDemo({ now = new Date() } = {}) {
  const samples = buildGrowthPayloads(now);
  validateGrowthPayloads(samples, now);
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
  assertCameraPoints(week.body, samples);
  const month = await getJson(token, trendApiUrl(30, DEMO_CAMERA));
  if (!month.response.ok) {
    throw new Error(`30 日趋势失败 ${month.response.status} ${messageText(month.body) || JSON.stringify(month.body)}`);
  }
  if (month.body.days !== 30) throw new Error(`天数是 ${month.body.days}，应为 30`);
  assertCameraPoints(month.body, samples);
  const contrast = await getJson(token, trendApiUrl(7, CONTRAST_CAMERA));
  if (!contrast.response.ok) {
    throw new Error(`对照趋势失败 ${contrast.response.status} ${messageText(contrast.body) || JSON.stringify(contrast.body)}`);
  }
  assertContrastEmpty(contrast.body);
  return { samples, duplicates };
}

function usage() {
  return `用法:
  node scripts/demo-growth-trend.mjs

写入 ${DEMO_CAMERA} 三天的生长点，并打印 7 日、30 日和空对照地址。步骤见 docs/DEMO_GROWTH_TREND.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const sent = await sendGrowthTrendDemo();
    process.stdout.write(`${formatGrowthProof(sent)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
