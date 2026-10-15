#!/usr/bin/env node
/**
 * 写入 CAM-GD-01 四天识别，单棚生长增量页读出相邻日的差。
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
export const DEMO_CAMERA = 'CAM-GD-01';
export const DEMO_SHED = 'S01';
export const CONTRAST_CAMERA = 'CAM-GD-NONE';

const COUNTS = [
  { offsetDays: 5, mushroomCount: 10, matureCount: 2 },
  { offsetDays: 3, mushroomCount: 16, matureCount: 4 },
  { offsetDays: 1, mushroomCount: 24, matureCount: 7 },
  { offsetDays: 0, mushroomCount: 34, matureCount: 11 },
];

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

function pointInstant(now, offsetDays) {
  return new Date(now.getTime() - offsetDays * DAY_MS);
}

function diameterFor(day, offsetDays) {
  const epoch = Date.parse('2026-01-01T00:00:00.000Z');
  const dayIndex = Math.round((Date.parse(`${day}T00:00:00.000Z`) - epoch) / 86400000);
  return Math.round((4 + dayIndex * 0.02 + (5 - offsetDays) * 0.05) * 100) / 100;
}

export function growthDeltas(samples) {
  const ordered = [...samples].sort((a, b) => a.day.localeCompare(b.day));
  const deltas = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    deltas.push({
      day: current.day,
      mushroomDelta: current.mushroomCount - previous.mushroomCount,
      matureDelta: current.matureCount - previous.matureCount,
    });
  }
  return deltas;
}

export function deltaNote(label, values) {
  if (!Array.isArray(values) || values.length < 2) return '';
  const first = values[0];
  const last = values[values.length - 1];
  const change = last > first ? '升' : last < first ? '降' : '平';
  return `${label} ${values.join(' → ')}（${change}）`;
}

export function buildShedGrowthDeltaPayloads(now = new Date()) {
  const fixture = readFixture(DEMO_FIXTURE);
  return COUNTS.map((point) => {
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
        idempotencyKey: `demo-shed-growth-delta-${DEMO_CAMERA}-${day}`,
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

export function validateShedGrowthDeltaPayloads(samples, now = new Date()) {
  if (samples.length < 3) throw new Error('生长增量样例至少要三个日桶，才能有两个相邻增量');
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
    if (value.mushroomCount <= 0 || value.matureCount / value.mushroomCount >= 0.6) {
      throw new Error('成熟占比达到种子规则「成熟占比一般」的 0.6');
    }
    if (value.diseaseCount !== 0 || value.diseaseLevel !== 0) {
      throw new Error('这次样例的病害数量或等级不是 0');
    }
    if (value.temperature !== 22.5) throw new Error(`温度是 ${value.temperature}，应为 22.5`);
    const day = contracts().shanghaiDate(new Date(value.recognizedAt));
    if (day !== sample.day) throw new Error(`识别日落在 ${day}，样例是 ${sample.day}`);
    if (sample.body.idempotencyKey !== `demo-shed-growth-delta-${DEMO_CAMERA}-${sample.day}`) {
      throw new Error('幂等键没有按摄像头和上海日固定');
    }
  }
  const deltas = growthDeltas(parsed.map((item) => item.sample));
  if (deltas.length < 2) throw new Error('相邻增量不足两个');
  const mushrooms = deltas.map((item) => item.mushroomDelta);
  if (mushrooms[0] !== 6 || mushrooms[1] !== 8) {
    throw new Error(`前两个蘑菇增量是 ${mushrooms[0]} 和 ${mushrooms[1]}，应为 6 和 8`);
  }
  if (!(mushrooms[1] > mushrooms[0])) throw new Error('相邻蘑菇增量没有升高');
  if (new Set(mushrooms).size < 2) throw new Error('蘑菇增量没有差别');
  const keys = new Set(parsed.map((item) => item.sample.body.idempotencyKey));
  if (keys.size !== parsed.length) throw new Error('各天的幂等键重复了');
  const days = new Set(parsed.map((item) => item.sample.day));
  if (days.size !== parsed.length) throw new Error('各天的上海日重复了');
  const fixture = readFixture(DEMO_FIXTURE);
  if (fixture.cameraCode !== 'CAM-GT-01') throw new Error('样例文件里的摄像头被改掉了');
  return parsed.map((item) => item.value);
}

export function shedGrowthDeltaUrl(
  { days = 7, shedCode = DEMO_SHED, cameraCode = DEMO_CAMERA } = {},
  webOrigin = webOriginFromEnv(),
) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const params = new URLSearchParams({
    days: String(days),
    shedCode,
    cameraCode,
  });
  return `${origin}/shed-growth-delta?${params.toString()}`;
}

function cameraPoints(series) {
  const sheds = Array.isArray(series?.sheds) ? series.sheds : [];
  const shed = sheds.find((item) => item?.shedCode === DEMO_SHED);
  if (!shed) throw new Error(`趋势里没有棚区 ${DEMO_SHED}`);
  const camera = (shed.cameras || []).find((item) => item?.cameraCode === DEMO_CAMERA);
  if (!camera) throw new Error(`趋势里没有摄像头 ${DEMO_CAMERA}`);
  return Array.isArray(camera.points) ? camera.points : [];
}

export function assertDeltaPoints(series, samples) {
  const points = cameraPoints(series);
  const wanted = new Set(samples.map((sample) => sample.day));
  const matched = points.filter((point) => wanted.has(point?.day));
  if (matched.length !== samples.length) {
    throw new Error(`日桶是 ${matched.length} 天，应为 ${samples.length} 天`);
  }
  for (const sample of samples) {
    const point = matched.find((item) => item?.day === sample.day);
    if (point.mushroomCount !== sample.mushroomCount) {
      throw new Error(`${sample.day} 蘑菇数量是 ${point.mushroomCount}，应为 ${sample.mushroomCount}`);
    }
    if (point.matureCount !== sample.matureCount) {
      throw new Error(`${sample.day} 成熟数量是 ${point.matureCount}，应为 ${sample.matureCount}`);
    }
  }
  const ordered = [...matched].sort((a, b) => a.day.localeCompare(b.day));
  const extras = points.filter(
    (point) => point.day >= ordered[0].day && point.day <= ordered[ordered.length - 1].day && !wanted.has(point.day),
  );
  if (extras.length) throw new Error('窗口里有这次没写入的日桶');
  const deltas = growthDeltas(
    ordered.map((point) => ({
      day: point.day,
      mushroomCount: point.mushroomCount,
      matureCount: point.matureCount,
    })),
  );
  const mushrooms = deltas.map((item) => item.mushroomDelta);
  if (mushrooms.length < 2 || mushrooms[0] !== 6 || mushrooms[1] !== 8 || !(mushrooms[1] > mushrooms[0])) {
    throw new Error(`接口里的蘑菇增量是 ${mushrooms.join('、')}，读不出 6 → 8`);
  }
  return deltas;
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
    cameraCode,
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

export function formatShedGrowthDeltaProof({ samples, duplicates, webOrigin = webOriginFromEnv() }) {
  const ordered = [...samples].sort((a, b) => a.day.localeCompare(b.day));
  const deltas = growthDeltas(ordered);
  const lines = [
    `生长增量: ${ordered.length} 个日桶，${deltas.length} 个增量`,
    `棚区: ${DEMO_SHED}`,
    `摄像头: ${DEMO_CAMERA}`,
    deltaNote(
      '蘑菇增量',
      deltas.map((item) => item.mushroomDelta),
    ),
    deltaNote(
      '成熟增量',
      deltas.map((item) => item.matureDelta),
    ),
    '登录: admin / Admin@123456',
  ];
  let previous;
  for (const sample of ordered) {
    const reused = duplicates.get(sample.day) ? '沿用' : '新建';
    const mushroomDelta = previous ? sample.mushroomCount - previous.mushroomCount : null;
    const matureDelta = previous ? sample.matureCount - previous.matureCount : null;
    const mushroomText = mushroomDelta === null ? '—' : `+${mushroomDelta}`;
    const matureText = matureDelta === null ? '—' : `+${matureDelta}`;
    lines.push(
      `${sample.day}: 蘑菇 ${sample.mushroomCount}，成熟 ${sample.matureCount}，蘑菇增量 ${mushroomText}，成熟增量 ${matureText}（${reused}）`,
    );
    previous = sample;
  }
  lines.push(`打开: ${shedGrowthDeltaUrl({ days: 7 }, webOrigin)}`);
  lines.push(`三十日: ${shedGrowthDeltaUrl({ days: 30 }, webOrigin)}`);
  lines.push(`对照: ${shedGrowthDeltaUrl({ days: 7, cameraCode: CONTRAST_CAMERA }, webOrigin)}`);
  return lines.join('\n');
}

export async function sendShedGrowthDeltaDemo({ now = new Date() } = {}) {
  const samples = buildShedGrowthDeltaPayloads(now);
  validateShedGrowthDeltaPayloads(samples, now);
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
  assertDeltaPoints(week.body, samples);
  const month = await getJson(token, trendApiUrl(30, DEMO_CAMERA));
  if (!month.response.ok) {
    throw new Error(`30 日趋势失败 ${month.response.status} ${messageText(month.body) || JSON.stringify(month.body)}`);
  }
  if (month.body.days !== 30) throw new Error(`天数是 ${month.body.days}，应为 30`);
  assertDeltaPoints(month.body, samples);
  const contrast = await getJson(token, trendApiUrl(7, CONTRAST_CAMERA));
  if (!contrast.response.ok) {
    throw new Error(`对照趋势失败 ${contrast.response.status} ${messageText(contrast.body) || JSON.stringify(contrast.body)}`);
  }
  assertContrastEmpty(contrast.body);
  return { samples, duplicates };
}

function usage() {
  return `用法:
  node scripts/demo-shed-growth-delta.mjs

写入 ${DEMO_CAMERA} 四天的生长点，并打印单棚生长增量页地址。步骤见 docs/DEMO_SHED_GROWTH_DELTA.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const sent = await sendShedGrowthDeltaDemo();
    process.stdout.write(`${formatShedGrowthDeltaProof(sent)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
