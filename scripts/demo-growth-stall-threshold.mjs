#!/usr/bin/env node
/**
 * 把全场规则「生长异常预警」的菌盖生长停滞阈值写成 2 天，并写入连续三天相同菌盖直径。
 * 当前停滞天数 ≥ 2 时，总览写出生长异常预警。样例文件不改。
 * 这条规则不按单条识别新开告警。种子规则「生长停滞」会因增量为 0 开告警，
 * 命令只关闭演示摄像头上因此留下的未闭合告警。
 * 对照摄像头 CAM-GST-NONE 不写入。
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

export const DEMO_FIXTURE = 'recognition.demo-one.json';
export const RULE_NAME = '生长异常预警';
export const RULE_METRIC = 'live_growth_stall';
export const SEED_STALL_METRIC = 'growth_stall';
export const THRESHOLD = 2;
export const CAP_DIAMETER = 4;
export const DEMO_SHED = 'S01';
export const CONTROL_SHED = 'S02';
export const DEMO_CAMERA = 'CAM-GST-01';
export const CONTROL_CAMERA = 'CAM-GST-ZERO';
export const CONTRAST_CAMERA = 'CAM-GST-NONE';
export const CLOSE_NOTE = '生长停滞演示后关闭';
export const EXPECTED_CLEAN_NOTE = '生长异常预警 停滞≥2 当前2';
export const DAY_OFFSETS = [2, 1, 0];

export const STALL_COUNTS = {
  mushroomCount: 10,
  matureCount: 2,
};

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

function pointInstant(now, offsetDays) {
  return new Date(now.getTime() - offsetDays * DAY_MS);
}

function environmentOf(fixture) {
  return {
    temperature: fixture.body.temperature,
    humidity: fixture.body.humidity,
    co2: fixture.body.co2,
    substrateMoisture: fixture.body.substrateMoisture,
  };
}

export function buildGrowthStallPayloads(now = new Date()) {
  const fixture = readFixture(DEMO_FIXTURE);
  const env = environmentOf(fixture);
  const stall = DAY_OFFSETS.map((offsetDays) => {
    const at = pointInstant(now, offsetDays);
    const day = contracts().shanghaiDate(at);
    return {
      offsetDays,
      day,
      shedCode: DEMO_SHED,
      cameraCode: DEMO_CAMERA,
      mushroomCount: STALL_COUNTS.mushroomCount,
      matureCount: STALL_COUNTS.matureCount,
      capDiameter: CAP_DIAMETER,
      body: {
        idempotencyKey: `demo-growth-stall-threshold-${DEMO_CAMERA}-${day}`,
        shedCode: DEMO_SHED,
        cameraCode: DEMO_CAMERA,
        recognizedAt: at.toISOString(),
        mushroomCount: STALL_COUNTS.mushroomCount,
        matureCount: STALL_COUNTS.matureCount,
        capDiameters: [CAP_DIAMETER],
        diseaseCount: 0,
        diseaseLevel: 0,
        ...env,
      },
    };
  });
  const controlAt = pointInstant(now, 0);
  const controlDay = contracts().shanghaiDate(controlAt);
  const control = {
    offsetDays: 0,
    day: controlDay,
    shedCode: CONTROL_SHED,
    cameraCode: CONTROL_CAMERA,
    mushroomCount: 0,
    matureCount: 0,
    body: {
      idempotencyKey: `demo-growth-stall-threshold-${CONTROL_CAMERA}-${controlDay}`,
      shedCode: CONTROL_SHED,
      cameraCode: CONTROL_CAMERA,
      recognizedAt: controlAt.toISOString(),
      mushroomCount: 0,
      matureCount: 0,
      diseaseCount: 0,
      diseaseLevel: 0,
      ...env,
    },
  };
  return { stall, control, day: contracts().shanghaiDate(now) };
}

function validateOne(body, now, point) {
  const parsed = contracts().parseRecognitionIngress(body, now);
  if (!parsed.ok) throw new Error(`样例未通过契约：${parsed.errors.join('；')}`);
  const value = parsed.value;
  if (value.shedCode !== point.shedCode) {
    throw new Error(`棚区是 ${value.shedCode}，应为 ${point.shedCode}`);
  }
  if (value.cameraCode !== point.cameraCode) {
    throw new Error(`摄像头是 ${value.cameraCode}，应为 ${point.cameraCode}`);
  }
  if (value.mushroomCount !== point.mushroomCount) {
    throw new Error(`蘑菇数是 ${value.mushroomCount}，应为 ${point.mushroomCount}`);
  }
  if (value.matureCount !== point.matureCount) {
    throw new Error(`成熟数是 ${value.matureCount}，应为 ${point.matureCount}`);
  }
  if (value.diseaseCount !== 0) throw new Error(`病害数量是 ${value.diseaseCount}，应为 0`);
  if (value.diseaseLevel !== 0) throw new Error(`病害等级是 ${value.diseaseLevel}，应为 0`);
  if (value.diseaseCount >= 5) throw new Error('病害数量达到种子规则「病害数量一般」的 5');
  if (value.diseaseLevel >= 2) throw new Error('病害等级达到种子规则「病害等级一般」的 2');
  if (value.mushroomCount > 0 && value.matureCount / value.mushroomCount >= 0.6) {
    throw new Error('成熟占比达到种子规则「成熟占比一般」的 0.6');
  }
  if (value.temperature !== 22.5) throw new Error(`温度是 ${value.temperature}，应为 22.5`);
  if (value.snapshotBase64 || value.snapshotUrl) throw new Error('本次请求不带抓拍');
  const day = contracts().shanghaiDate(new Date(value.recognizedAt));
  if (day !== point.day) throw new Error(`识别日落在 ${day}，样例是 ${point.day}`);
  return value;
}

export function validateGrowthStallPayloads(sample, now = new Date()) {
  if (!Array.isArray(sample.stall) || sample.stall.length !== DAY_OFFSETS.length) {
    throw new Error(`生长停滞要正好 ${DAY_OFFSETS.length} 个上海日`);
  }
  const values = sample.stall.map((point) => validateOne(point.body, now, point));
  const today = contracts().shanghaiDate(now);
  const expectedDays = DAY_OFFSETS.map((offset) => contracts().shiftShanghaiDate(today, -offset)).sort();
  const days = sample.stall.map((point) => point.day).sort();
  if (days.join(',') !== expectedDays.join(',')) {
    throw new Error(`上海日是 ${days.join(',')}，应为 ${expectedDays.join(',')}`);
  }
  if (new Set(days).size !== days.length) throw new Error('各天的上海日重复了');
  for (const point of sample.stall) {
    if (point.capDiameter !== CAP_DIAMETER) {
      throw new Error(`菌盖直径是 ${point.capDiameter}，应为 ${CAP_DIAMETER}`);
    }
    if (!Array.isArray(point.body.capDiameters) || point.body.capDiameters[0] !== CAP_DIAMETER) {
      throw new Error('报文里的菌盖直径不是 4');
    }
    if (point.body.idempotencyKey !== `demo-growth-stall-threshold-${DEMO_CAMERA}-${point.day}`) {
      throw new Error('幂等键没有按摄像头和上海日固定');
    }
  }
  const streak = contracts().trailingStallDays(
    sample.stall.map((point) => ({ day: point.day, capDiameterMean: point.capDiameter })),
    today,
  );
  if (streak !== THRESHOLD) {
    throw new Error(`连续停滞天数是 ${streak}，应为 ${THRESHOLD}`);
  }
  const control = validateOne(sample.control.body, now, sample.control);
  if (control.capDiameters.length !== 0) throw new Error('对照棚不写菌盖直径');
  if (sample.control.body.capDiameters !== undefined) throw new Error('对照报文带了菌盖直径');
  if (sample.day !== today) throw new Error(`当天是 ${sample.day}，应为 ${today}`);
  const fixture = readFixture(DEMO_FIXTURE);
  if (fixture.body.cameraCode !== 'CAM-DEMO-01') throw new Error('样例文件里的摄像头被改掉了');
  if (fixture.body.mushroomCount !== 12) throw new Error('样例文件里的蘑菇数被改掉了');
  if (fixture.body.diseaseCount !== 1) throw new Error('样例文件里的病害数量被改掉了');
  if (!Array.isArray(fixture.body.capDiameters) || fixture.body.capDiameters.join(',') !== '3.2,4.8,6.1') {
    throw new Error('样例文件里的菌盖直径被改掉了');
  }
  if (!fixture.body.snapshotBase64) throw new Error('样例文件里的 AI抓拍图被去掉了');
  return values;
}

export function assertCameraDay(items, point) {
  const rows = Array.isArray(items) ? items : [];
  const row = rows.find(
    (item) =>
      item.cameraCode === point.cameraCode &&
      Number(item.mushroomCount) === point.mushroomCount &&
      Number(item.matureCount) === point.matureCount,
  );
  if (!row) {
    throw new Error(
      `${point.cameraCode} 在 ${point.day} 没有蘑菇 ${point.mushroomCount}、成熟 ${point.matureCount}`,
    );
  }
  return row;
}

export function assertContrastEmpty(items) {
  const rows = Array.isArray(items) ? items : [];
  if (rows.length !== 0) throw new Error(`对照摄像头仍有 ${rows.length} 条`);
}

export function assertOverviewGrowthStall(overview, ruleId) {
  const parsed = contracts().parseGrowthStallWarning(overview);
  if (!parsed.ok) throw new Error(`总览生长异常预警未通过契约：${parsed.errors.join('；')}`);
  const row = parsed.value;
  if (row.growthStallThreshold !== THRESHOLD) {
    throw new Error(`菌盖生长停滞阈值是 ${row.growthStallThreshold}，应为 ${THRESHOLD}`);
  }
  if (row.growthStallShedCode !== null) {
    throw new Error(`生长异常预警棚区是 ${row.growthStallShedCode}，应为全场`);
  }
  if (ruleId && row.growthStallRuleId !== ruleId) {
    throw new Error(`生长异常预警规则是 ${row.growthStallRuleId}，应为 ${ruleId}`);
  }
  if (!row.growthStallActive) throw new Error('当前停滞天数没有达到阈值，生长异常预警未出现');
  if (row.growthStallCurrent < THRESHOLD) {
    throw new Error(`当前停滞 ${row.growthStallCurrent} 小于阈值 ${THRESHOLD}`);
  }
  const note = contracts().formatGrowthStallNote({
    active: true,
    threshold: row.growthStallThreshold,
    current: row.growthStallCurrent,
    shedCode: null,
  });
  if (row.growthStallNote !== note) {
    throw new Error(`旁注是「${row.growthStallNote}」，应为「${note}」`);
  }
  const clean = row.growthStallCurrent === THRESHOLD;
  if (clean && note !== EXPECTED_CLEAN_NOTE) {
    throw new Error(`干净当天旁注是「${note}」，应为「${EXPECTED_CLEAN_NOTE}」`);
  }
  return { ...row, clean, note };
}

export function screenUrl(webOrigin = webOriginFromEnv()) {
  return `${String(webOrigin).replace(/\/$/, '')}/`;
}

export function formatGrowthStallProof({
  note,
  clean,
  threshold,
  current,
  day,
  ruleId,
  days,
  closed,
  webOrigin = webOriginFromEnv(),
}) {
  const listed = Array.isArray(days) ? days.join('、') : '';
  return [
    note,
    `菌盖生长停滞阈值: ${threshold} 天`,
    `当前停滞: ${current} 天`,
    `范围: 全场`,
    `规则: ${RULE_NAME} ${ruleId}`,
    `指标: ${RULE_METRIC}`,
    `${DEMO_CAMERA}（${DEMO_SHED}）: 菌盖直径 ${CAP_DIAMETER}，上海日 ${listed}`,
    `相邻日增量: 0、0（≤ 0 记停滞）`,
    `${CONTROL_CAMERA}（${CONTROL_SHED}）: 当天蘑菇 0，不写菌盖`,
    `对照 ${CONTRAST_CAMERA}: 当天 0 条`,
    clean
      ? `干净当天: ${EXPECTED_CLEAN_NOTE}`
      : `当天已有更长的停滞，旁注仍是生长异常预警，当前天数不小于 ${THRESHOLD}`,
    `上海日: ${day}`,
    `关闭种子生长停滞告警: ${closed ?? 0}`,
    '登录: admin / Admin@123456',
    `总览: ${screenUrl(webOrigin)}`,
    '不按菌盖生长停滞这条规则新开告警行。',
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
  if (flag(payload, 'snapshotStored') === true) throw new Error('本次请求写入了抓拍');
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

function listUrl(shedCode, cameraCode, day) {
  const { start, end } = contracts().shanghaiDayRange(day);
  const to = new Date(end.getTime() - 1).toISOString();
  const params = new URLSearchParams({
    shedCode,
    cameraCode,
    from: start.toISOString(),
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

async function sendJson(token, url, method, body) {
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await readJson(response);
  if (!response.ok) throw new Error(`${method} ${url} 失败 ${response.status} ${messageText(payload)}`);
  return payload;
}

function asRules(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.items)) return body.items;
  throw new Error('规则列表不是数组');
}

async function ensureStallRule(token) {
  const listed = asRules(await getJson(token, `${apiBase()}/alert-rules`));
  let rule = listed.find(
    (item) => item?.metric === RULE_METRIC && item.name === RULE_NAME && !String(item.shedCode || '').trim(),
  );
  if (!rule) {
    rule = await sendJson(token, `${apiBase()}/alert-rules`, 'POST', {
      name: RULE_NAME,
      metric: RULE_METRIC,
      threshold: THRESHOLD,
      level: 'info',
      windowMinutes: 720,
    });
  }
  if (!rule?.id) throw new Error('生长异常预警规则没有 id');
  const saved = await sendJson(token, `${apiBase()}/alert-rules/${rule.id}`, 'PATCH', {
    threshold: THRESHOLD,
    enabled: true,
    level: 'info',
  });
  if (Number(saved.threshold) !== THRESHOLD || saved.enabled !== true) {
    throw new Error(`生长异常预警规则保存后不是阈值 ${THRESHOLD}、启用`);
  }
  if (saved.metric !== RULE_METRIC) throw new Error(`规则指标是 ${saved.metric}，应为 ${RULE_METRIC}`);
  if (String(saved.shedCode || '').trim()) throw new Error('生长异常预警规则不应限定棚区');
  const again = asRules(await getJson(token, `${apiBase()}/alert-rules`));
  for (const item of again) {
    if (item?.metric !== RULE_METRIC || item.id === saved.id || item.enabled !== true) continue;
    await sendJson(token, `${apiBase()}/alert-rules/${item.id}`, 'PATCH', { enabled: false });
  }
  return saved;
}

async function assertNoMetricAlert(token, cameraCode, metric) {
  const listed = await getJson(
    token,
    `${apiBase()}/alerts?cameraCode=${encodeURIComponent(cameraCode)}&status=open&pageSize=50`,
  );
  const items = Array.isArray(listed.items) ? listed.items : [];
  const hit = items.filter((item) => item.metric === metric);
  if (hit.length) throw new Error(`${cameraCode} 上出现了 ${metric} 告警行`);
}

async function listOpenAlerts(token, cameraCode, status) {
  const listed = await getJson(
    token,
    `${apiBase()}/alerts?cameraCode=${encodeURIComponent(cameraCode)}&status=${status}&pageSize=50`,
  );
  return Array.isArray(listed.items) ? listed.items : [];
}

async function closeSeedStallAlerts(token, cameraCode) {
  const open = await listOpenAlerts(token, cameraCode, 'open');
  const acked = await listOpenAlerts(token, cameraCode, 'acked');
  const targets = [...open, ...acked].filter((item) => item.metric === SEED_STALL_METRIC);
  for (const row of targets) {
    await sendJson(token, `${apiBase()}/alerts/${encodeURIComponent(row.id)}/close`, 'POST', {
      note: CLOSE_NOTE,
    });
  }
  const left = [
    ...(await listOpenAlerts(token, cameraCode, 'open')),
    ...(await listOpenAlerts(token, cameraCode, 'acked')),
  ].filter((item) => item.metric === SEED_STALL_METRIC);
  if (left.length) throw new Error(`${cameraCode} 还有 ${left.length} 条未闭合的生长停滞告警`);
  return targets.length;
}

export async function sendDemo({ now = new Date() } = {}) {
  const built = buildGrowthStallPayloads(now);
  validateGrowthStallPayloads(built, now);
  const token = await login();
  const rule = await ensureStallRule(token);
  for (const point of [...built.stall, built.control]) {
    await postRecognition(point.body);
  }
  for (const point of [...built.stall, built.control]) {
    const listed = await getJson(token, listUrl(point.shedCode, point.cameraCode, point.day));
    assertCameraDay(listed.items, point);
  }
  const contrast = await getJson(token, listUrl(DEMO_SHED, CONTRAST_CAMERA, built.day));
  assertContrastEmpty(contrast.items);
  let closed = 0;
  for (const point of [...built.stall, built.control]) {
    await assertNoMetricAlert(token, point.cameraCode, RULE_METRIC);
    closed += await closeSeedStallAlerts(token, point.cameraCode);
  }
  const overview = await getJson(token, `${apiBase()}/dashboard/overview`);
  const stall = assertOverviewGrowthStall(overview, rule.id);
  return {
    ...stall,
    day: built.day,
    ruleId: rule.id,
    threshold: THRESHOLD,
    days: built.stall.map((point) => point.day).sort(),
    closed,
  };
}

function usage() {
  return `用法:
  node scripts/demo-growth-stall-threshold.mjs

把全场规则「生长异常预警」写成阈值 ${THRESHOLD} 天，写入 ${DEMO_CAMERA} 连续三天菌盖直径 ${CAP_DIAMETER}。步骤见 docs/DEMO_GROWTH_STALL_THRESHOLD.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const sent = await sendDemo();
    process.stdout.write(`${formatGrowthStallProof(sent)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
