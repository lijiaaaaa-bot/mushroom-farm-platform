#!/usr/bin/env node
/**
 * 发一条识别样例。HTTP 为默认；`--channel mqtt` 走同一条报文。
 * 识别时间改为当前时刻，幂等键改为 demo-one-<毫秒>，所以每次是一条新记录。
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  apiBase,
  ingestRecognitionUrl,
  ingestToken,
  postJson,
  publishMqtt,
  readFixture,
  recognitionTopic,
  repoRoot,
  withRuntimeClock,
} from './lib/ingest-wire.mjs';

const require = createRequire(import.meta.url);

export const DEMO_FIXTURE = 'recognition.demo-one.json';
export const DEMO_CAMERA = 'CAM-DEMO-01';
export const DEMO_SHED = 'S01';

const SECTION_ONE = [
  ['shedCode', '棚区编号'],
  ['cameraCode', '摄像头编号'],
  ['recognizedAt', '识别时间'],
  ['mushroomCount', '蘑菇数量'],
  ['matureCount', '成熟数量'],
  ['capDiameters', '各菌盖直径'],
  ['diseaseCount', '病害数量'],
  ['diseaseLevel', '病害等级'],
  ['temperature', '环境温度'],
  ['humidity', '环境湿度'],
  ['co2', 'CO₂'],
  ['substrateMoisture', '基质含水率'],
];

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function buildDemoPayload(now = new Date()) {
  const fixture = readFixture(DEMO_FIXTURE);
  const body = withRuntimeClock({ ...fixture.body }, now);
  body.idempotencyKey = `demo-one-${now.getTime()}`;
  return body;
}

export function validateDemoPayload(body, now = new Date()) {
  const parsed = contracts().parseRecognitionIngress(body, now);
  if (!parsed.ok) {
    throw new Error(`样例未通过契约：${parsed.errors.join('；')}`);
  }
  const value = parsed.value;
  const missing = [];
  for (const [key, label] of SECTION_ONE) {
    const field = value[key];
    if (field === undefined || field === null || field === '') missing.push(label);
    if (key === 'capDiameters' && (!Array.isArray(field) || field.length === 0)) {
      missing.push(label);
    }
  }
  if (!value.snapshotBase64 && !value.snapshotUrl) missing.push('AI抓拍图');
  if (missing.length) throw new Error(`样例缺少${missing.join('、')}`);
  if (value.snapshotBase64) {
    const bytes = Buffer.from(value.snapshotBase64, 'base64');
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      throw new Error('样例 AI抓拍图 不是 JPEG');
    }
  }
  return value;
}

export function recognitionUiUrl(cameraCode, webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  return `${origin}/recognitions?cameraCode=${encodeURIComponent(cameraCode)}`;
}

export function webOriginFromEnv() {
  return process.env.WEB_ORIGIN || 'http://127.0.0.1:43123';
}

export function formatDemoProof({ id, duplicate, body, webOrigin = webOriginFromEnv() }) {
  const ui = recognitionUiUrl(body.cameraCode, webOrigin);
  const origin = String(webOrigin).replace(/\/$/, '');
  const sql =
    `psql postgres://mushroom:mushroom@127.0.0.1:5432/mushroom -c ` +
    `"SELECT id, shed_code, camera_code, recognized_at, mushroom_count, mature_count, disease_count FROM recognition_records WHERE id = '${id}';"`;
  return [
    '发了 1 条识别',
    `id: ${id}`,
    `重复: ${duplicate ? '是' : '否'}`,
    `棚区编号: ${body.shedCode}`,
    `摄像头编号: ${body.cameraCode}`,
    `识别时间: ${body.recognizedAt}`,
    `幂等键: ${body.idempotencyKey}`,
    `蘑菇数量: ${body.mushroomCount}  成熟数量: ${body.matureCount}  病害数量: ${body.diseaseCount}  病害等级: ${body.diseaseLevel}`,
    '登录: admin / Admin@123456',
    `打开: ${ui}`,
    `大屏抓拍墙: ${origin}/big-screen`,
    `库里核对: ${sql}`,
  ].join('\n');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rejectText(responseBody) {
  const inner =
    responseBody && typeof responseBody.message === 'object' ? responseBody.message : responseBody;
  const errors = inner?.errors || responseBody?.errors;
  const code = inner?.code || responseBody?.code;
  const list = Array.isArray(errors) ? errors.join('；') : JSON.stringify(responseBody);
  return code ? `${code} ${list}` : list;
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
  const session = await response.json().catch(() => ({}));
  if (!response.ok || !session.accessToken) {
    throw new Error(`登录失败 ${response.status}。确认 API 已用种子账号启动。`);
  }
  return session.accessToken;
}

async function listByCamera(token, cameraCode) {
  const url = `${apiBase()}/ingest/recognitions?cameraCode=${encodeURIComponent(cameraCode)}&pageSize=50`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`识别列表失败 ${response.status} ${JSON.stringify(body)}`);
  return Array.isArray(body.items) ? body.items : [];
}

function sameInstant(row, body) {
  const listed = new Date(row.recognizedAt).getTime();
  const sent = new Date(body.recognizedAt).getTime();
  return Number.isFinite(listed) && Math.abs(listed - sent) <= 1000;
}

async function findListed(body, { id, timeoutMs }) {
  const token = await login();
  const deadline = Date.now() + timeoutMs;
  let last = [];
  while (Date.now() <= deadline) {
    last = await listByCamera(token, body.cameraCode);
    const found = last.find((row) => {
      if (id && row.id === id) return true;
      return row.idempotencyKey === body.idempotencyKey && sameInstant(row, body);
    });
    if (found) {
      if (!sameInstant(found, body)) {
        throw new Error(`列表里的识别时间 ${found.recognizedAt} 不是这次发送的 ${body.recognizedAt}`);
      }
      return found;
    }
    if (Date.now() + 400 > deadline) break;
    await sleep(400);
  }
  throw new Error(
    `识别列表里没有这次的记录（cameraCode=${body.cameraCode}）。页面 ${recognitionUiUrl(body.cameraCode)} 也看不到。`,
  );
}

export async function sendDemo({ channel = 'http', now = new Date() } = {}) {
  if (channel !== 'http' && channel !== 'mqtt') {
    throw new Error('channel 只能是 http 或 mqtt');
  }
  const body = buildDemoPayload(now);
  validateDemoPayload(body, now);
  const rawUtf8 = JSON.stringify(body);
  if (channel === 'mqtt') {
    const topic = recognitionTopic(body.shedCode, body.cameraCode);
    await publishMqtt(topic, rawUtf8);
    const found = await findListed(body, { timeoutMs: 15_000 });
    return { id: found.id, duplicate: false, body, channel, topic };
  }
  let posted;
  try {
    posted = await postJson(ingestRecognitionUrl(), rawUtf8, {
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
    throw new Error(`接入拒绝 ${posted.responseStatus} ${rejectText(payload)}`);
  }
  const found = await findListed(body, { id, timeoutMs: 3_000 });
  return { id: found.id, duplicate, body, channel };
}

function usage() {
  return `用法:
  node scripts/demo-one-http-recognition.mjs
  node scripts/demo-one-http-recognition.mjs --channel mqtt

默认 HTTP POST /api/v1/ingest/recognition。样例 ${DEMO_FIXTURE}。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  const channelFlag = process.argv.indexOf('--channel');
  const channel = channelFlag === -1 ? 'http' : process.argv[channelFlag + 1];
  try {
    const sent = await sendDemo({ channel });
    process.stdout.write(`${formatDemoProof(sent)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
