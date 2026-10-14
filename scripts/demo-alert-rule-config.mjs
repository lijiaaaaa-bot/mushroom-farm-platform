#!/usr/bin/env node
/**
 * 改规则「演示环境温度过高」的阈值，再 POST 环境遥测。
 * 温度 26℃：阈值 30 时不告警；改成 24 后告警；改回 30 后不再告警。
 * 最后把阈值写回 24 并再发一条，列表和详情留下这条告警。
 * 种子规则「温度过高」仍是 28。棚区限定 S03，不改 S01 上的已有演示。
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { apiBase, ingestToken, postJson, repoRoot } from './lib/ingest-wire.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';

const require = createRequire(import.meta.url);

export const RULE_NAME = '演示环境温度过高';
export const SEED_RULE_NAME = '温度过高';
export const RULE_METRIC = 'temperature_high';
export const DEMO_SENSOR = 'SENSOR-RULE-01';
export const DEMO_SHED = 'S03';
export const SAMPLE_TEMPERATURE = 26;
export const SAMPLE_HUMIDITY = 88;
export const SAMPLE_CO2 = 900;
export const SAMPLE_MOISTURE = 70;
export const THRESHOLD_QUIET = 30;
export const THRESHOLD_FIRE = 24;
export const SEED_THRESHOLD = 28;
export const ALERT_TITLE = '温度过高告警';
export const CLOSE_NOTE = '改环境阈值前关闭';

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function sameNumber(left, right) {
  const a = Number(left);
  const b = Number(right);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-6;
}

export function buildSample(now = new Date(), suffix = 'fire') {
  return {
    idempotencyKey: `demo-alert-rule-${now.getTime()}-${suffix}`,
    shedCode: DEMO_SHED,
    sensorCode: DEMO_SENSOR,
    observedAt: now.toISOString(),
    temperature: SAMPLE_TEMPERATURE,
    humidity: SAMPLE_HUMIDITY,
    co2: SAMPLE_CO2,
    substrateMoisture: SAMPLE_MOISTURE,
  };
}

export function validateSample(body, now = new Date()) {
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
  if (!sameNumber(value.temperature, SAMPLE_TEMPERATURE)) {
    throw new Error(`温度是 ${value.temperature}，应为 ${SAMPLE_TEMPERATURE}`);
  }
  if (!(value.temperature > THRESHOLD_FIRE) || !(value.temperature < SEED_THRESHOLD)) {
    throw new Error(
      `温度 ${value.temperature} 应高于演示阈值 ${THRESHOLD_FIRE}，且低于种子阈值 ${SEED_THRESHOLD}`,
    );
  }
  if (!(value.temperature < THRESHOLD_QUIET)) {
    throw new Error(`温度 ${value.temperature} 在阈值 ${THRESHOLD_QUIET} 时仍会告警`);
  }
  if (value.humidity !== SAMPLE_HUMIDITY || value.humidity <= 70 || value.humidity >= 98) {
    throw new Error(`湿度 ${value.humidity} 会碰到湿度种子规则`);
  }
  if (value.co2 !== SAMPLE_CO2 || value.co2 > 2000) {
    throw new Error(`CO₂ ${value.co2} 会碰到二氧化碳种子规则`);
  }
  if (value.substrateMoisture !== SAMPLE_MOISTURE || value.substrateMoisture < 50) {
    throw new Error(`基质含水率 ${value.substrateMoisture} 会碰到基质种子规则`);
  }
  return value;
}

export function assertSeedRule(rule) {
  if (!rule) throw new Error(`没有种子规则「${SEED_RULE_NAME}」。`);
  if (rule.metric !== RULE_METRIC) {
    throw new Error(`种子规则「${SEED_RULE_NAME}」的指标是 ${rule.metric}，应为 ${RULE_METRIC}。`);
  }
  if (!sameNumber(rule.threshold, SEED_THRESHOLD)) {
    throw new Error(
      `种子规则「${SEED_RULE_NAME}」阈值是 ${rule.threshold}，应为 ${SEED_THRESHOLD}。这条演示不改它。`,
    );
  }
  if (rule.enabled !== true) throw new Error(`种子规则「${SEED_RULE_NAME}」没有启用。`);
  return rule;
}

export function isOwnAlert(row, ruleId) {
  return Boolean(
    row &&
      row.ruleId === ruleId &&
      row.shedCode === DEMO_SHED &&
      row.sensorCode === DEMO_SENSOR &&
      row.metric === RULE_METRIC &&
      (row.status === 'open' || row.status === 'acked'),
  );
}

export function assertFireRow(row, ruleId) {
  const missing = [];
  if (row?.ruleId !== ruleId) missing.push('规则');
  if (row?.title !== ALERT_TITLE) missing.push('标题');
  if (row?.shedCode !== DEMO_SHED) missing.push('棚区');
  if (row?.sensorCode !== DEMO_SENSOR) missing.push('传感器');
  if (row?.cameraCode) missing.push('摄像头应为空');
  if (row?.level !== 'warning') missing.push('级别');
  if (row?.status !== 'open') missing.push('状态');
  if (row?.metric !== RULE_METRIC) missing.push('指标');
  if (!sameNumber(row?.metricValue, SAMPLE_TEMPERATURE)) missing.push('当前值');
  if (!sameNumber(row?.threshold, THRESHOLD_FIRE)) missing.push('阈值');
  const message = String(row?.message || '');
  if (!message.includes(`棚区 ${DEMO_SHED}`)) missing.push('说明里的棚区');
  if (!message.includes(`传感器 ${DEMO_SENSOR}`)) missing.push('说明里的传感器');
  if (!message.includes('温度过高')) missing.push('说明里的指标');
  if (!message.includes(String(SAMPLE_TEMPERATURE))) missing.push('说明里的当前值');
  if (!message.includes(`阈值 ${THRESHOLD_FIRE}`)) missing.push('说明里的阈值');
  if (missing.length) throw new Error(`告警缺少${missing.join('、')}`);
  return row;
}

export function rulesUrl(webOrigin = webOriginFromEnv()) {
  return `${String(webOrigin).replace(/\/$/, '')}/alert-rules`;
}

export function alertListUrl(id, webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const params = new URLSearchParams({
    shedCode: DEMO_SHED,
    alertId: id,
  });
  return `${origin}/alerts?${params.toString()}`;
}

export function alertDetailUrl(id, webOrigin = webOriginFromEnv()) {
  return `${String(webOrigin).replace(/\/$/, '')}/alerts/${encodeURIComponent(id)}`;
}

export function formatRuleConfigProof({
  closedBefore,
  closedBeforeRaise,
  quietReadingId,
  raisedReadingId,
  detail,
  webOrigin = webOriginFromEnv(),
}) {
  const labels = contracts();
  const lines = [
    `规则: ${RULE_NAME}`,
    `指标: ${labels.ALERT_METRIC_LABEL[RULE_METRIC] || RULE_METRIC}`,
    `棚区: ${DEMO_SHED}`,
    `传感器: ${DEMO_SENSOR}`,
    `温度: ${SAMPLE_TEMPERATURE}℃`,
    `湿度: ${SAMPLE_HUMIDITY}%`,
    `CO₂: ${SAMPLE_CO2}`,
    `基质含水率: ${SAMPLE_MOISTURE}%`,
    `种子规则: ${SEED_RULE_NAME}`,
    `种子阈值: ${SEED_THRESHOLD}`,
    `阈值 ${THRESHOLD_QUIET} 时未告警: 是`,
    `安静读数 id: ${quietReadingId}`,
    `阈值: ${THRESHOLD_QUIET} → ${THRESHOLD_FIRE}`,
    `把阈值改回 ${THRESHOLD_QUIET} 后未告警: 是`,
    `抬高后读数 id: ${raisedReadingId}`,
    `最终阈值: ${THRESHOLD_FIRE}`,
    `开始前关闭: ${closedBefore} 条`,
    `抬高前关闭: ${closedBeforeRaise} 条`,
    `告警 id: ${detail.id}`,
    `标题: ${detail.title}`,
    `说明: ${detail.message}`,
    `级别: ${labels.ALERT_LEVEL_LABEL[detail.level] || detail.level}`,
    `状态: ${labels.ALERT_STATUS_LABEL[detail.status] || detail.status}`,
    `当前值: ${detail.metricValue}`,
    `阈值读回: ${detail.threshold}`,
    '列表里有这一条: 是',
    '详情里有这一条: 是',
    '登录: admin / Admin@123456',
    `阈值规则: ${rulesUrl(webOrigin)}`,
    `告警列表: ${alertListUrl(detail.id, webOrigin)}`,
    `告警详情: ${alertDetailUrl(detail.id, webOrigin)}`,
  ];
  return lines.join('\n');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageText(payload) {
  const message = payload?.message ?? payload?.error;
  if (Array.isArray(message)) return message.join('；');
  if (typeof message === 'string') return message;
  if (message && typeof message === 'object') {
    const errors = message.errors || payload?.errors;
    const code = message.code || payload?.code;
    const list = Array.isArray(errors) ? errors.join('；') : JSON.stringify(payload);
    return code ? `${code} ${list}` : list;
  }
  return '';
}

function flag(payload, key) {
  return payload?.[key] ?? payload?.message?.[key];
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

async function api(token, method, path, body) {
  let response;
  try {
    response = await fetch(`${apiBase()}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    throw new Error(`API 连不上（${apiBase()}${path}）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${method} ${path} 失败 ${response.status} ${messageText(payload) || JSON.stringify(payload)}`);
  }
  return payload;
}

async function listRules(token) {
  const body = await api(token, 'GET', '/alert-rules');
  if (!Array.isArray(body)) throw new Error('阈值规则列表不是数组');
  assertSeedRule(body.find((rule) => rule.name === SEED_RULE_NAME));
  return body;
}

async function ensureRule(token) {
  const rules = await listRules(token);
  const found = rules.find((rule) => rule.name === RULE_NAME);
  if (!found) {
    return api(token, 'POST', '/alert-rules', {
      name: RULE_NAME,
      metric: RULE_METRIC,
      threshold: THRESHOLD_QUIET,
      level: 'warning',
      shedCode: DEMO_SHED,
      windowMinutes: 720,
    });
  }
  if (found.metric !== RULE_METRIC) {
    throw new Error(`规则「${RULE_NAME}」的指标是 ${found.metric}，这条演示要改 ${RULE_METRIC}。`);
  }
  if (found.shedCode !== DEMO_SHED) {
    throw new Error(
      `规则「${RULE_NAME}」的棚区是 ${found.shedCode || '全场'}，这条遥测在 ${DEMO_SHED}。`,
    );
  }
  return found;
}

async function patchRule(token, id, threshold) {
  const saved = await api(token, 'PATCH', `/alert-rules/${encodeURIComponent(id)}`, {
    threshold,
    enabled: true,
    level: 'warning',
  });
  if (!sameNumber(saved.threshold, threshold)) {
    throw new Error(`保存后的阈值是 ${saved.threshold}，要写成 ${threshold}。`);
  }
  if (saved.enabled !== true) throw new Error(`规则「${RULE_NAME}」没有启用。`);
  if (saved.level !== 'warning') throw new Error(`规则「${RULE_NAME}」的级别是 ${saved.level}，应为一般。`);
  return saved;
}

async function confirmRule(token, id, threshold) {
  const rules = await listRules(token);
  const rule = rules.find((item) => item.id === id);
  if (!rule) throw new Error('阈值规则列表里没有刚改过的规则');
  if (!sameNumber(rule.threshold, threshold)) {
    throw new Error(`规则列表里的阈值是 ${rule.threshold}，应为 ${threshold}。`);
  }
  if (rule.enabled !== true) throw new Error(`规则「${RULE_NAME}」没有启用。`);
  if (rule.shedCode !== DEMO_SHED) {
    throw new Error(`规则「${RULE_NAME}」的棚区是 ${rule.shedCode || '全场'}，应为 ${DEMO_SHED}。`);
  }
  return rule;
}

async function listByStatus(token, status) {
  const path =
    `/alerts?shedCode=${encodeURIComponent(DEMO_SHED)}` +
    `&status=${encodeURIComponent(status)}&pageSize=100`;
  const body = await api(token, 'GET', path);
  return Array.isArray(body.items) ? body.items : [];
}

async function listSensorAlerts(token) {
  const [open, acked] = await Promise.all([
    listByStatus(token, 'open'),
    listByStatus(token, 'acked'),
  ]);
  const byId = new Map();
  for (const row of [...open, ...acked]) {
    if (row?.sensorCode === DEMO_SENSOR && row?.shedCode === DEMO_SHED) byId.set(row.id, row);
  }
  return [...byId.values()];
}

async function closeSensorAlerts(token) {
  const open = await listSensorAlerts(token);
  for (const row of open) {
    await api(token, 'POST', `/alerts/${encodeURIComponent(row.id)}/close`, { note: CLOSE_NOTE });
  }
  const left = await listSensorAlerts(token);
  if (left.length) {
    throw new Error(`传感器 ${DEMO_SENSOR} 上还有未闭合告警，新遥测不会另建一条。`);
  }
  return open.length;
}

async function assertNoSensorAlert(token, label) {
  const rows = await listSensorAlerts(token);
  if (rows.length) {
    throw new Error(
      `${label}。仍有 ${rows.length} 条未闭合告警（${rows.map((row) => row.id).join('、')}）。`,
    );
  }
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
    throw new Error('这次没有写入新读数');
  }
  return { id };
}

async function findFreshAlert(token, ruleId, beforeIds) {
  const deadline = Date.now() + 8_000;
  while (Date.now() <= deadline) {
    const rows = (await listSensorAlerts(token)).filter((row) => isOwnAlert(row, ruleId));
    const fresh = rows.find((row) => !beforeIds.has(row.id));
    if (fresh) return fresh;
    if (Date.now() + 400 > deadline) break;
    await sleep(400);
  }
  throw new Error(
    `告警列表里没有棚区 ${DEMO_SHED} 传感器 ${DEMO_SENSOR} 的新温度过高告警。` +
      `确认规则「${RULE_NAME}」已启用，阈值 ${THRESHOLD_FIRE}。`,
  );
}

async function readFreshDetail(token, ruleId, beforeIds) {
  const listed = assertFireRow(await findFreshAlert(token, ruleId, beforeIds), ruleId);
  const detail = assertFireRow(
    await api(token, 'GET', `/alerts/${encodeURIComponent(listed.id)}`),
    ruleId,
  );
  const openRow = (await listByStatus(token, 'open')).find((item) => item.id === detail.id);
  assertFireRow(openRow, ruleId);
  return detail;
}

export async function sendAlertRuleConfigDemo({ now = new Date() } = {}) {
  const quietBody = buildSample(now, 'quiet');
  const fireBody = buildSample(now, 'fire');
  const raisedBody = buildSample(now, 'raised');
  const againBody = buildSample(now, 'again');
  for (const body of [quietBody, fireBody, raisedBody, againBody]) validateSample(body, now);

  const token = await login();
  const rule = await ensureRule(token);
  if (!rule.id) throw new Error('阈值规则没有 id');
  await patchRule(token, rule.id, THRESHOLD_QUIET);
  await confirmRule(token, rule.id, THRESHOLD_QUIET);
  const closedBefore = await closeSensorAlerts(token);
  const quietReading = await postEnvironment(quietBody);
  await assertNoSensorAlert(
    token,
    `阈值 ${THRESHOLD_QUIET} 时温度 ${SAMPLE_TEMPERATURE} 仍产生了告警`,
  );

  await patchRule(token, rule.id, THRESHOLD_FIRE);
  await confirmRule(token, rule.id, THRESHOLD_FIRE);
  const beforeFire = new Set((await listSensorAlerts(token)).map((row) => row.id));
  await postEnvironment(fireBody);
  await readFreshDetail(token, rule.id, beforeFire);

  await patchRule(token, rule.id, THRESHOLD_QUIET);
  await confirmRule(token, rule.id, THRESHOLD_QUIET);
  const closedBeforeRaise = await closeSensorAlerts(token);
  const raisedReading = await postEnvironment(raisedBody);
  await assertNoSensorAlert(
    token,
    `把阈值改回 ${THRESHOLD_QUIET} 后温度 ${SAMPLE_TEMPERATURE} 仍产生了告警`,
  );

  await patchRule(token, rule.id, THRESHOLD_FIRE);
  await confirmRule(token, rule.id, THRESHOLD_FIRE);
  const beforeAgain = new Set((await listSensorAlerts(token)).map((row) => row.id));
  const againReading = await postEnvironment(againBody);
  const detail = await readFreshDetail(token, rule.id, beforeAgain);
  return {
    closedBefore,
    closedBeforeRaise,
    quietReadingId: quietReading.id,
    raisedReadingId: raisedReading.id,
    againReadingId: againReading.id,
    detail,
  };
}

function usage() {
  return `用法:
  node scripts/demo-alert-rule-config.mjs

把规则「${RULE_NAME}」的阈值在 ${THRESHOLD_QUIET} 与 ${THRESHOLD_FIRE} 之间改动，再 POST 温度 ${SAMPLE_TEMPERATURE}℃ 的环境遥测。步骤见 docs/DEMO_ALERT_RULE_CONFIG.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await sendAlertRuleConfigDemo();
    process.stdout.write(`${formatRuleConfigProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
