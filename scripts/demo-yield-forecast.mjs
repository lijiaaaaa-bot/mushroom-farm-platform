#!/usr/bin/env node
/**
 * 写入 CAM-YF-01 三个上海日的成熟数，采摘页能看到未来 2–3 日的日桶增速估计。
 * 样例文件 recognition.demo-yield-forecast.json 不改数量。
 * 同一上海日再次运行沿用幂等键，不另建一行。
 * 演示走日桶增速：近 7 日至少两个相隔不少于 1 天的棚级成熟日桶即可外推。
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

export const DEMO_FIXTURE = 'recognition.demo-yield-forecast.json';
export const DEMO_CAMERA = 'CAM-YF-01';
export const DEMO_SHED = 'S01';
export const DEMO_ALGORITHM = '日桶增速';
export const DEMO_METHOD = '近 7 个上海自然日棚级成熟日桶首尾增速，外推未来 3 日';

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function pointInstant(now, offsetDays) {
  return new Date(now.getTime() - offsetDays * DAY_MS);
}

export function daysBetween(start, end) {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const ms = Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd);
  return Math.round(ms / 86_400_000);
}

export function buildYieldPayloads(now = new Date()) {
  const fixture = readFixture(DEMO_FIXTURE);
  const points = [...fixture.points].sort((a, b) => b.offsetDays - a.offsetDays);
  return points.map((point) => {
    const at = pointInstant(now, point.offsetDays);
    const day = contracts().shanghaiDate(at);
    return {
      offsetDays: point.offsetDays,
      day,
      mushroomCount: point.mushroomCount,
      matureCount: point.matureCount,
      body: {
        idempotencyKey: `demo-yield-forecast-${fixture.cameraCode}-${day}`,
        shedCode: fixture.shedCode,
        cameraCode: fixture.cameraCode,
        recognizedAt: at.toISOString(),
        mushroomCount: point.mushroomCount,
        matureCount: point.matureCount,
        capDiameters: [fixture.capDiameter],
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

export function validateYieldPayloads(samples, now = new Date()) {
  if (samples.length < 2) throw new Error('产量预估样例至少要两个相隔不少于 1 天的点');
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
    const day = contracts().shanghaiDate(new Date(value.recognizedAt));
    if (day !== sample.day) throw new Error(`识别日落在 ${day}，样例是 ${sample.day}`);
    if (sample.body.idempotencyKey !== `demo-yield-forecast-${DEMO_CAMERA}-${sample.day}`) {
      throw new Error('幂等键没有按摄像头和上海日固定');
    }
  }
  const ordered = [...parsed].sort((a, b) => a.sample.day.localeCompare(b.sample.day));
  for (let index = 1; index < ordered.length; index += 1) {
    const prev = ordered[index - 1].sample;
    const next = ordered[index].sample;
    if (daysBetween(prev.day, next.day) < 1) throw new Error('样例日期间隔不足 1 天');
    if (next.matureCount <= prev.matureCount) throw new Error('成熟数量没有随日期变大');
  }
  const today = contracts().shanghaiDate(now);
  const oldest = ordered[0].sample;
  if (daysBetween(oldest.day, today) > 6) {
    throw new Error(`${oldest.day} 不在近 7 个上海自然日里`);
  }
  const keys = new Set(parsed.map((item) => item.sample.body.idempotencyKey));
  if (keys.size !== parsed.length) throw new Error('各日的幂等键重复了');
  return parsed.map((item) => item.value);
}

export function projectSeed(samples, today) {
  const points = [...samples].sort((a, b) => a.day.localeCompare(b.day));
  const first = points[0];
  const last = points[points.length - 1];
  const span = daysBetween(first.day, last.day);
  if (span < 1) throw new Error('种子历史间隔不足 1 天');
  const speed = (last.matureCount - first.matureCount) / span;
  return {
    historyDays: points.length,
    spanDays: span,
    from: first.day,
    to: last.day,
    speedPerDay: Math.round(speed * 100) / 100,
    days: [1, 2, 3].map((offset) => {
      const date = contracts().shiftShanghaiDate(today, offset);
      return {
        date,
        offsetDays: offset,
        matureCount: Math.max(0, Math.round(last.matureCount + speed * daysBetween(last.day, date))),
      };
    }),
  };
}

export function harvestForecastUrl(webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  return `${origin}/harvest`;
}

export function assertForecastDays(body) {
  if (!body || body.label !== '估计') throw new Error('预估响应没有「估计」标签');
  if (body.sufficient !== true) {
    throw new Error(body.message || '预估 days 为空');
  }
  if (body.method !== DEMO_METHOD) throw new Error(`算法说明是 ${body.method}`);
  const days = Array.isArray(body.days) ? body.days : [];
  if (days.length < 2 || days.length > 3) {
    throw new Error(`未来天数是 ${days.length}，应为 2 或 3`);
  }
  if (typeof body.historyDays !== 'number' || body.historyDays < 2) {
    throw new Error(`历史天数是 ${body.historyDays}，至少要 2`);
  }
  for (const day of days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date)) throw new Error(`未来日期无效：${day.date}`);
    if (!Number.isInteger(day.matureCount) || day.matureCount < 0) {
      throw new Error(`${day.date} 的成熟数不是非负整数`);
    }
  }
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

export function formatYieldProof({
  samples,
  duplicates = new Map(),
  forecast,
  yieldEstimate,
  webOrigin = webOriginFromEnv(),
}) {
  assertForecastDays(forecast);
  const ordered = [...samples].sort((a, b) => a.day.localeCompare(b.day));
  const span = daysBetween(ordered[0].day, ordered[ordered.length - 1].day);
  const lines = [
    `算法: ${DEMO_ALGORITHM}`,
    `方法: ${forecast.method}`,
    `历史天数: ${forecast.historyDays}`,
    `历史跨度: ${ordered[0].day} 至 ${ordered[ordered.length - 1].day}（间隔 ${span} 天）`,
    `每日增速: ${forecast.speedPerDay}`,
    `棚区: ${DEMO_SHED}`,
    `摄像头: ${DEMO_CAMERA}`,
    '登录: admin / Admin@123456',
  ];
  for (const sample of ordered) {
    const reused = duplicates.get(sample.day) ? '沿用' : '新建';
    lines.push(
      `${sample.day}: 蘑菇 ${sample.mushroomCount}，成熟 ${sample.matureCount}（${reused}）`,
    );
  }
  lines.push('未来成熟数:');
  for (const day of forecast.days) {
    lines.push(`${day.date}: 估计 ${day.matureCount} 成熟`);
  }
  lines.push(`打开: ${harvestForecastUrl(webOrigin)}`);
  const thin = !yieldEstimate || yieldEstimate.sufficient !== true || !yieldEstimate.days?.length;
  if (thin) {
    lines.push('对照: 30 日线性 days 为空');
    if (yieldEstimate?.message) lines.push(`说明: ${yieldEstimate.message}`);
  } else {
    lines.push(`对照: 30 日线性也有 ${yieldEstimate.days.length} 日`);
  }
  return lines.join('\n');
}

export async function sendYieldForecastDemo({ now = new Date() } = {}) {
  const samples = buildYieldPayloads(now);
  validateYieldPayloads(samples, now);
  const duplicates = new Map();
  for (const sample of samples) {
    const sent = await postRecognition(sample.body);
    duplicates.set(sample.day, sent.duplicate);
  }
  const token = await login();
  const today = contracts().shanghaiDate(now);
  const shed = await getJson(
    token,
    `${apiBase()}/harvest/bucket-forecast?shedCode=${encodeURIComponent(DEMO_SHED)}`,
  );
  if (!shed.response.ok) {
    throw new Error(`棚区预估失败 ${shed.response.status} ${messageText(shed.body) || JSON.stringify(shed.body)}`);
  }
  assertForecastDays(shed.body);
  if (shed.body.shedCode !== DEMO_SHED) {
    throw new Error(`预估棚区是 ${shed.body.shedCode}，应为 ${DEMO_SHED}`);
  }
  const seeded = projectSeed(samples, today);
  if (shed.body.historyDays === seeded.historyDays) {
    if (shed.body.speedPerDay !== seeded.speedPerDay) {
      throw new Error(`每日增速是 ${shed.body.speedPerDay}，种子是 ${seeded.speedPerDay}`);
    }
    const actual = shed.body.days.map((day) => `${day.date}:${day.matureCount}`);
    const expected = seeded.days.map((day) => `${day.date}:${day.matureCount}`);
    if (actual.join(',') !== expected.join(',')) {
      throw new Error(`未来成熟数是 ${actual.join('，')}，种子外推是 ${expected.join('，')}`);
    }
  }
  const page = await getJson(token, `${apiBase()}/harvest/bucket-forecast`);
  if (!page.response.ok) {
    throw new Error(`页面预估失败 ${page.response.status} ${messageText(page.body) || JSON.stringify(page.body)}`);
  }
  assertForecastDays(page.body);
  const linear = await getJson(token, `${apiBase()}/harvest/yield-estimate`);
  if (!linear.response.ok) {
    throw new Error(`30 日线性失败 ${linear.response.status} ${messageText(linear.body) || JSON.stringify(linear.body)}`);
  }
  if (linear.body?.label !== '估计') throw new Error('30 日线性响应没有「估计」标签');
  return {
    samples,
    duplicates,
    forecast: page.body,
    shedForecast: shed.body,
    yieldEstimate: linear.body,
  };
}

function usage() {
  return `用法:
  node scripts/demo-yield-forecast.mjs

写入 ${DEMO_CAMERA} 三天成熟数，并打印日桶增速的未来 2–3 日成熟估计。步骤见 docs/DEMO_YIELD_FORECAST.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const sent = await sendYieldForecastDemo();
    process.stdout.write(`${formatYieldProof(sent)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
