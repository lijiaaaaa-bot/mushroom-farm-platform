#!/usr/bin/env node
/**
 * 写入 CAM-GG-01 六个上海日，生长趋势页的日、周、月点数和周期标签不同。
 * 样例仍是 recognition.demo-growth-trend.json，只改本次请求的时间、摄像头和幂等键。
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

export const DEMO_FIXTURE = 'recognition.demo-growth-trend.json';
export const DEMO_CAMERA = 'CAM-GG-01';
export const DEMO_SHED = 'S01';

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function mondayOf(day) {
  const [year, month, date] = day.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, date));
  const dow = utc.getUTCDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  utc.setUTCDate(utc.getUTCDate() + offset);
  return utc.toISOString().slice(0, 10);
}

export function shiftDay(day, delta) {
  const [year, month, date] = day.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, date));
  utc.setUTCDate(utc.getUTCDate() + delta);
  return utc.toISOString().slice(0, 10);
}

export function periodKey(day, grain) {
  if (grain === 'month') return day.slice(0, 7);
  if (grain === 'week') return mondayOf(day);
  return day;
}

function level(fixture, mushroomCount) {
  const point = fixture.points.find((item) => item.mushroomCount === mushroomCount);
  if (!point) throw new Error(`样例里没有蘑菇 ${mushroomCount}`);
  return { mushroomCount: point.mushroomCount, matureCount: point.matureCount };
}

export function diameterFor(day) {
  const epoch = Date.parse('2026-01-01T00:00:00.000Z');
  const dayIndex = Math.round((Date.parse(`${day}T00:00:00.000Z`) - epoch) / 86400000);
  return Math.round((3 + dayIndex * 0.05) * 100) / 100;
}

export function grainPlan(today) {
  const thisMonday = mondayOf(today);
  const mondays = [3, 2, 1].map((weeksAgo) => shiftDay(thisMonday, -7 * weeksAgo));
  return mondays.flatMap((monday, index) => {
    const closing = index === mondays.length - 1 ? 21 : 14;
    return [
      { day: monday, mushroomCount: 8 },
      { day: shiftDay(monday, 2), mushroomCount: closing },
    ];
  });
}

export function buildGrainPayloads(now = new Date()) {
  const fixture = readFixture(DEMO_FIXTURE);
  const today = contracts().shanghaiDate(now);
  return grainPlan(today).map((point) => {
    const counts = level(fixture, point.mushroomCount);
    const at = new Date(`${point.day}T12:00:00+08:00`);
    const diameter = diameterFor(point.day);
    return {
      day: point.day,
      diameter,
      mushroomCount: counts.mushroomCount,
      matureCount: counts.matureCount,
      body: {
        idempotencyKey: `demo-growth-grain-${DEMO_CAMERA}-${point.day}`,
        shedCode: fixture.shedCode,
        cameraCode: DEMO_CAMERA,
        recognizedAt: at.toISOString(),
        mushroomCount: counts.mushroomCount,
        matureCount: counts.matureCount,
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

export function rollupSamples(samples, grain) {
  const groups = new Map();
  for (const sample of samples) {
    const key = periodKey(sample.day, grain);
    const list = groups.get(key) ?? [];
    list.push(sample);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, list]) => {
      const sorted = [...list].sort((a, b) => a.day.localeCompare(b.day));
      const last = sorted[sorted.length - 1];
      const caps = sorted.map((item) => item.diameter);
      const capDiameterMean =
        Math.round((caps.reduce((sum, value) => sum + value, 0) / caps.length) * 10) / 10;
      return {
        period,
        mushroomCount: last.mushroomCount,
        matureCount: last.matureCount,
        capDiameterMean,
        sampleCount: sorted.length,
        days: sorted.map((item) => item.day),
      };
    });
}

export function assertReadableGrain(samples, now = new Date()) {
  if (samples.length !== 6) throw new Error(`日点数是 ${samples.length}，应为 6`);
  const today = contracts().shanghaiDate(now);
  const from = shiftDay(today, -29);
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
    if (value.cameraCode === 'CAM-GT-01' || value.cameraCode === 'CAM-DEMO-01') {
      throw new Error('这次不应占用生长趋势或单条识别的摄像头');
    }
    if (value.mushroomCount !== sample.mushroomCount || value.matureCount !== sample.matureCount) {
      throw new Error('报文里的蘑菇数或成熟数和样例不一致');
    }
    if (value.matureCount / value.mushroomCount >= 0.6) {
      throw new Error('成熟占比达到种子规则「成熟占比一般」的 0.6');
    }
    if (value.diseaseCount !== 0 || value.diseaseLevel !== 0) {
      throw new Error('这次样例的病害数量或等级不是 0');
    }
    if (value.temperature !== 22.5) throw new Error(`温度是 ${value.temperature}，应为 22.5`);
    const day = contracts().shanghaiDate(new Date(value.recognizedAt));
    if (day !== sample.day) throw new Error(`识别日落在 ${day}，样例是 ${sample.day}`);
    if (sample.day < from || sample.day > today) throw new Error(`${sample.day} 不在近 30 个上海日里`);
    if (sample.body.idempotencyKey !== `demo-growth-grain-${DEMO_CAMERA}-${sample.day}`) {
      throw new Error('幂等键没有按摄像头和上海日固定');
    }
  }
  const days = new Set(samples.map((sample) => sample.day));
  if (days.size !== samples.length) throw new Error('上海日重复了');
  const day = rollupSamples(samples, 'day');
  const week = rollupSamples(samples, 'week');
  const month = rollupSamples(samples, 'month');
  if (!(day.length > week.length && week.length > month.length)) {
    throw new Error(`点数应是日 > 周 > 月，实际 ${day.length}、${week.length}、${month.length}`);
  }
  if (week.length !== 3) throw new Error(`周点数是 ${week.length}，应为 3`);
  if (month.length < 1 || month.length > 2) throw new Error(`月点数是 ${month.length}，应为 1 或 2`);
  for (const point of week) {
    if (point.days.length < 2) throw new Error(`${point.period} 这一周少于两天`);
    if (mondayOf(point.period) !== point.period) throw new Error(`${point.period} 不是周一`);
    if (point.mushroomCount === 8) throw new Error('周的蘑菇数仍是周一的 8');
    const last = point.days[point.days.length - 1];
    const lastSample = samples.find((sample) => sample.day === last);
    if (point.mushroomCount !== lastSample.mushroomCount) {
      throw new Error(`${point.period} 没有取该周最后一天的蘑菇数`);
    }
  }
  for (const point of month) {
    if (!/^\d{4}-\d{2}$/.test(point.period)) throw new Error(`月周期 ${point.period} 不是 YYYY-MM`);
  }
  const weekLabels = week.map((point) => point.period).join('、');
  const monthLabels = month.map((point) => point.period).join('、');
  const dayLabels = day.map((point) => point.period).join('、');
  if (weekLabels === dayLabels || monthLabels === weekLabels || monthLabels === dayLabels) {
    throw new Error('日、周、月的周期标签没有分开');
  }
  return { day, week, month };
}

export function grainTrendUrl(grain, webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const params = new URLSearchParams({
    days: '30',
    grain,
    shedCode: DEMO_SHED,
    cameraCode: DEMO_CAMERA,
  });
  return `${origin}/growth-trends?${params.toString()}`;
}

export function formatGrainProof({ samples, duplicates, webOrigin = webOriginFromEnv(), now = new Date() }) {
  const { day, week, month } = assertReadableGrain(samples, now);
  const lines = [
    `生长粒度: 日 ${day.length} 个点，周 ${week.length} 个点，月 ${month.length} 个点`,
    `棚区: ${DEMO_SHED}`,
    `摄像头: ${DEMO_CAMERA}`,
    '登录: admin / Admin@123456',
    `日周期: ${day.map((point) => point.period).join('、')}`,
    `周周期: ${week.map((point) => `${point.period} 蘑菇 ${point.mushroomCount}`).join('、')}`,
    `月周期: ${month.map((point) => `${point.period} 蘑菇 ${point.mushroomCount}`).join('、')}`,
  ];
  for (const sample of [...samples].sort((a, b) => a.day.localeCompare(b.day))) {
    const reused = duplicates?.get(sample.day) ? '沿用' : '新建';
    lines.push(
      `${sample.day}: 蘑菇 ${sample.mushroomCount}，成熟 ${sample.matureCount}（${reused}）`,
    );
  }
  lines.push(`日: ${grainTrendUrl('day', webOrigin)}`);
  lines.push(`周: ${grainTrendUrl('week', webOrigin)}`);
  lines.push(`月: ${grainTrendUrl('month', webOrigin)}`);
  return lines.join('\n');
}

function cameraPoints(series) {
  const sheds = Array.isArray(series?.sheds) ? series.sheds : [];
  const shed = sheds.find((item) => item?.shedCode === DEMO_SHED);
  if (!shed) throw new Error(`趋势里没有棚区 ${DEMO_SHED}`);
  const camera = (shed.cameras || []).find((item) => item?.cameraCode === DEMO_CAMERA);
  if (!camera) throw new Error(`趋势里没有摄像头 ${DEMO_CAMERA}`);
  return Array.isArray(camera.points) ? camera.points : [];
}

export function assertApiGrain(series, samples, grain) {
  if (series?.grain !== grain) throw new Error(`粒度是 ${series?.grain}，应为 ${grain}`);
  if (series?.days !== 30) throw new Error(`天数是 ${series?.days}，应为 30`);
  const expected = rollupSamples(samples, grain);
  const points = cameraPoints(series);
  if (points.length !== expected.length) {
    throw new Error(`${grain} 点数是 ${points.length}，应为 ${expected.length}`);
  }
  for (const item of expected) {
    const point = points.find((row) => row?.day === item.period);
    if (!point) throw new Error(`${grain} 没有周期 ${item.period}`);
    if (point.mushroomCount !== item.mushroomCount) {
      throw new Error(`${item.period} 蘑菇数量是 ${point.mushroomCount}，应为 ${item.mushroomCount}`);
    }
    if (point.matureCount !== item.matureCount) {
      throw new Error(`${item.period} 成熟数量是 ${point.matureCount}，应为 ${item.matureCount}`);
    }
    if (point.sampleCount !== item.sampleCount) {
      throw new Error(`${item.period} 样本数是 ${point.sampleCount}，应为 ${item.sampleCount}`);
    }
  }
  return points;
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

function trendApiUrl(grain) {
  const params = new URLSearchParams({
    days: '30',
    grain,
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

export async function sendGrowthGrainDemo({ now = new Date() } = {}) {
  const samples = buildGrainPayloads(now);
  assertReadableGrain(samples, now);
  const duplicates = new Map();
  for (const sample of samples) {
    const sent = await postRecognition(sample.body);
    duplicates.set(sample.day, sent.duplicate);
  }
  const token = await login();
  for (const grain of ['day', 'week', 'month']) {
    const loaded = await getJson(token, trendApiUrl(grain));
    if (!loaded.response.ok) {
      throw new Error(
        `${grain} 趋势失败 ${loaded.response.status} ${messageText(loaded.body) || JSON.stringify(loaded.body)}`,
      );
    }
    assertApiGrain(loaded.body, samples, grain);
  }
  return { samples, duplicates, now };
}

function usage() {
  return `用法:
  node scripts/demo-growth-grain.mjs

写入 ${DEMO_CAMERA} 六个上海日，并打印日、周、月三个地址。步骤见 docs/DEMO_GROWTH_GRAIN.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const sent = await sendGrowthGrainDemo();
    process.stdout.write(`${formatGrainProof(sent)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
