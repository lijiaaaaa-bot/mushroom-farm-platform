#!/usr/bin/env node
/**
 * 把全场规则「病害比例预警」「重度病害预警」写成演示阈值，并写入当天日桶。
 * 病害比例或重度数量达到阈值时，总览写出病害预警。样例文件不改。
 * 这两条规则不按单条识别新开告警。病害等级 3 会碰到种子规则「病害等级一般」「病害等级严重」，
 * 命令只关闭这两台演示摄像头上因此留下的未闭合告警。
 * 对照摄像头 CAM-DRT-NONE 不写入。
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
export const RATIO_RULE_NAME = '病害比例预警';
export const SEVERE_RULE_NAME = '重度病害预警';
export const RATIO_METRIC = 'live_disease_ratio';
export const SEVERE_METRIC = 'live_disease_severe';
export const RATIO_THRESHOLD = 20;
export const SEVERE_THRESHOLD = 4;
export const DEMO_SHED = 'S01';
export const CONTROL_SHED = 'S02';
export const CONTRAST_CAMERA = 'CAM-DRT-NONE';
export const CLOSE_NOTE = '病害预警演示后关闭';
export const EXPECTED_CLEAN_RATIO_NOTE = '病害预警 比例≥20% 当前20%';
export const EXPECTED_CLEAN_SEVERE_NOTE = '病害预警 重度≥4 当前4';

export const DISEASE_POINTS = [
  {
    shedCode: DEMO_SHED,
    cameraCode: 'CAM-DRT-01',
    offsetMs: 6 * 60 * 1000,
    mushroomCount: 20,
    matureCount: 4,
    diseaseCount: 4,
    diseaseLevel: 3,
  },
  {
    shedCode: CONTROL_SHED,
    cameraCode: 'CAM-DRT-ZERO',
    offsetMs: 2 * 60 * 1000,
    mushroomCount: 0,
    matureCount: 0,
    diseaseCount: 0,
    diseaseLevel: 0,
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

export function buildDiseaseWarnPayloads(now = new Date()) {
  const fixture = readFixture(DEMO_FIXTURE);
  const { day, start, end } = shanghaiDayOf(now);
  const points = DISEASE_POINTS.map((point, index) => ({
    ...point,
    body: {
      idempotencyKey: `demo-disease-ratio-threshold-${point.cameraCode}-${day}`,
      shedCode: point.shedCode,
      cameraCode: point.cameraCode,
      recognizedAt: recognizedAtFor(now, index, point.offsetMs),
      mushroomCount: point.mushroomCount,
      matureCount: point.matureCount,
      capDiameters: fixture.body.capDiameters,
      diseaseCount: point.diseaseCount,
      diseaseLevel: point.diseaseLevel,
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
  if (value.diseaseCount !== point.diseaseCount) {
    throw new Error(`病害数量是 ${value.diseaseCount}，应为 ${point.diseaseCount}`);
  }
  if (value.diseaseLevel !== point.diseaseLevel) {
    throw new Error(`病害等级是 ${value.diseaseLevel}，应为 ${point.diseaseLevel}`);
  }
  if (value.diseaseCount >= 5) throw new Error('病害数量达到种子规则「病害数量一般」的 5');
  if (value.mushroomCount > 0 && value.matureCount / value.mushroomCount >= 0.6) {
    throw new Error('成熟占比达到种子规则「成熟占比一般」的 0.6');
  }
  if (value.temperature !== 22.5) throw new Error(`温度是 ${value.temperature}，应为 22.5`);
  if (value.snapshotBase64 || value.snapshotUrl) throw new Error('本次请求不带抓拍');
  return value;
}

export function validateDiseaseWarnPayloads(sample, now = new Date()) {
  if (!Array.isArray(sample.points) || sample.points.length !== DISEASE_POINTS.length) {
    throw new Error(`病害预警要正好 ${DISEASE_POINTS.length} 条识别`);
  }
  const { start, end } = shanghaiDayOf(now);
  const values = sample.points.map((point) => validateOne(point.body, now, point));
  const times = values.map((value) => new Date(value.recognizedAt).getTime());
  if (new Set(times).size !== times.length) throw new Error('识别时间必须不同');
  for (const at of times) {
    if (at < start.getTime() || at >= end.getTime()) throw new Error('识别时间不在今天的上海日里');
  }
  const disease = sample.points.reduce((sum, point) => sum + point.diseaseCount, 0);
  const mushroom = sample.points.reduce((sum, point) => sum + point.mushroomCount, 0);
  const severe = sample.points.reduce(
    (sum, point) => sum + (point.diseaseLevel === 3 ? point.diseaseCount : 0),
    0,
  );
  if (contracts().diseaseRatioPercent(disease, mushroom) !== RATIO_THRESHOLD) {
    throw new Error(`写入的病害比例不是 ${RATIO_THRESHOLD}%`);
  }
  if (severe !== SEVERE_THRESHOLD) {
    throw new Error(`写入的重度病害数量是 ${severe}，应为 ${SEVERE_THRESHOLD}`);
  }
  const fixture = readFixture(DEMO_FIXTURE);
  if (fixture.body.cameraCode !== 'CAM-DEMO-01') throw new Error('样例文件里的摄像头被改掉了');
  if (fixture.body.mushroomCount !== 12) throw new Error('样例文件里的蘑菇数被改掉了');
  if (fixture.body.diseaseCount !== 1) throw new Error('样例文件里的病害数量被改掉了');
  if (fixture.body.diseaseLevel !== 1) throw new Error('样例文件里的病害等级被改掉了');
  if (!fixture.body.snapshotBase64) throw new Error('样例文件里的 AI抓拍图被去掉了');
  return sample;
}

export function assertCameraDay(items, point) {
  const rows = Array.isArray(items) ? items : [];
  const row = rows.find(
    (item) =>
      item.cameraCode === point.cameraCode &&
      Number(item.mushroomCount) === point.mushroomCount &&
      Number(item.diseaseCount) === point.diseaseCount &&
      Number(item.diseaseLevel) === point.diseaseLevel,
  );
  if (!row) {
    throw new Error(
      `${point.cameraCode} 当天没有蘑菇 ${point.mushroomCount}、病害 ${point.diseaseCount}、等级 ${point.diseaseLevel}`,
    );
  }
  return row;
}

export function assertContrastEmpty(items) {
  const rows = Array.isArray(items) ? items : [];
  if (rows.length !== 0) throw new Error(`对照摄像头仍有 ${rows.length} 条`);
}

export function assertOverviewDiseaseWarn(overview, ruleIds = {}) {
  const parsed = contracts().parseDiseaseWarning(overview);
  if (!parsed.ok) throw new Error(`总览病害预警未通过契约：${parsed.errors.join('；')}`);
  const row = parsed.value;
  if (row.diseaseWarnRatioThreshold !== RATIO_THRESHOLD) {
    throw new Error(`病害比例阈值是 ${row.diseaseWarnRatioThreshold}，应为 ${RATIO_THRESHOLD}`);
  }
  if (row.diseaseWarnSevereThreshold !== SEVERE_THRESHOLD) {
    throw new Error(`重度病害数量阈值是 ${row.diseaseWarnSevereThreshold}，应为 ${SEVERE_THRESHOLD}`);
  }
  if (row.diseaseWarnRatioShedCode !== null || row.diseaseWarnSevereShedCode !== null) {
    throw new Error('病害预警规则不应限定棚区');
  }
  if (ruleIds.ratioId && row.diseaseWarnRatioRuleId !== ruleIds.ratioId) {
    throw new Error(`病害比例规则是 ${row.diseaseWarnRatioRuleId}，应为 ${ruleIds.ratioId}`);
  }
  if (ruleIds.severeId && row.diseaseWarnSevereRuleId !== ruleIds.severeId) {
    throw new Error(`重度病害规则是 ${row.diseaseWarnSevereRuleId}，应为 ${ruleIds.severeId}`);
  }
  if (!row.diseaseWarnRatioActive) throw new Error('当前病害比例没有达到阈值，病害预警未出现');
  if (!row.diseaseWarnSevereActive) throw new Error('当前重度病害数量没有达到阈值，病害预警未出现');
  if (row.diseaseWarnRatioPercent < RATIO_THRESHOLD) {
    throw new Error(`当前比例 ${row.diseaseWarnRatioPercent} 小于阈值 ${RATIO_THRESHOLD}`);
  }
  if (row.diseaseWarnSevereCount < SEVERE_THRESHOLD) {
    throw new Error(`当前重度 ${row.diseaseWarnSevereCount} 小于阈值 ${SEVERE_THRESHOLD}`);
  }
  const ratioNote = contracts().formatDiseaseWarnRatioNote({
    active: true,
    threshold: row.diseaseWarnRatioThreshold,
    percent: row.diseaseWarnRatioPercent,
    shedCode: null,
  });
  const severeNote = contracts().formatDiseaseWarnSevereNote({
    active: true,
    threshold: row.diseaseWarnSevereThreshold,
    severeCount: row.diseaseWarnSevereCount,
    shedCode: null,
  });
  if (row.diseaseWarnRatioNote !== ratioNote) {
    throw new Error(`比例旁注是「${row.diseaseWarnRatioNote}」，应为「${ratioNote}」`);
  }
  if (row.diseaseWarnSevereNote !== severeNote) {
    throw new Error(`重度旁注是「${row.diseaseWarnSevereNote}」，应为「${severeNote}」`);
  }
  const clean =
    row.diseaseWarnRatioPercent === RATIO_THRESHOLD &&
    row.diseaseWarnSevereCount === SEVERE_THRESHOLD;
  if (clean && ratioNote !== EXPECTED_CLEAN_RATIO_NOTE) {
    throw new Error(`干净当天比例旁注是「${ratioNote}」，应为「${EXPECTED_CLEAN_RATIO_NOTE}」`);
  }
  if (clean && severeNote !== EXPECTED_CLEAN_SEVERE_NOTE) {
    throw new Error(`干净当天重度旁注是「${severeNote}」，应为「${EXPECTED_CLEAN_SEVERE_NOTE}」`);
  }
  return { ...row, clean, ratioNote, severeNote };
}

export function screenUrl(webOrigin = webOriginFromEnv()) {
  return `${String(webOrigin).replace(/\/$/, '')}/`;
}

export function formatDiseaseWarnProof({
  ratioNote,
  severeNote,
  clean,
  ratioPercent,
  severeCount,
  day,
  ratioId,
  severeId,
  closed = 0,
  webOrigin = webOriginFromEnv(),
}) {
  return [
    ratioNote,
    severeNote,
    `病害比例阈值: ${RATIO_THRESHOLD}%`,
    `当前比例: ${ratioPercent}%`,
    `重度病害数量阈值: ${SEVERE_THRESHOLD}`,
    `当前重度: ${severeCount}`,
    '范围: 全场',
    `规则: ${RATIO_RULE_NAME} ${ratioId}`,
    `规则: ${SEVERE_RULE_NAME} ${severeId}`,
    `指标: ${RATIO_METRIC} ${SEVERE_METRIC}`,
    `${DISEASE_POINTS[0].cameraCode}（${DEMO_SHED}）: 蘑菇 ${DISEASE_POINTS[0].mushroomCount} · 病害 ${DISEASE_POINTS[0].diseaseCount} · 等级 ${DISEASE_POINTS[0].diseaseLevel}`,
    `${DISEASE_POINTS[1].cameraCode}（${CONTROL_SHED}）: 蘑菇 0 · 病害 0 · 等级 0`,
    `对照 ${CONTRAST_CAMERA}: 当天 0 条`,
    clean
      ? `干净当天: ${EXPECTED_CLEAN_RATIO_NOTE}；${EXPECTED_CLEAN_SEVERE_NOTE}`
      : `当天已有别的病害日桶，旁注仍是病害预警，比例不小于 ${RATIO_THRESHOLD}%，重度不小于 ${SEVERE_THRESHOLD}`,
    `关闭种子病害等级告警: ${closed}`,
    `上海日: ${day}`,
    '登录: admin / Admin@123456',
    `总览: ${screenUrl(webOrigin)}`,
    '病害比例和重度病害数量不新开告警行。',
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

async function ensureFarmRule(token, { name, metric, threshold }) {
  const listed = asRules(await getJson(token, `${apiBase()}/alert-rules`));
  let rule = listed.find(
    (item) => item?.metric === metric && item.name === name && !String(item.shedCode || '').trim(),
  );
  if (!rule) {
    rule = await sendJson(token, `${apiBase()}/alert-rules`, 'POST', {
      name,
      metric,
      threshold,
      level: 'info',
      windowMinutes: 720,
    });
  }
  if (!rule?.id) throw new Error(`${name} 规则没有 id`);
  const saved = await sendJson(token, `${apiBase()}/alert-rules/${rule.id}`, 'PATCH', {
    threshold,
    enabled: true,
    level: 'info',
  });
  if (Number(saved.threshold) !== threshold || saved.enabled !== true) {
    throw new Error(`${name} 保存后不是阈值 ${threshold}、启用`);
  }
  if (saved.metric !== metric) throw new Error(`规则指标是 ${saved.metric}，应为 ${metric}`);
  if (String(saved.shedCode || '').trim()) throw new Error(`${name} 不应限定棚区`);
  const again = asRules(await getJson(token, `${apiBase()}/alert-rules`));
  for (const item of again) {
    if (item?.metric !== metric || item.id === saved.id || item.enabled !== true) continue;
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

async function closeSeedLevelAlerts(token, cameraCode) {
  const open = await listOpenAlerts(token, cameraCode, 'open');
  const acked = await listOpenAlerts(token, cameraCode, 'acked');
  const targets = [...open, ...acked].filter((item) => item.metric === 'disease_level');
  for (const row of targets) {
    await sendJson(token, `${apiBase()}/alerts/${encodeURIComponent(row.id)}/close`, 'POST', {
      note: CLOSE_NOTE,
    });
  }
  const left = [
    ...(await listOpenAlerts(token, cameraCode, 'open')),
    ...(await listOpenAlerts(token, cameraCode, 'acked')),
  ].filter((item) => item.metric === 'disease_level');
  if (left.length) throw new Error(`${cameraCode} 还有 ${left.length} 条未闭合的病害等级告警`);
  return targets.length;
}

export async function sendDemo({ now = new Date() } = {}) {
  const built = buildDiseaseWarnPayloads(now);
  validateDiseaseWarnPayloads(built, now);
  const token = await login();
  const ratioRule = await ensureFarmRule(token, {
    name: RATIO_RULE_NAME,
    metric: RATIO_METRIC,
    threshold: RATIO_THRESHOLD,
  });
  const severeRule = await ensureFarmRule(token, {
    name: SEVERE_RULE_NAME,
    metric: SEVERE_METRIC,
    threshold: SEVERE_THRESHOLD,
  });
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
  let closed = 0;
  for (const point of built.points) {
    await assertNoMetricAlert(token, point.cameraCode, RATIO_METRIC);
    await assertNoMetricAlert(token, point.cameraCode, SEVERE_METRIC);
    closed += await closeSeedLevelAlerts(token, point.cameraCode);
  }
  const overview = await getJson(token, `${apiBase()}/dashboard/overview`);
  const warning = assertOverviewDiseaseWarn(overview, {
    ratioId: ratioRule.id,
    severeId: severeRule.id,
  });
  return {
    ...warning,
    day: built.day,
    ratioId: ratioRule.id,
    severeId: severeRule.id,
    closed,
  };
}

function usage() {
  return `用法:
  node scripts/demo-disease-ratio-threshold.mjs

把全场「病害比例预警」写成 ${RATIO_THRESHOLD}%，「重度病害预警」写成 ${SEVERE_THRESHOLD}。步骤见 docs/DEMO_DISEASE_RATIO_THRESHOLD.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const sent = await sendDemo();
    process.stdout.write(
      `${formatDiseaseWarnProof({
        ratioNote: sent.ratioNote,
        severeNote: sent.severeNote,
        clean: sent.clean,
        ratioPercent: sent.diseaseWarnRatioPercent,
        severeCount: sent.diseaseWarnSevereCount,
        day: sent.day,
        ratioId: sent.ratioId,
        severeId: sent.severeId,
        closed: sent.closed,
      })}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
