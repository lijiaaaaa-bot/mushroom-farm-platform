#!/usr/bin/env node
/**
 * 写入 S01 两台摄像头当天各一条识别，总览和基地大屏读出当日病害总数。
 * 样例仍是 recognition.demo-one.json，只改本次请求。
 * 对照摄像头 CAM-TDC-NONE 不写入。
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

export const DEMO_FIXTURE = 'recognition.demo-one.json';
export const DEMO_SHED = 'S01';
export const CONTRAST_CAMERA = 'CAM-TDC-NONE';

export const DISEASE_POINTS = [
  {
    cameraCode: 'CAM-TDC-01',
    offsetMs: 4 * 60 * 1000,
    mushroomCount: 8,
    matureCount: 2,
    diseaseCount: 2,
  },
  {
    cameraCode: 'CAM-TDC-02',
    offsetMs: 2 * 60 * 1000,
    mushroomCount: 6,
    matureCount: 1,
    diseaseCount: 1,
  },
];

export const CLEAN_DISEASE_TOTAL = DISEASE_POINTS.reduce(
  (sum, point) => sum + point.diseaseCount,
  0,
);

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function shanghaiDayOf(now = new Date()) {
  const { shanghaiDate, shanghaiDayRange } = contracts();
  const day = shanghaiDate(now);
  const range = shanghaiDayRange(day);
  return { day, start: range.start, end: range.end };
}

export function recognizedAtFor(now, index, offsetMs) {
  const { start, end } = shanghaiDayOf(now);
  let at = now.getTime() - offsetMs;
  if (at < start.getTime()) at = start.getTime() + (index + 1) * 1000;
  if (at >= end.getTime()) at = end.getTime() - (index + 1) * 1000;
  return new Date(at).toISOString();
}

export function todayDiseaseNote(diseaseCount) {
  return `当日病害总数 ${diseaseCount}`;
}

export function buildTodayDiseaseCountPayloads(now = new Date()) {
  const fixture = readFixture(DEMO_FIXTURE);
  const { day, start, end } = shanghaiDayOf(now);
  const points = DISEASE_POINTS.map((point, index) => ({
    ...point,
    body: {
      idempotencyKey: `demo-today-disease-count-${point.cameraCode}-${day}`,
      shedCode: DEMO_SHED,
      cameraCode: point.cameraCode,
      recognizedAt: recognizedAtFor(now, index, point.offsetMs),
      mushroomCount: point.mushroomCount,
      matureCount: point.matureCount,
      capDiameters: fixture.body.capDiameters,
      diseaseCount: point.diseaseCount,
      diseaseLevel: fixture.body.diseaseLevel,
      temperature: fixture.body.temperature,
      humidity: fixture.body.humidity,
      co2: fixture.body.co2,
      substrateMoisture: fixture.body.substrateMoisture,
    },
  }));
  return { points, day, start: start.toISOString(), end: end.toISOString() };
}

function validateOne(body, now, diseaseCount) {
  const parsed = contracts().parseRecognitionIngress(body, now);
  if (!parsed.ok) throw new Error(`样例未通过契约：${parsed.errors.join('；')}`);
  const value = parsed.value;
  if (value.shedCode !== DEMO_SHED) throw new Error(`棚区是 ${value.shedCode}，应为 ${DEMO_SHED}`);
  if (!DISEASE_POINTS.some((point) => point.cameraCode === value.cameraCode)) {
    throw new Error(`摄像头是 ${value.cameraCode}，不在本次两台里`);
  }
  if (value.diseaseCount !== diseaseCount) {
    throw new Error(`病害数量是 ${value.diseaseCount}，应为 ${diseaseCount}`);
  }
  if (value.diseaseLevel !== 1) throw new Error(`病害等级是 ${value.diseaseLevel}，应为 1`);
  if (value.diseaseCount >= 5) throw new Error('病害数量达到种子规则「病害数量一般」的 5');
  if (value.diseaseLevel >= 2) throw new Error('病害等级达到种子规则「病害等级一般」的 2');
  if (value.mushroomCount > 0 && value.matureCount / value.mushroomCount >= 0.6) {
    throw new Error('成熟占比达到种子规则「成熟占比一般」的 0.6');
  }
  if (value.temperature !== 22.5) throw new Error(`温度是 ${value.temperature}，应为 22.5`);
  if (value.snapshotBase64 || value.snapshotUrl) throw new Error('本次请求不带抓拍');
  return value;
}

export function validateTodayDiseaseCountPayloads(sample, now = new Date()) {
  if (!Array.isArray(sample.points) || sample.points.length !== 2) {
    throw new Error('当日病害总数要正好 2 条');
  }
  const { start, end } = shanghaiDayOf(now);
  const values = sample.points.map((point) => validateOne(point.body, now, point.diseaseCount));
  const times = values.map((value) => new Date(value.recognizedAt).getTime());
  if (new Set(times).size !== times.length) throw new Error('两条识别时间必须不同');
  for (const at of times) {
    if (at < start.getTime() || at >= end.getTime()) throw new Error('识别时间不在今天的上海日里');
  }
  const cameras = sample.points.map((point) => point.cameraCode);
  if (new Set(cameras).size !== cameras.length) throw new Error('两台摄像头必须不同');
  const fieldSum = sample.points.reduce((sum, point) => sum + point.diseaseCount, 0);
  if (fieldSum !== CLEAN_DISEASE_TOTAL) {
    throw new Error(`病害数量字段合计是 ${fieldSum}，应为 ${CLEAN_DISEASE_TOTAL}`);
  }
  const fixture = readFixture(DEMO_FIXTURE);
  if (fixture.body.cameraCode !== 'CAM-DEMO-01') throw new Error('样例文件里的摄像头被改掉了');
  if (fixture.body.mushroomCount !== 12) throw new Error('样例文件里的蘑菇数被改掉了');
  if (fixture.body.diseaseCount !== 1) throw new Error('样例文件里的病害数量被改掉了');
  if (!fixture.body.snapshotBase64) throw new Error('样例文件里的 AI抓拍图被去掉了');
  return sample;
}

export function assertCameraDay(items, point) {
  const rows = Array.isArray(items) ? items : [];
  const row = rows.find(
    (item) =>
      item.cameraCode === point.cameraCode &&
      Number(item.diseaseCount) === point.diseaseCount &&
      Number(item.mushroomCount) === point.mushroomCount,
  );
  if (!row) throw new Error(`${point.cameraCode} 当天没有病害数量 ${point.diseaseCount}`);
  return row;
}

export function assertContrastEmpty(items) {
  const rows = Array.isArray(items) ? items : [];
  if (rows.length !== 0) throw new Error(`对照摄像头仍有 ${rows.length} 条`);
}

export function assertOverviewDisease(overview, cameraRows) {
  const disease = Number(overview?.todayDiseaseCount);
  if (!Number.isInteger(disease) || disease < 0) {
    throw new Error('当日病害总数不是非负整数');
  }
  const rows = DISEASE_POINTS.map((point) => {
    const listed = cameraRows.find((group) => group.cameraCode === point.cameraCode);
    return assertCameraDay(listed?.items, point);
  });
  const fieldSum = rows.reduce((sum, row) => sum + Number(row.diseaseCount), 0);
  if (fieldSum !== CLEAN_DISEASE_TOTAL) {
    throw new Error(`两台病害数量字段合计是 ${fieldSum}，应为 ${CLEAN_DISEASE_TOTAL}`);
  }
  if (disease < fieldSum) {
    throw new Error(`当日病害总数 ${disease} 小于这两台的病害数量字段合计 ${fieldSum}`);
  }
  return { disease, fieldSum };
}

export function screenUrls(webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  return {
    overview: `${origin}/`,
    screen: `${origin}/big-screen`,
  };
}

export function formatTodayDiseaseCountProof({
  diseaseCount,
  day,
  webOrigin = webOriginFromEnv(),
}) {
  const pages = screenUrls(webOrigin);
  const lines = DISEASE_POINTS.map(
    (point) => `${point.cameraCode}: 病害 ${point.diseaseCount}`,
  );
  return [
    todayDiseaseNote(diseaseCount),
    `棚区: ${DEMO_SHED}`,
    ...lines,
    `字段合计: ${DISEASE_POINTS.map((point) => point.diseaseCount).join(' + ')} = ${CLEAN_DISEASE_TOTAL}`,
    `对照 ${CONTRAST_CAMERA}: 当日病害 0`,
    `上海日: ${day}`,
    '登录: admin / Admin@123456',
    `总览: ${pages.overview}`,
    `大屏: ${pages.screen}`,
  ].join('\n');
}

function messageText(payload) {
  const inner = payload && typeof payload.message === 'object' ? payload.message : payload;
  const errors = inner?.errors || payload?.errors;
  const code = inner?.code || payload?.code;
  const list = Array.isArray(errors) ? errors.join('；') : JSON.stringify(payload);
  return code ? `${code} ${list}` : list;
}

function flag(payload, key) {
  return payload?.[key] ?? payload?.message?.[key];
}

async function readJson(response) {
  return response.json().catch(() => ({}));
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
  const accepted = flag(payload, 'accepted') === true;
  const id = flag(payload, 'id');
  if (posted.responseStatus < 200 || posted.responseStatus >= 300 || !accepted || !id) {
    throw new Error(`识别报文被拒绝 ${posted.responseStatus} ${messageText(payload)}`);
  }
  if (flag(payload, 'snapshotStored') === true) {
    throw new Error('本次请求写入了抓拍');
  }
  return { id, duplicate: flag(payload, 'duplicate') === true };
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

function listUrl(cameraCode, start, end) {
  const to = new Date(new Date(end).getTime() - 1).toISOString();
  const params = new URLSearchParams({
    shedCode: DEMO_SHED,
    cameraCode,
    from: start,
    to,
    pageSize: '50',
  });
  return `${apiBase()}/ingest/recognitions?${params.toString()}`;
}

async function getJson(token, url) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const body = await readJson(response);
  if (!response.ok) throw new Error(`读取失败 ${response.status} ${JSON.stringify(body)}`);
  return body;
}

export async function sendDemo({ now = new Date() } = {}) {
  const built = buildTodayDiseaseCountPayloads(now);
  validateTodayDiseaseCountPayloads(built, now);
  for (const point of built.points) {
    await postRecognition(point.body);
  }
  const token = await login();
  const cameraRows = [];
  for (const point of built.points) {
    const listed = await getJson(token, listUrl(point.cameraCode, built.start, built.end));
    cameraRows.push({ cameraCode: point.cameraCode, items: listed.items });
  }
  const contrast = await getJson(token, listUrl(CONTRAST_CAMERA, built.start, built.end));
  assertContrastEmpty(contrast.items);
  const overview = await getJson(token, `${apiBase()}/dashboard/overview`);
  const counts = assertOverviewDisease(overview, cameraRows);
  return { diseaseCount: counts.disease, day: built.day };
}

function usage() {
  return `用法:
  node scripts/demo-today-disease-count.mjs

读取 ${DEMO_FIXTURE}，写入 ${DISEASE_POINTS.map((point) => point.cameraCode).join('、')} 当天各一条识别。步骤见 docs/DEMO_TODAY_DISEASE_COUNT.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const sent = await sendDemo();
    process.stdout.write(`${formatTodayDiseaseCountProof(sent)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
