#!/usr/bin/env node
/**
 * 把全场规则「采摘提醒」的成熟菇数量阈值写成 8，并写入当天成熟数。
 * 当前成熟 ≥ 8 时，总览写出采摘提醒。样例文件不改。不按这条规则新开告警。
 * 对照摄像头 CAM-MPT-NONE 不写入。
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
export const RULE_NAME = '采摘提醒';
export const RULE_METRIC = 'live_mature_pick';
export const THRESHOLD = 8;
export const DEMO_SHED = 'S01';
export const CONTROL_SHED = 'S02';
export const CONTRAST_CAMERA = 'CAM-MPT-NONE';
export const EXPECTED_CLEAN_NOTE = '采摘提醒 成熟≥8 当前8';

export const PICK_POINTS = [
  {
    shedCode: DEMO_SHED,
    cameraCode: 'CAM-MPT-01',
    offsetMs: 6 * 60 * 1000,
    mushroomCount: 20,
    matureCount: 8,
  },
  {
    shedCode: CONTROL_SHED,
    cameraCode: 'CAM-MPT-ZERO',
    offsetMs: 2 * 60 * 1000,
    mushroomCount: 0,
    matureCount: 0,
  },
];

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

export function buildMaturePickPayloads(now = new Date()) {
  const fixture = readFixture(DEMO_FIXTURE);
  const { day, start, end } = shanghaiDayOf(now);
  const points = PICK_POINTS.map((point, index) => ({
    ...point,
    body: {
      idempotencyKey: `demo-mature-pick-threshold-${point.cameraCode}-${day}`,
      shedCode: point.shedCode,
      cameraCode: point.cameraCode,
      recognizedAt: recognizedAtFor(now, index, point.offsetMs),
      mushroomCount: point.mushroomCount,
      matureCount: point.matureCount,
      capDiameters: fixture.body.capDiameters,
      diseaseCount: 0,
      diseaseLevel: 0,
      temperature: fixture.body.temperature,
      humidity: fixture.body.humidity,
      co2: fixture.body.co2,
      substrateMoisture: fixture.body.substrateMoisture,
    },
  }));
  return { points, day, start: start.toISOString(), end: end.toISOString() };
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
  return value;
}

export function validateMaturePickPayloads(sample, now = new Date()) {
  if (!Array.isArray(sample.points) || sample.points.length !== PICK_POINTS.length) {
    throw new Error(`采摘提醒要正好 ${PICK_POINTS.length} 条识别`);
  }
  const { start, end } = shanghaiDayOf(now);
  const values = sample.points.map((point) => validateOne(point.body, now, point));
  const times = values.map((value) => new Date(value.recognizedAt).getTime());
  if (new Set(times).size !== times.length) throw new Error('识别时间必须不同');
  for (const at of times) {
    if (at < start.getTime() || at >= end.getTime()) throw new Error('识别时间不在今天的上海日里');
  }
  const seeded = sample.points.reduce((sum, point) => sum + point.matureCount, 0);
  if (seeded !== THRESHOLD) {
    throw new Error(`写入的成熟数合计是 ${seeded}，应为阈值 ${THRESHOLD}`);
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
      Number(item.mushroomCount) === point.mushroomCount &&
      Number(item.matureCount) === point.matureCount,
  );
  if (!row) {
    throw new Error(`${point.cameraCode} 当天没有蘑菇 ${point.mushroomCount}、成熟 ${point.matureCount}`);
  }
  return row;
}

export function assertContrastEmpty(items) {
  const rows = Array.isArray(items) ? items : [];
  if (rows.length !== 0) throw new Error(`对照摄像头仍有 ${rows.length} 条`);
}

export function assertOverviewMaturePick(overview, ruleId) {
  const parsed = contracts().parseMaturePickReminder(overview);
  if (!parsed.ok) throw new Error(`总览采摘提醒未通过契约：${parsed.errors.join('；')}`);
  const row = parsed.value;
  if (row.maturePickThreshold !== THRESHOLD) {
    throw new Error(`成熟菇数量阈值是 ${row.maturePickThreshold}，应为 ${THRESHOLD}`);
  }
  if (row.maturePickShedCode !== null) {
    throw new Error(`采摘提醒棚区是 ${row.maturePickShedCode}，应为全场`);
  }
  if (ruleId && row.maturePickRuleId !== ruleId) {
    throw new Error(`采摘提醒规则是 ${row.maturePickRuleId}，应为 ${ruleId}`);
  }
  if (!row.maturePickActive) throw new Error('当前成熟没有达到阈值，采摘提醒未出现');
  if (row.maturePickMatureCount < THRESHOLD) {
    throw new Error(`当前成熟 ${row.maturePickMatureCount} 小于阈值 ${THRESHOLD}`);
  }
  const note = contracts().formatMaturePickNote({
    active: true,
    threshold: row.maturePickThreshold,
    matureCount: row.maturePickMatureCount,
    shedCode: null,
  });
  if (row.maturePickNote !== note) {
    throw new Error(`旁注是「${row.maturePickNote}」，应为「${note}」`);
  }
  const clean = row.maturePickMatureCount === THRESHOLD;
  if (clean && note !== EXPECTED_CLEAN_NOTE) {
    throw new Error(`干净当天旁注是「${note}」，应为「${EXPECTED_CLEAN_NOTE}」`);
  }
  return { ...row, clean, note };
}

export function screenUrl(webOrigin = webOriginFromEnv()) {
  return `${String(webOrigin).replace(/\/$/, '')}/`;
}

export function formatMaturePickProof({
  note,
  clean,
  threshold,
  matureCount,
  day,
  ruleId,
  webOrigin = webOriginFromEnv(),
}) {
  return [
    note,
    `成熟菇数量阈值: ${threshold}`,
    `当前成熟: ${matureCount}`,
    `范围: 全场`,
    `规则: ${RULE_NAME} ${ruleId}`,
    `指标: ${RULE_METRIC}`,
    `${PICK_POINTS[0].cameraCode}（${DEMO_SHED}）: 蘑菇 ${PICK_POINTS[0].mushroomCount} · 成熟 ${PICK_POINTS[0].matureCount}`,
    `${PICK_POINTS[1].cameraCode}（${CONTROL_SHED}）: 蘑菇 0 · 成熟 0`,
    `对照 ${CONTRAST_CAMERA}: 当天 0 条`,
    clean ? `干净当天: ${EXPECTED_CLEAN_NOTE}` : `当天已有别的成熟日桶，旁注仍是采摘提醒，当前数不小于 ${THRESHOLD}`,
    `上海日: ${day}`,
    '登录: admin / Admin@123456',
    `总览: ${screenUrl(webOrigin)}`,
    '不新开告警行。',
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

function listUrl(shedCode, cameraCode, start, end) {
  const to = new Date(new Date(end).getTime() - 1).toISOString();
  const params = new URLSearchParams({
    shedCode,
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

function isPickRule(rule) {
  return rule?.metric === RULE_METRIC;
}

async function ensurePickRule(token) {
  const listed = asRules(await getJson(token, `${apiBase()}/alert-rules`));
  let rule = listed.find(
    (item) => isPickRule(item) && item.name === RULE_NAME && !String(item.shedCode || '').trim(),
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
  if (!rule?.id) throw new Error('采摘提醒规则没有 id');
  const saved = await sendJson(token, `${apiBase()}/alert-rules/${rule.id}`, 'PATCH', {
    threshold: THRESHOLD,
    enabled: true,
    level: 'info',
  });
  if (Number(saved.threshold) !== THRESHOLD || saved.enabled !== true) {
    throw new Error(`采摘提醒规则保存后不是阈值 ${THRESHOLD}、启用`);
  }
  if (saved.metric !== RULE_METRIC) throw new Error(`规则指标是 ${saved.metric}，应为 ${RULE_METRIC}`);
  if (String(saved.shedCode || '').trim()) throw new Error('采摘提醒规则不应限定棚区');
  const again = asRules(await getJson(token, `${apiBase()}/alert-rules`));
  for (const item of again) {
    if (!isPickRule(item) || item.id === saved.id || item.enabled !== true) continue;
    await sendJson(token, `${apiBase()}/alert-rules/${item.id}`, 'PATCH', { enabled: false });
  }
  return saved;
}

async function assertNoPickAlert(token, cameraCode) {
  const listed = await getJson(
    token,
    `${apiBase()}/alerts?cameraCode=${encodeURIComponent(cameraCode)}&status=open&pageSize=50`,
  );
  const items = Array.isArray(listed.items) ? listed.items : [];
  const hit = items.filter((item) => item.metric === RULE_METRIC);
  if (hit.length) throw new Error(`${cameraCode} 上出现了成熟菇数量告警行`);
}

export async function sendDemo({ now = new Date() } = {}) {
  const built = buildMaturePickPayloads(now);
  validateMaturePickPayloads(built, now);
  const token = await login();
  const rule = await ensurePickRule(token);
  for (const point of built.points) {
    await postRecognition(point.body);
  }
  for (const point of built.points) {
    const listed = await getJson(
      token,
      listUrl(point.shedCode, point.cameraCode, built.start, built.end),
    );
    assertCameraDay(listed.items, point);
  }
  const contrast = await getJson(
    token,
    listUrl(DEMO_SHED, CONTRAST_CAMERA, built.start, built.end),
  );
  assertContrastEmpty(contrast.items);
  for (const point of built.points) {
    await assertNoPickAlert(token, point.cameraCode);
  }
  const overview = await getJson(token, `${apiBase()}/dashboard/overview`);
  const pick = assertOverviewMaturePick(overview, rule.id);
  return { ...pick, day: built.day, ruleId: rule.id, threshold: THRESHOLD };
}

function usage() {
  return `用法:
  node scripts/demo-mature-pick-threshold.mjs

把全场规则「采摘提醒」写成阈值 ${THRESHOLD}，写入 CAM-MPT-01 成熟 ${THRESHOLD}。步骤见 docs/DEMO_MATURE_PICK_THRESHOLD.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const sent = await sendDemo();
    process.stdout.write(`${formatMaturePickProof(sent)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
