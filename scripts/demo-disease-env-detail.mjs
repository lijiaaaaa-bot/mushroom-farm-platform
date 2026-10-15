#!/usr/bin/env node
/**
 * 写入一条病害识别，并在同一棚放上识别时间前后的环境读数。
 * 详情 /diseases/:id 同一屏能读到病害字段，以及窗内的温度、湿度、CO₂、基质含水率和观测时间。
 * 窗外读数不出现。样例文件不改。
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  apiBase,
  ingestToken,
  postJson,
  readFixture,
  repoRoot,
  withPg,
} from './lib/ingest-wire.mjs';
import {
  buildDemoPayload,
  sendDemo,
  validateDemoPayload,
  webOriginFromEnv,
} from './demo-one-http-recognition.mjs';

const require = createRequire(import.meta.url);

export const DEMO_FIXTURE = 'environment.demo-disease-env-detail.json';
export const DEMO_CAMERA = 'CAM-DED-01';
export const DEMO_SHED = 'S01';
export const DEMO_SENSOR = 'SENSOR-DED-01';
export const DEMO_LEVEL = 1;
export const DEMO_COUNT = 2;
export const EMPTY_WINDOW_COPY = '该时间窗内无环境读数';
export const INSIDE_OLDER_MS = 8 * 60 * 1000;
export const INSIDE_NOW_MS = 2 * 60 * 1000;
export const OUTSIDE_MS = 3 * 60 * 60 * 1000;
export const OUTSIDE_KEY = 'demo-disease-env-outside';
export const INSIDE_OLDER_KEY = 'demo-disease-env-inside-older';
export const INSIDE_NOW_KEY = 'demo-disease-env-inside-now';

export const OUTSIDE_READING = {
  temperature: 16.8,
  humidity: 82,
  co2: 700,
  substrateMoisture: 61,
};
export const INSIDE_OLDER_READING = {
  temperature: 23.8,
  humidity: 84,
  co2: 640,
  substrateMoisture: 73,
};
export const INSIDE_NOW_READING = {
  temperature: 24.1,
  humidity: 86,
  co2: 710,
  substrateMoisture: 75,
};

const METRICS = [
  ['temperature', '温度'],
  ['humidity', '湿度'],
  ['co2', 'CO₂'],
  ['substrateMoisture', '基质含水率'],
];

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function windowMinutes() {
  return contracts().DISEASE_ENV_WINDOW_MINUTES;
}

function close(left, right) {
  return Math.abs(Number(left) - Number(right)) < 0.001;
}

export function buildDiseasePayload(now = new Date()) {
  const body = buildDemoPayload(now);
  body.cameraCode = DEMO_CAMERA;
  body.shedCode = DEMO_SHED;
  body.diseaseCount = DEMO_COUNT;
  body.diseaseLevel = DEMO_LEVEL;
  body.idempotencyKey = `demo-disease-env-${now.getTime()}`;
  return body;
}

export function buildEnvironmentPayloads(now = new Date()) {
  const fixture = readFixture(DEMO_FIXTURE);
  const stamp = now.getTime();
  const outside = {
    ...fixture.outside,
    observedAt: new Date(stamp - OUTSIDE_MS).toISOString(),
    idempotencyKey: OUTSIDE_KEY,
  };
  const older = {
    ...fixture.older,
    observedAt: new Date(stamp - INSIDE_OLDER_MS).toISOString(),
    idempotencyKey: INSIDE_OLDER_KEY,
  };
  const latest = {
    ...fixture.body,
    observedAt: new Date(stamp - INSIDE_NOW_MS).toISOString(),
    idempotencyKey: INSIDE_NOW_KEY,
  };
  return { outside, older, latest };
}

function expectReading(value, expected, place) {
  for (const [key, label] of METRICS) {
    if (!close(value[key], expected[key])) {
      throw new Error(`${place}${label}是 ${value[key]}，应为 ${expected[key]}`);
    }
  }
}

function validateEnvironment(body, now, place, expected, key) {
  const parsed = contracts().parseEnvironmentIngress(body, now);
  if (!parsed.ok) {
    throw new Error(`样例未通过契约：${parsed.errors.join('；')}`);
  }
  const value = parsed.value;
  if (value.shedCode !== DEMO_SHED) {
    throw new Error(`棚区是 ${value.shedCode}，应为 ${DEMO_SHED}`);
  }
  if (value.sensorCode !== DEMO_SENSOR) {
    throw new Error(`传感器是 ${value.sensorCode}，应为 ${DEMO_SENSOR}`);
  }
  if (value.idempotencyKey !== key) {
    throw new Error(`幂等键是 ${value.idempotencyKey}，应为 ${key}`);
  }
  expectReading(value, expected, place);
  return value;
}

export function validateDemoPayloads(payloads, recognition, now = new Date()) {
  const minutes = windowMinutes();
  if (INSIDE_OLDER_MS >= minutes * 60_000 || INSIDE_NOW_MS >= minutes * 60_000) {
    throw new Error('窗内读数落到了识别时间窗口外');
  }
  if (OUTSIDE_MS <= minutes * 60_000) {
    throw new Error('窗外读数落到了识别时间窗口内');
  }
  const outside = validateEnvironment(payloads.outside, now, '窗外', OUTSIDE_READING, OUTSIDE_KEY);
  const older = validateEnvironment(
    payloads.older,
    now,
    '窗内较早',
    INSIDE_OLDER_READING,
    INSIDE_OLDER_KEY,
  );
  const latest = validateEnvironment(
    payloads.latest,
    now,
    '窗内较近',
    INSIDE_NOW_READING,
    INSIDE_NOW_KEY,
  );
  const recognized = new Date(recognition.recognizedAt).getTime();
  const start = recognized - minutes * 60_000;
  const end = recognized + minutes * 60_000;
  for (const row of [older, latest]) {
    const at = new Date(row.observedAt).getTime();
    if (at < start || at > end) throw new Error(`${row.temperature}℃ 不在识别时间前后 ${minutes} 分钟`);
  }
  const outsideAt = new Date(outside.observedAt).getTime();
  if (outsideAt >= start && outsideAt <= end) {
    throw new Error(`窗外 ${outside.temperature}℃ 落进了识别时间窗口`);
  }
  if (new Date(older.observedAt).getTime() >= new Date(latest.observedAt).getTime()) {
    throw new Error('较早一条的观测时间不早于较近一条');
  }
  if (close(recognition.temperature, older.temperature) || close(recognition.temperature, latest.temperature)) {
    throw new Error('窗内温度和识别报文里的温度相同，看不出同期环境');
  }
  return { outside, older, latest, minutes };
}

export function diseaseDetailUrl(id, webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  return `${origin}/diseases/${encodeURIComponent(id)}`;
}

export function assertEmptyWindow(env) {
  if (!env || env.empty !== true) throw new Error('空窗应标记 empty');
  if (env.emptyReason !== EMPTY_WINDOW_COPY) {
    throw new Error(`空窗说明是 ${env.emptyReason || '空'}，应为 ${EMPTY_WINDOW_COPY}`);
  }
  if (!Array.isArray(env.readings) || env.readings.length !== 0) {
    throw new Error('空窗不应带环境读数');
  }
  if (JSON.stringify(env.readings).includes('22.5')) {
    throw new Error('空窗用了识别报文里的温度');
  }
}

function findMetric(readings, expected) {
  return readings.find((row) => close(row.temperature, expected.temperature));
}

export function assertSameScreenEnvironment(env, recognition) {
  if (!env?.recognition?.id) throw new Error('同期环境没有这条病害');
  if (env.recognition.cameraCode !== recognition.cameraCode) {
    throw new Error(`同期环境的位置是 ${env.recognition.cameraCode}，识别是 ${recognition.cameraCode}`);
  }
  if (env.recognition.shedCode !== DEMO_SHED) {
    throw new Error(`同期环境的棚区是 ${env.recognition.shedCode}，应为 ${DEMO_SHED}`);
  }
  if (env.recognition.diseaseLevel !== DEMO_LEVEL || env.recognition.diseaseCount !== DEMO_COUNT) {
    throw new Error('同期环境里的病害等级或数量和这次识别不一致');
  }
  if (env.empty !== false || env.emptyReason) throw new Error('窗内应有环境读数');
  const minutes = windowMinutes();
  if (env.window?.beforeMinutes !== minutes || env.window?.afterMinutes !== minutes) {
    throw new Error(`时间窗不是前后各 ${minutes} 分钟`);
  }
  const recognized = new Date(env.recognition.recognizedAt).getTime();
  const sent = new Date(recognition.recognizedAt).getTime();
  if (!Number.isFinite(recognized) || Math.abs(recognized - sent) > 1000) {
    throw new Error('同期环境的识别时间不是这次的识别');
  }
  const start = recognized - minutes * 60_000;
  const end = recognized + minutes * 60_000;
  const readings = Array.isArray(env.readings) ? env.readings : [];
  if (readings.some((row) => close(row.temperature, OUTSIDE_READING.temperature))) {
    throw new Error(`窗外 ${OUTSIDE_READING.temperature}℃ 出现在详情`);
  }
  const ours = readings.filter((row) => row.sensorCode === DEMO_SENSOR);
  if (ours.length !== 2) {
    throw new Error(`${DEMO_SENSOR} 在窗内是 ${ours.length} 条，应为 2`);
  }
  for (const expected of [INSIDE_OLDER_READING, INSIDE_NOW_READING]) {
    const row = findMetric(ours, expected);
    if (!row) throw new Error(`窗内没有 ${expected.temperature}℃`);
    for (const [key, label] of METRICS) {
      if (!close(row[key], expected[key])) {
        throw new Error(`${expected.temperature}℃ 这一行的${label}是 ${row[key]}，应为 ${expected[key]}`);
      }
    }
    if (!row.observedAt) throw new Error(`${expected.temperature}℃ 没有观测时间`);
    const at = new Date(row.observedAt).getTime();
    if (at < start || at > end) {
      throw new Error(`${expected.temperature}℃ 不在识别时间前后 ${minutes} 分钟`);
    }
  }
  const reused = ours.some(
    (row) =>
      close(row.temperature, recognition.temperature) &&
      close(row.humidity, recognition.humidity) &&
      close(row.co2, recognition.co2) &&
      close(row.substrateMoisture, recognition.substrateMoisture),
  );
  if (reused) throw new Error('详情用识别报文里的环境字段充数');
}

export function assertDiseaseDetail(detail, recognition) {
  if (!detail?.id) throw new Error('病害详情没有 id');
  if (detail.cameraCode !== DEMO_CAMERA || detail.shedCode !== DEMO_SHED) {
    throw new Error('病害详情的棚区或位置不是这次的识别');
  }
  if (detail.diseaseLevel !== DEMO_LEVEL || detail.diseaseCount !== DEMO_COUNT) {
    throw new Error('病害详情的等级或数量不是这次的识别');
  }
  const opened = new Date(detail.recognizedAt).getTime();
  const sent = new Date(recognition.recognizedAt).getTime();
  if (!Number.isFinite(opened) || Math.abs(opened - sent) > 1000) {
    throw new Error('病害详情的时间不是这次的识别');
  }
  if (!detail.snapshotObjectKey && !detail.snapshotUrl) throw new Error('病害详情没有图片');
}

export function formatDiseaseEnvProof({
  id,
  recognition,
  older,
  latest,
  outside,
  webOrigin = webOriginFromEnv(),
}) {
  const lines = [
    '病害详情: 新建',
    `id: ${id}`,
    `时间: ${recognition.recognizedAt}`,
    `棚区: ${recognition.shedCode}`,
    `位置: ${recognition.cameraCode}`,
    `病害等级: ${recognition.diseaseLevel}`,
    `病害数量: ${recognition.diseaseCount}`,
    `传感器: ${DEMO_SENSOR}`,
    `窗内较早: ${older.temperature}℃ 湿度 ${older.humidity}% CO₂ ${older.co2} 基质含水率 ${older.substrateMoisture}% ${older.observedAt}`,
    `窗内较近: ${latest.temperature}℃ 湿度 ${latest.humidity}% CO₂ ${latest.co2} 基质含水率 ${latest.substrateMoisture}% ${latest.observedAt}`,
    `窗外不显示: ${outside.temperature}℃ ${outside.observedAt}`,
    '空窗说明: 该时间窗内无环境读数',
    '登录: admin / Admin@123456',
    `病害详情: ${diseaseDetailUrl(id, webOrigin)}`,
  ];
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

function flag(payload, key) {
  return payload?.[key] ?? payload?.message?.[key];
}

async function queryDb(sql, params) {
  return withPg((db) => db.query(sql, params));
}

async function postEnvironment(body) {
  const url = `${apiBase()}/ingest/environment`;
  let posted;
  try {
    posted = await postJson(url, JSON.stringify(body), {
      'content-type': 'application/json',
      'x-ingest-token': ingestToken(),
    });
  } catch (error) {
    throw new Error(`API 连不上（${url}）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const payload = posted.responseBody;
  const accepted = flag(payload, 'accepted') === true;
  const id = flag(payload, 'id');
  if (posted.responseStatus < 200 || posted.responseStatus >= 300 || !accepted || !id) {
    throw new Error(`环境报文被拒绝 ${posted.responseStatus} ${messageText(payload)}`);
  }
  if (flag(payload, 'duplicate') === true) {
    throw new Error(`幂等键 ${body.idempotencyKey} 已在，但没有改到这次的观测时间`);
  }
  return { id };
}

export async function placeReading(body, deps = {}) {
  const query = deps.query ?? queryDb;
  const post = deps.post ?? postEnvironment;
  const found = await query(
    'SELECT id FROM environment_readings WHERE idempotency_key = $1',
    [body.idempotencyKey],
  );
  const existingId = found.rows?.[0]?.id;
  if (existingId) {
    await query(
      `UPDATE environment_readings
       SET observed_at = $2::timestamptz,
           temperature = $3,
           humidity = $4,
           co2 = $5,
           substrate_moisture = $6,
           shed_code = $7,
           sensor_code = $8,
           raw_payload = $9::jsonb
       WHERE idempotency_key = $1`,
      [
        body.idempotencyKey,
        body.observedAt,
        body.temperature,
        body.humidity,
        body.co2,
        body.substrateMoisture,
        body.shedCode,
        body.sensorCode,
        JSON.stringify(body),
      ],
    );
    return { id: existingId, created: false };
  }
  const posted = await post(body);
  return { id: posted.id, created: true };
}

export async function forgetOtherReadings(sensorCode, keys, deps = {}) {
  if (!Array.isArray(keys) || keys.length !== 3) {
    throw new Error('只保留这三条环境读数');
  }
  const query = deps.query ?? queryDb;
  await query(
    `DELETE FROM environment_readings
     WHERE sensor_code = $1
       AND idempotency_key NOT IN ($2, $3, $4)`,
    [sensorCode, keys[0], keys[1], keys[2]],
  );
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

export async function sendDiseaseEnvDetailDemo({
  now = new Date(),
  place = placeReading,
  forgetExtras = forgetOtherReadings,
} = {}) {
  const recognition = buildDiseasePayload(now);
  const payloads = validateDemoPayloads(buildEnvironmentPayloads(now), recognition, now);
  validateDemoPayload(recognition, now);
  const specs = [payloads.outside, payloads.older, payloads.latest];
  for (const spec of specs) {
    await place(spec);
  }
  await forgetExtras(
    DEMO_SENSOR,
    specs.map((spec) => spec.idempotencyKey),
  );
  const sent = await sendDemo({ body: recognition, now });
  const token = await login();
  const opened = await getJson(token, `${apiBase()}/diseases/${encodeURIComponent(sent.id)}`);
  if (!opened.response.ok) {
    throw new Error(
      `病害详情失败 ${opened.response.status} ${messageText(opened.body) || JSON.stringify(opened.body)}`,
    );
  }
  assertDiseaseDetail(opened.body, recognition);
  const env = await getJson(
    token,
    `${apiBase()}/diseases/${encodeURIComponent(sent.id)}/environment`,
  );
  if (!env.response.ok) {
    throw new Error(
      `同期环境失败 ${env.response.status} ${messageText(env.body) || JSON.stringify(env.body)}`,
    );
  }
  assertSameScreenEnvironment(env.body, recognition);
  return {
    id: sent.id,
    recognition,
    older: payloads.older,
    latest: payloads.latest,
    outside: payloads.outside,
  };
}

function usage() {
  return `用法:
  node scripts/demo-disease-env-detail.mjs

写入 ${DEMO_CAMERA} 的一条病害记录，以及 ${DEMO_SENSOR} 的窗内两行和窗外一行。步骤见 docs/DEMO_DISEASE_ENV_DETAIL.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const sent = await sendDiseaseEnvDetailDemo();
    process.stdout.write(`${formatDiseaseEnvProof(sent)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
