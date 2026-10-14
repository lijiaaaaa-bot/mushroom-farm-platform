#!/usr/bin/env node
/**
 * 在 S01 留下批次 FB-DEMO-01，记下出菇、快速生长、成熟，
 * 并写入棚级日桶，回放窗口里能看到蘑菇数、成熟数和菌盖。
 * 样例文件 recognition.demo-one.json 不改。不改采摘任务演示。
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

export const DEMO_FIXTURE = 'recognition.demo-fruiting-batch.json';
export const DEMO_SHED = 'S01';
export const DEMO_BATCH = 'FB-DEMO-01';
export const DEMO_CAMERA = 'CAM-FB-01';
export const PHASES = ['flush', 'fast_growth', 'mature'];

export const PHASE_LABEL = {
  flush: '出菇',
  fast_growth: '快速生长',
  mature: '成熟',
};

const PHASE_OFFSET = {
  fast_growth: 3,
  mature: 1,
};

const PHASE_BUMP_MS = {
  fast_growth: 60 * 1000,
  mature: 120 * 1000,
};

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function pointInstant(now, offsetDays) {
  return new Date(now.getTime() - offsetDays * DAY_MS);
}

export function diameterFor(day, offsetDays) {
  const epoch = Date.parse('2026-01-01T00:00:00.000Z');
  const dayIndex = Math.round((Date.parse(`${day}T00:00:00.000Z`) - epoch) / 86400000);
  const bonus = offsetDays === 5 ? 0 : offsetDays === 2 ? 0.2 : 0.45;
  return Math.round((3 + dayIndex * 0.06 + bonus) * 100) / 100;
}

export function phaseInstant(now, phase, startedAt) {
  const start = new Date(startedAt).getTime();
  const offset = PHASE_OFFSET[phase];
  const desired = pointInstant(now, offset).getTime();
  let at = Math.max(desired, start + PHASE_BUMP_MS[phase]);
  if (at > now.getTime()) at = now.getTime();
  if (at < start) at = start;
  return new Date(at);
}

export function buildFruitingSamples(now = new Date()) {
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
        idempotencyKey: `demo-fruiting-batch-${fixture.cameraCode}-${day}`,
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

export function validateFruitingSamples(samples, now = new Date()) {
  if (samples.length < 2) throw new Error('出菇回放样例至少要两个点');
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
    if (value.cameraCode === 'CAM-DEMO-01' || value.cameraCode.startsWith('CAM-HT-')) {
      throw new Error('这次样例用了采摘或一条识别的摄像头');
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
    if (sample.body.idempotencyKey !== `demo-fruiting-batch-${DEMO_CAMERA}-${sample.day}`) {
      throw new Error('幂等键没有按摄像头和上海日固定');
    }
  }
  const ordered = [...parsed].sort((a, b) => a.sample.day.localeCompare(b.sample.day));
  for (let index = 1; index < ordered.length; index += 1) {
    const prev = ordered[index - 1].sample;
    const next = ordered[index].sample;
    if (next.mushroomCount <= prev.mushroomCount) throw new Error('蘑菇数量没有随日期变大');
    if (next.matureCount <= prev.matureCount) throw new Error('成熟数量没有随日期变大');
    if (next.diameter - prev.diameter < 0.05) throw new Error('菌盖直径增幅小于 0.05');
  }
  const keys = new Set(parsed.map((item) => item.sample.body.idempotencyKey));
  if (keys.size !== parsed.length) throw new Error('各天的幂等键重复了');
  return parsed.map((item) => item.value);
}

export function batchesPageUrl(batchCode = DEMO_BATCH, webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const params = new URLSearchParams({ batchCode });
  return `${origin}/batches?${params.toString()}`;
}

export function nextPhasePosts(events, phase, closedAt) {
  if (closedAt) return [];
  const have = new Set((events || []).map((event) => event?.phase).filter(Boolean));
  const posts = [];
  let current = phase;
  if (!have.has('fast_growth')) {
    posts.push('fast_growth');
    current = 'fast_growth';
    have.add('fast_growth');
  }
  if (!have.has('mature') || current !== 'mature') posts.push('mature');
  return posts;
}

export function assertFruitingReplay(replay, samples) {
  const batch = replay?.batch;
  if (!batch) throw new Error('回放没有批次');
  if (batch.shedCode !== DEMO_SHED) throw new Error(`回放棚区是 ${batch.shedCode}，应为 ${DEMO_SHED}`);
  if (batch.batchCode !== DEMO_BATCH) throw new Error(`回放批次是 ${batch.batchCode}，应为 ${DEMO_BATCH}`);
  if (batch.phase !== 'mature') throw new Error(`当前阶段是 ${batch.phase}，应为 mature`);
  const phases = Array.isArray(replay.phases) ? replay.phases : [];
  const names = phases.map((event) => event?.phase);
  for (const phase of PHASES) {
    if (!names.includes(phase)) throw new Error(`阶段里没有 ${PHASE_LABEL[phase]}`);
  }
  const flushAt = names.indexOf('flush');
  const fastAt = names.indexOf('fast_growth');
  const matureAt = names.indexOf('mature');
  if (!(flushAt < fastAt && fastAt < matureAt)) {
    throw new Error('阶段顺序不是出菇、快速生长、成熟');
  }
  const curve = Array.isArray(replay.curve) ? replay.curve : [];
  if (curve.length < 2) throw new Error(`回放只有 ${curve.length} 天，至少要 2 天`);
  const startDay = contracts().shanghaiDate(new Date(batch.startedAt));
  const covered = samples.filter((sample) => sample.day >= startDay);
  if (covered.length < 2) throw new Error('批次开始日晚于回放样例，窗口里不足两天');
  for (const sample of covered) {
    const point = curve.find((item) => item?.day === sample.day);
    if (!point) throw new Error(`回放没有 ${sample.day}`);
    if (typeof point.mushroomCount !== 'number' || point.mushroomCount < sample.mushroomCount) {
      throw new Error(`${sample.day} 蘑菇数是 ${point.mushroomCount}，应不少于 ${sample.mushroomCount}`);
    }
    if (typeof point.matureCount !== 'number' || point.matureCount < sample.matureCount) {
      throw new Error(`${sample.day} 成熟数是 ${point.matureCount}，应不少于 ${sample.matureCount}`);
    }
    if (typeof point.capDiameterMean !== 'number' || !Number.isFinite(point.capDiameterMean)) {
      throw new Error(`${sample.day} 没有菌盖直径`);
    }
  }
  return { batch, phases, curve };
}

export function formatFruitingProof({
  batch,
  phases,
  curve,
  phaseWrites,
  webOrigin = webOriginFromEnv(),
}) {
  const recorded = PHASES.map((phase) => {
    const how = phaseWrites?.[phase] || '沿用';
    return `${PHASE_LABEL[phase]}（${how}）`;
  }).join(' → ');
  const timeline = phases
    .map((event) => {
      const day = contracts().shanghaiDate(new Date(event.occurredAt));
      return `${PHASE_LABEL[event.phase] || event.phase} ${day}`;
    })
    .join(' → ');
  const lines = [
    `棚区: ${batch.shedCode}`,
    `批次: ${batch.batchCode}`,
    `当前阶段: ${PHASE_LABEL[batch.phase] || batch.phase}`,
    `阶段记录: ${recorded}`,
    `阶段: ${timeline}`,
    `回放: ${curve[0].day} 至 ${curve[curve.length - 1].day}，共 ${curve.length} 天`,
  ];
  for (const point of curve) {
    lines.push(
      `${point.day}: 蘑菇 ${point.mushroomCount ?? '—'}，成熟 ${point.matureCount ?? '—'}，菌盖 ${point.capDiameterMean ?? '—'}`,
    );
  }
  lines.push('登录: admin / Admin@123456');
  lines.push(`打开: ${batchesPageUrl(batch.batchCode, webOrigin)}`);
  return lines.join('\n');
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
  return { id, duplicate, snapshotStored: nestedFlag(payload, 'snapshotStored') };
}

function itemsOf(page) {
  return Array.isArray(page?.items) ? page.items : [];
}

async function ensureBatch(token, startedAt) {
  const listUrl = `${apiBase()}/batches?shedCode=${encodeURIComponent(DEMO_SHED)}`;
  const listed = await getJson(token, listUrl);
  if (!listed.response.ok) {
    throw new Error(`读取批次失败 ${listed.response.status} ${messageText(listed.body) || JSON.stringify(listed.body)}`);
  }
  const found = itemsOf(listed.body).find((item) => item?.batchCode === DEMO_BATCH);
  if (found?.id) return { batch: found, created: false };
  const created = await sendJson(token, 'POST', `${apiBase()}/batches`, {
    shedCode: DEMO_SHED,
    batchCode: DEMO_BATCH,
    startedAt,
    note: '演示出菇批次',
  });
  if (created.response.status === 409) {
    const again = await getJson(token, listUrl);
    const row = itemsOf(again.body).find((item) => item?.batchCode === DEMO_BATCH);
    if (!row?.id) throw new Error(`批次编号冲突，但列表里没有 ${DEMO_BATCH}`);
    return { batch: row, created: false };
  }
  if (!created.response.ok || !created.body?.batch?.id) {
    throw new Error(
      `新建批次失败 ${created.response.status} ${messageText(created.body) || JSON.stringify(created.body)}`,
    );
  }
  return { batch: created.body.batch, created: true };
}

async function readBatch(token, id) {
  const loaded = await getJson(token, `${apiBase()}/batches/${encodeURIComponent(id)}`);
  if (!loaded.response.ok || !loaded.body?.batch) {
    throw new Error(`读取批次失败 ${loaded.response.status} ${messageText(loaded.body) || JSON.stringify(loaded.body)}`);
  }
  return loaded.body;
}

export async function sendFruitingBatchDemo({ now = new Date() } = {}) {
  const samples = buildFruitingSamples(now);
  validateFruitingSamples(samples, now);
  const ordered = [...samples].sort((a, b) => a.day.localeCompare(b.day));
  for (const sample of ordered) {
    await postRecognition(sample.body);
  }
  const token = await login();
  const startedAt = ordered[0].body.recognizedAt;
  const ensured = await ensureBatch(token, startedAt);
  const detail = await readBatch(token, ensured.batch.id);
  const phaseWrites = { flush: ensured.created ? '新建' : '沿用' };
  if (detail.batch.closedAt) {
    const names = new Set((detail.events || []).map((event) => event.phase));
    if (!PHASES.every((phase) => names.has(phase)) || detail.batch.phase !== 'mature') {
      throw new Error(`批次 ${DEMO_BATCH} 已结束，不能补记阶段`);
    }
    phaseWrites.fast_growth = '沿用';
    phaseWrites.mature = '沿用';
  } else {
    const posts = nextPhasePosts(detail.events, detail.batch.phase, detail.batch.closedAt);
    for (const phase of ['fast_growth', 'mature']) {
      phaseWrites[phase] = posts.includes(phase) ? '新建' : '沿用';
    }
    for (const phase of posts) {
      const posted = await sendJson(
        token,
        'POST',
        `${apiBase()}/batches/${encodeURIComponent(detail.batch.id)}/phases`,
        {
          phase,
          occurredAt: phaseInstant(now, phase, detail.batch.startedAt).toISOString(),
        },
      );
      if (!posted.response.ok) {
        throw new Error(
          `记阶段 ${PHASE_LABEL[phase]} 失败 ${posted.response.status} ${messageText(posted.body) || JSON.stringify(posted.body)}`,
        );
      }
    }
  }
  const replay = await getJson(
    token,
    `${apiBase()}/batches/${encodeURIComponent(detail.batch.id)}/replay`,
  );
  if (!replay.response.ok) {
    throw new Error(`回放失败 ${replay.response.status} ${messageText(replay.body) || JSON.stringify(replay.body)}`);
  }
  const checked = assertFruitingReplay(replay.body, samples);
  const listed = await getJson(token, `${apiBase()}/batches?shedCode=${encodeURIComponent(DEMO_SHED)}`);
  if (!listed.response.ok) {
    throw new Error(`读取批次列表失败 ${listed.response.status} ${messageText(listed.body) || JSON.stringify(listed.body)}`);
  }
  const row = itemsOf(listed.body).find((item) => item?.batchCode === DEMO_BATCH);
  if (!row) throw new Error(`列表里没有 ${DEMO_BATCH}`);
  if (row.phase !== 'mature') throw new Error(`列表当前阶段是 ${row.phase}，应为 mature`);
  if (row.shedCode !== DEMO_SHED) throw new Error(`列表棚区是 ${row.shedCode}，应为 ${DEMO_SHED}`);
  return { ...checked, phaseWrites };
}

function usage() {
  return `用法:
  node scripts/demo-fruiting-batch.mjs

留下棚区 ${DEMO_SHED} 批次 ${DEMO_BATCH}，记下出菇、快速生长、成熟，并打印回放。步骤见 docs/DEMO_FRUITING_BATCH.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const sent = await sendFruitingBatchDemo();
    process.stdout.write(`${formatFruitingProof(sent)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
