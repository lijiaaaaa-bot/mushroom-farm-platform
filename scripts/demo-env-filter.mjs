#!/usr/bin/env node
/**
 * 留下同一台传感器的三条环境读数，再按起止时间筛选。
 * 比较字段是 observedAt。宽窗口三条都在；窄窗口只有窗内两条。
 * 幂等键固定。已有则改观测时间，不另建一行，也不动 SENSOR-HIST-*。
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
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';

const require = createRequire(import.meta.url);

export const DEMO_FIXTURE = 'environment.demo-env-filter.json';
export const DEMO_SENSOR = 'SENSOR-ENVF-01';
export const DEMO_SHED = 'S01';
export const OUTSIDE_TEMP = 15.2;
export const OLDER_TEMP = 19.7;
export const NOW_TEMP = 26.4;
export const OUTSIDE_KEY = 'demo-env-filter-outside';
export const OLDER_KEY = 'demo-env-filter-older';
export const NOW_KEY = 'demo-env-filter-now';
export const OUTSIDE_MS = 3 * 60 * 60 * 1000;
export const INSIDE_OLDER_MS = 8 * 60 * 1000;
export const WIDE_BEFORE_MS = 4 * 60 * 60 * 1000;
export const NARROW_BEFORE_MS = 30 * 60 * 1000;
export const AFTER_MS = 60 * 1000;

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function demoWindows(now = new Date()) {
  const stamp = now.getTime();
  return {
    now,
    outsideAt: new Date(stamp - OUTSIDE_MS),
    insideOlderAt: new Date(stamp - INSIDE_OLDER_MS),
    insideNowAt: new Date(stamp),
    wideFrom: new Date(stamp - WIDE_BEFORE_MS),
    narrowFrom: new Date(stamp - NARROW_BEFORE_MS),
    to: new Date(stamp + AFTER_MS),
  };
}

export function buildDemoPayloads(now = new Date()) {
  const fixture = readFixture(DEMO_FIXTURE);
  const clock = demoWindows(now);
  const outside = {
    ...fixture.outside,
    observedAt: clock.outsideAt.toISOString(),
    idempotencyKey: OUTSIDE_KEY,
  };
  const older = {
    ...fixture.older,
    observedAt: clock.insideOlderAt.toISOString(),
    idempotencyKey: OLDER_KEY,
  };
  const latest = {
    ...fixture.body,
    observedAt: clock.insideNowAt.toISOString(),
    idempotencyKey: NOW_KEY,
  };
  return { outside, older, latest, clock };
}

function validateOne(body, now, place) {
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
  if (value.sensorCode.startsWith('SENSOR-HIST')) {
    throw new Error('时间筛选演示不能使用 SENSOR-HIST');
  }
  const expected = {
    outside: { key: OUTSIDE_KEY, temperature: OUTSIDE_TEMP },
    older: { key: OLDER_KEY, temperature: OLDER_TEMP },
    latest: { key: NOW_KEY, temperature: NOW_TEMP },
  }[place];
  if (value.idempotencyKey !== expected.key) {
    throw new Error(`幂等键是 ${value.idempotencyKey}，应为 ${expected.key}`);
  }
  if (value.temperature !== expected.temperature) {
    throw new Error(`${place} 温度是 ${value.temperature}，应为 ${expected.temperature}`);
  }
  return value;
}

export function validateDemoPayloads(payloads, now = new Date()) {
  const outside = validateOne(payloads.outside, now, 'outside');
  const older = validateOne(payloads.older, now, 'older');
  const latest = validateOne(payloads.latest, now, 'latest');
  const temps = [outside.temperature, older.temperature, latest.temperature];
  if (new Set(temps).size !== temps.length) {
    throw new Error('三条读数的温度必须各不相同');
  }
  const wideFrom = payloads.clock.wideFrom.getTime();
  const narrowFrom = payloads.clock.narrowFrom.getTime();
  const to = payloads.clock.to.getTime();
  for (const row of [outside, older, latest]) {
    const at = new Date(row.observedAt).getTime();
    if (at < wideFrom || at > to) throw new Error('宽窗口应含这三条读数');
  }
  const outsideAt = new Date(outside.observedAt).getTime();
  if (outsideAt >= narrowFrom) throw new Error('窗外读数落进了窄窗口');
  for (const row of [older, latest]) {
    const at = new Date(row.observedAt).getTime();
    if (at < narrowFrom || at > to) throw new Error('窗内读数不在窄窗口里');
  }
  if (new Date(older.observedAt).getTime() >= new Date(latest.observedAt).getTime()) {
    throw new Error('较早一条的观测时间不早于当前一条');
  }
  return { outside, older, latest, clock: payloads.clock };
}

export function inWindow(value, from, to) {
  const at = new Date(value).getTime();
  return Number.isFinite(at) && at >= from.getTime() && at <= to.getTime();
}

export function assertWindow(items, { from, to, sensorCode, requiredTemps, forbiddenTemps = [] }) {
  const rows = Array.isArray(items) ? items : [];
  for (const row of rows) {
    if (row.sensorCode !== sensorCode) {
      throw new Error(`时间窗口里有 ${row.sensorCode}，这次只查 ${sensorCode}`);
    }
    if (!inWindow(row.observedAt, from, to)) {
      throw new Error(`读数 ${row.temperature}℃ 的观测时间不在窗口内`);
    }
  }
  for (const temp of requiredTemps) {
    if (!rows.some((row) => Number(row.temperature) === temp)) {
      throw new Error(`时间窗口里没有 ${temp}℃`);
    }
  }
  for (const temp of forbiddenTemps) {
    if (rows.some((row) => Number(row.temperature) === temp)) {
      throw new Error(`时间窗口里仍有 ${temp}℃`);
    }
  }
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

async function queryDb(sql, params) {
  return withPg((db) => db.query(sql, params));
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

function listUrl(sensorCode, from, to) {
  const url = new URL(`${apiBase()}/ingest/environment-readings`);
  url.searchParams.set('sensorCode', sensorCode);
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  url.searchParams.set('pageSize', '50');
  return url;
}

async function getList(token, sensorCode, from, to) {
  const url = listUrl(sensorCode, from, to);
  let response;
  try {
    response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  } catch (error) {
    throw new Error(`API 连不上（${url}）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`环境读数列表失败 ${response.status} ${messageText(body) || JSON.stringify(body)}`);
  }
  if (!Array.isArray(body.items) || !Number.isFinite(Number(body.total))) {
    throw new Error('环境读数列表没有 items 或 total');
  }
  return { items: body.items, total: Number(body.total) };
}

async function expectReversedWindow(token) {
  const url = listUrl(DEMO_SENSOR, '2026-10-14T05:00:00.000Z', '2026-10-14T01:00:00.000Z');
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const body = await readJson(response);
  if (response.status !== 400 || !JSON.stringify(body).includes('时间筛选无效')) {
    throw new Error(`开始晚于结束应返回 400「时间筛选无效」，实际 ${response.status} ${JSON.stringify(body)}`);
  }
}

export function environmentFilterUrl({ sensorCode, from, to }, webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const params = new URLSearchParams({
    sensorCode,
    from: from.toISOString(),
    to: to.toISOString(),
  });
  return `${origin}/environment?${params.toString()}`;
}

export function formatDemoProof({
  seeded,
  clock,
  wideCount,
  narrowCount,
  webOrigin = webOriginFromEnv(),
}) {
  const byTemp = Object.fromEntries(seeded.map((row) => [row.temperature, row]));
  const outside = byTemp[OUTSIDE_TEMP];
  const older = byTemp[OLDER_TEMP];
  const latest = byTemp[NOW_TEMP];
  const line = (row, label) =>
    `${label}: ${row.created ? '新建' : '沿用'} ${row.id} ${row.temperature}℃ ${row.observedAt}`;
  const lines = [
    `留下 ${seeded.length} 条环境读数`,
    `传感器: ${DEMO_SENSOR}`,
    '比较字段: observedAt（列表「时间」列）、温度',
    line(outside, '窗外'),
    line(older, '窗内较早'),
    line(latest, '窗内当前'),
    `宽窗口: ${clock.wideFrom.toISOString()} 至 ${clock.to.toISOString()}`,
    `宽窗口条数: ${wideCount}`,
    `窄窗口: ${clock.narrowFrom.toISOString()} 至 ${clock.to.toISOString()}`,
    `窄窗口条数: ${narrowCount}`,
    '窄窗口少于宽窗口: 是',
    '窗外 15.2℃ 不在窄窗口: 是',
    '窗内 19.7℃ 与 26.4℃ 仍在窄窗口: 是',
    '登录: admin / Admin@123456',
    `宽窗口列表: ${environmentFilterUrl({ sensorCode: DEMO_SENSOR, from: clock.wideFrom, to: clock.to }, webOrigin)}`,
    `窄窗口列表: ${environmentFilterUrl({ sensorCode: DEMO_SENSOR, from: clock.narrowFrom, to: clock.to }, webOrigin)}`,
  ];
  return lines.join('\n');
}

export async function sendEnvFilterDemo({
  now = new Date(),
  place = placeReading,
  forgetExtras = forgetOtherReadings,
} = {}) {
  const payloads = validateDemoPayloads(buildDemoPayloads(now), now);
  const specs = [payloads.outside, payloads.older, payloads.latest];
  const seeded = [];
  for (const spec of specs) {
    const saved = await place(spec);
    seeded.push({
      id: saved.id,
      created: saved.created,
      temperature: spec.temperature,
      observedAt: spec.observedAt,
      idempotencyKey: spec.idempotencyKey,
      sensorCode: spec.sensorCode,
    });
  }
  await forgetExtras(
    DEMO_SENSOR,
    seeded.map((row) => row.idempotencyKey),
  );
  const token = await login();
  const wide = await getList(
    token,
    DEMO_SENSOR,
    payloads.clock.wideFrom.toISOString(),
    payloads.clock.to.toISOString(),
  );
  const narrow = await getList(
    token,
    DEMO_SENSOR,
    payloads.clock.narrowFrom.toISOString(),
    payloads.clock.to.toISOString(),
  );
  assertWindow(wide.items, {
    from: payloads.clock.wideFrom,
    to: payloads.clock.to,
    sensorCode: DEMO_SENSOR,
    requiredTemps: [OUTSIDE_TEMP, OLDER_TEMP, NOW_TEMP],
  });
  assertWindow(narrow.items, {
    from: payloads.clock.narrowFrom,
    to: payloads.clock.to,
    sensorCode: DEMO_SENSOR,
    requiredTemps: [OLDER_TEMP, NOW_TEMP],
    forbiddenTemps: [OUTSIDE_TEMP],
  });
  if (wide.total !== 3) {
    throw new Error(`宽窗口条数是 ${wide.total}，应为 3`);
  }
  if (narrow.total !== 2) {
    throw new Error(`窄窗口条数是 ${narrow.total}，应为 2`);
  }
  if (!(narrow.total < wide.total)) {
    throw new Error(`窄窗口条数 ${narrow.total} 没有少于宽窗口 ${wide.total}`);
  }
  const empty = await getList(token, DEMO_SENSOR, '2000-01-01T00:00:00.000Z', '2000-01-01T00:01:00.000Z');
  if (empty.total !== 0) {
    throw new Error(`远离现在的窗口仍有 ${empty.total} 条 ${DEMO_SENSOR}`);
  }
  await expectReversedWindow(token);
  return {
    seeded,
    clock: payloads.clock,
    wideCount: wide.total,
    narrowCount: narrow.total,
  };
}

function usage() {
  return `用法:
  node scripts/demo-env-filter.mjs

留下 SENSOR-ENVF-01 的三条环境读数，并按起止时间筛选。步骤见 docs/DEMO_ENV_FILTER.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await sendEnvFilterDemo();
    process.stdout.write(`${formatDemoProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
