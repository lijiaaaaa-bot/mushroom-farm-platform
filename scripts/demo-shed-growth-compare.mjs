#!/usr/bin/env node
/**
 * 写入 CAM-SG-S01（S01）与 CAM-SG-S02（S02）各三天识别。
 * 同一上海日 S01 蘑菇数高于 S02。当天是 21 和 8。
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
const SHED_BONUS = { S01: 1.5, S02: 0 };
const OFFSET_BONUS = { 5: 0, 2: 0.35, 0: 0.7 };

export const DEMO_FIXTURE = 'recognition.demo-shed-growth-compare.json';
export const DEMO_KEY_PREFIX = 'demo-shed-growth-compare';

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function pointInstant(now, offsetDays) {
  return new Date(now.getTime() - offsetDays * DAY_MS);
}

export function diameterFor(day, offsetDays, shedCode) {
  const epoch = Date.parse('2026-01-01T00:00:00.000Z');
  const dayIndex = Math.round((Date.parse(`${day}T00:00:00.000Z`) - epoch) / 86400000);
  const bonus = (SHED_BONUS[shedCode] ?? 0) + (OFFSET_BONUS[offsetDays] ?? 0);
  return Math.round((2.2 + dayIndex * 0.02 + bonus) * 100) / 100;
}

export function buildComparePayloads(now = new Date()) {
  const fixture = readFixture(DEMO_FIXTURE);
  const sheds = [...fixture.sheds].sort((a, b) => a.shedCode.localeCompare(b.shedCode));
  const samples = [];
  for (const shed of sheds) {
    const points = [...shed.points].sort((a, b) => b.offsetDays - a.offsetDays);
    for (const point of points) {
      const at = pointInstant(now, point.offsetDays);
      const day = contracts().shanghaiDate(at);
      const diameter = diameterFor(day, point.offsetDays, shed.shedCode);
      samples.push({
        shedCode: shed.shedCode,
        cameraCode: shed.cameraCode,
        offsetDays: point.offsetDays,
        day,
        diameter,
        mushroomCount: point.mushroomCount,
        matureCount: point.matureCount,
        body: {
          idempotencyKey: `${DEMO_KEY_PREFIX}-${shed.cameraCode}-${day}`,
          shedCode: shed.shedCode,
          cameraCode: shed.cameraCode,
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
      });
    }
  }
  return samples;
}

export function validateComparePayloads(samples, now = new Date()) {
  const shedCodes = new Set(samples.map((sample) => sample.shedCode));
  if (shedCodes.size < 2) throw new Error('棚间对比样例至少要两个棚');
  if (samples.length < 4) throw new Error('棚间对比样例至少要两个棚各两个点');
  const parsed = samples.map((sample) => {
    const result = contracts().parseRecognitionIngress(sample.body, now);
    if (!result.ok) throw new Error(`样例未通过契约：${result.errors.join('；')}`);
    return { sample, value: result.value };
  });
  for (const { sample, value } of parsed) {
    if (value.shedCode !== sample.shedCode) {
      throw new Error(`棚区是 ${value.shedCode}，应为 ${sample.shedCode}`);
    }
    if (value.cameraCode !== sample.cameraCode) {
      throw new Error(`摄像头是 ${value.cameraCode}，应为 ${sample.cameraCode}`);
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
    const key = `${DEMO_KEY_PREFIX}-${sample.cameraCode}-${sample.day}`;
    if (sample.body.idempotencyKey !== key) throw new Error('幂等键没有按摄像头和上海日固定');
  }
  const keys = new Set(parsed.map((item) => item.sample.body.idempotencyKey));
  if (keys.size !== parsed.length) throw new Error('幂等键重复了');
  for (const shedCode of shedCodes) {
    const ordered = parsed
      .filter((item) => item.sample.shedCode === shedCode)
      .sort((a, b) => a.sample.day.localeCompare(b.sample.day));
    for (let index = 1; index < ordered.length; index += 1) {
      const prev = ordered[index - 1].sample;
      const next = ordered[index].sample;
      if (next.mushroomCount <= prev.mushroomCount) {
        throw new Error(`${shedCode} 蘑菇数量没有随日期变大`);
      }
      if (next.matureCount <= prev.matureCount) {
        throw new Error(`${shedCode} 成熟数量没有随日期变大`);
      }
      if (next.diameter <= prev.diameter) throw new Error(`${shedCode} 菌盖直径没有随日期变大`);
    }
  }
  const days = new Set(samples.map((sample) => sample.day));
  for (const day of days) {
    const onDay = samples.filter((sample) => sample.day === day);
    const s01 = onDay.find((sample) => sample.shedCode === 'S01');
    const s02 = onDay.find((sample) => sample.shedCode === 'S02');
    if (!s01 || !s02) throw new Error(`${day} 没有同时落到 S01 和 S02`);
    if (s01.mushroomCount <= s02.mushroomCount) {
      throw new Error(`${day} S01 蘑菇 ${s01.mushroomCount} 没有高于 S02 蘑菇 ${s02.mushroomCount}`);
    }
    if (s01.diameter <= s02.diameter) throw new Error(`${day} S01 菌盖没有大于 S02`);
  }
  return parsed.map((item) => item.value);
}

export function compareUrl({ days = 7 } = {}, webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const params = new URLSearchParams({ days: String(days) });
  return `${origin}/growth-compare?${params.toString()}`;
}

export function assertShedGap(series, samples) {
  const sheds = Array.isArray(series?.sheds) ? series.sheds : [];
  const shedCodes = new Set(samples.map((sample) => sample.shedCode));
  if (shedCodes.size < 2) throw new Error('样例至少要两个棚');
  for (const sample of samples) {
    const shed = sheds.find((item) => item?.shedCode === sample.shedCode);
    if (!shed) throw new Error(`趋势里没有棚区 ${sample.shedCode}`);
    const camera = (shed.cameras || []).find((item) => item?.cameraCode === sample.cameraCode);
    if (!camera) throw new Error(`趋势里没有摄像头 ${sample.cameraCode}`);
    const point = (camera.points || []).find((item) => item?.day === sample.day);
    if (!point) throw new Error(`没有 ${sample.shedCode} ${sample.day} 的点`);
    if (point.mushroomCount !== sample.mushroomCount) {
      throw new Error(
        `${sample.day} ${sample.cameraCode} 蘑菇数量是 ${point.mushroomCount}，应为 ${sample.mushroomCount}`,
      );
    }
    if (point.matureCount !== sample.matureCount) {
      throw new Error(
        `${sample.day} ${sample.cameraCode} 成熟数量是 ${point.matureCount}，应为 ${sample.matureCount}`,
      );
    }
    if (point.capDiameterMean !== sample.diameter) {
      throw new Error(
        `${sample.day} ${sample.cameraCode} 菌盖直径是 ${point.capDiameterMean}，应为 ${sample.diameter}`,
      );
    }
  }
  const latest = [...samples].map((sample) => sample.day).sort().at(-1);
  const s01 = samples.find((sample) => sample.day === latest && sample.shedCode === 'S01');
  const s02 = samples.find((sample) => sample.day === latest && sample.shedCode === 'S02');
  if (!s01 || !s02) throw new Error('当天没有同时落到 S01 和 S02');
  if (s01.mushroomCount <= s02.mushroomCount) {
    throw new Error(`当天 S01 蘑菇 ${s01.mushroomCount} 没有高于 S02 蘑菇 ${s02.mushroomCount}`);
  }
  const rollup = (code) => {
    const shed = sheds.find((item) => item?.shedCode === code);
    const point = (shed?.points || []).find((item) => item?.day === latest);
    return point?.mushroomCount;
  };
  const s01Rollup = rollup('S01');
  const s02Rollup = rollup('S02');
  if (typeof s01Rollup !== 'number' || typeof s02Rollup !== 'number') {
    throw new Error('当天棚汇总缺少蘑菇数');
  }
  if (s01Rollup < s01.mushroomCount || s02Rollup < s02.mushroomCount) {
    throw new Error('棚汇总小于这一台摄像头的蘑菇数');
  }
  if (s01Rollup <= s02Rollup) {
    throw new Error(`当天棚汇总 S01 蘑菇 ${s01Rollup} 没有高于 S02 蘑菇 ${s02Rollup}`);
  }
  return { latest, s01: s01.mushroomCount, s02: s02.mushroomCount, s01Rollup, s02Rollup };
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
  const params = new URLSearchParams({ days: String(days) });
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

export function formatCompareProof({ samples, duplicates, webOrigin = webOriginFromEnv() }) {
  const latest = [...samples].map((sample) => sample.day).sort().at(-1);
  const s01 = samples.find((sample) => sample.day === latest && sample.shedCode === 'S01');
  const s02 = samples.find((sample) => sample.day === latest && sample.shedCode === 'S02');
  const lines = [
    `棚间对比: ${new Set(samples.map((sample) => sample.shedCode)).size} 个棚`,
    '摄像头: CAM-SG-S01、CAM-SG-S02',
    '天数: 7',
    '登录: admin / Admin@123456',
    `当天: ${latest} S01 蘑菇 ${s01?.mushroomCount}，S02 蘑菇 ${s02?.mushroomCount}`,
  ];
  for (const sample of [...samples].sort(
    (a, b) => a.day.localeCompare(b.day) || a.shedCode.localeCompare(b.shedCode),
  )) {
    const reused = duplicates.get(sample.body.idempotencyKey) ? '沿用' : '新建';
    lines.push(
      `${sample.day} ${sample.shedCode} ${sample.cameraCode}: 蘑菇 ${sample.mushroomCount}，成熟 ${sample.matureCount}，菌盖 ${sample.diameter}（${reused}）`,
    );
  }
  lines.push(`打开: ${compareUrl({ days: 7 }, webOrigin)}`);
  lines.push(`三十日: ${compareUrl({ days: 30 }, webOrigin)}`);
  return lines.join('\n');
}

export async function sendShedGrowthCompare({ now = new Date() } = {}) {
  const samples = buildComparePayloads(now);
  validateComparePayloads(samples, now);
  const duplicates = new Map();
  for (const sample of samples) {
    const sent = await postRecognition(sample.body);
    duplicates.set(sample.body.idempotencyKey, sent.duplicate);
  }
  const token = await login();
  const week = await getJson(token, trendApiUrl(7));
  if (!week.response.ok) {
    throw new Error(`7 日趋势失败 ${week.response.status} ${messageText(week.body) || JSON.stringify(week.body)}`);
  }
  if (week.body.days !== 7) throw new Error(`天数是 ${week.body.days}，应为 7`);
  if (String(trendApiUrl(7)).includes('shedCode=')) throw new Error('棚间对比不应按单棚过滤');
  assertShedGap(week.body, samples);
  const month = await getJson(token, trendApiUrl(30));
  if (!month.response.ok) {
    throw new Error(`30 日趋势失败 ${month.response.status} ${messageText(month.body) || JSON.stringify(month.body)}`);
  }
  if (month.body.days !== 30) throw new Error(`天数是 ${month.body.days}，应为 30`);
  assertShedGap(month.body, samples);
  return { samples, duplicates };
}

function usage() {
  return `用法:
  node scripts/demo-shed-growth-compare.mjs

写入 CAM-SG-S01 与 CAM-SG-S02 各三天的生长点，并打印棚间对比页地址。步骤见 docs/DEMO_SHED_GROWTH_COMPARE.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const sent = await sendShedGrowthCompare();
    process.stdout.write(`${formatCompareProof(sent)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
