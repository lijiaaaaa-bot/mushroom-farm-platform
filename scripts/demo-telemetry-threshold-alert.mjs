#!/usr/bin/env node
/**
 * 发一条超过种子规则「温度过高」（阈值 28）的环境遥测。
 * 告警列表出现这条未闭合告警，详情能读到标题、当前值、阈值和状态。
 * 不改种子规则，不发识别，不改 environment.demo-latest.json。
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  apiBase,
  environmentTopic,
  ingestToken,
  postJson,
  publishMqtt,
  readFixture,
  repoRoot,
} from './lib/ingest-wire.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';

const require = createRequire(import.meta.url);

export const DEMO_FIXTURE = 'environment.demo-telemetry-threshold.json';
export const DEMO_SENSOR = 'SENSOR-TELEM-01';
export const DEMO_SHED = 'S01';
export const DEMO_TEMPERATURE = 32;
export const DEMO_HUMIDITY = 88;
export const DEMO_CO2 = 900;
export const DEMO_MOISTURE = 70;
export const SEED_RULE_NAME = '温度过高';
export const SEED_METRIC = 'temperature_high';
export const SEED_THRESHOLD = 28;
export const ALERT_TITLE = '温度过高告警';
export const CLOSE_NOTE = '遥测样例重发前关闭';

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function buildDemoPayload(now = new Date()) {
  const fixture = readFixture(DEMO_FIXTURE);
  return {
    ...fixture.body,
    observedAt: now.toISOString(),
    idempotencyKey: `demo-telemetry-threshold-${now.getTime()}`,
  };
}

export function validateDemoPayload(body, now = new Date()) {
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
  if (value.temperature !== DEMO_TEMPERATURE) {
    throw new Error(`温度是 ${value.temperature}，应为 ${DEMO_TEMPERATURE}`);
  }
  if (!(value.temperature > SEED_THRESHOLD)) {
    throw new Error(`温度 ${value.temperature} 没有超过种子阈值 ${SEED_THRESHOLD}`);
  }
  if (value.humidity !== DEMO_HUMIDITY || value.humidity <= 70 || value.humidity >= 98) {
    throw new Error(`湿度 ${value.humidity} 会碰到湿度种子规则，这条演示只要温度告警`);
  }
  if (value.co2 !== DEMO_CO2 || value.co2 > 2000) {
    throw new Error(`CO₂ ${value.co2} 会碰到二氧化碳种子规则，这条演示只要温度告警`);
  }
  if (value.substrateMoisture !== DEMO_MOISTURE || value.substrateMoisture < 50) {
    throw new Error(`基质含水率 ${value.substrateMoisture} 会碰到基质种子规则，这条演示只要温度告警`);
  }
  return value;
}

export function isOwnAlert(row) {
  return Boolean(
    row &&
      row.shedCode === DEMO_SHED &&
      row.sensorCode === DEMO_SENSOR &&
      row.metric === SEED_METRIC &&
      (row.status === 'open' || row.status === 'acked'),
  );
}

function sameNumber(left, right) {
  return Number.isFinite(Number(left)) && Math.abs(Number(left) - Number(right)) < 1e-6;
}

export function assertSeedRule(rule) {
  if (!rule) throw new Error(`没有种子规则「${SEED_RULE_NAME}」。`);
  if (rule.metric !== SEED_METRIC) {
    throw new Error(`种子规则「${SEED_RULE_NAME}」的指标是 ${rule.metric}，应为 ${SEED_METRIC}。`);
  }
  if (!sameNumber(rule.threshold, SEED_THRESHOLD)) {
    throw new Error(`种子规则「${SEED_RULE_NAME}」阈值是 ${rule.threshold}，应为 ${SEED_THRESHOLD}。这条演示不改它。`);
  }
  if (rule.enabled !== true) throw new Error(`种子规则「${SEED_RULE_NAME}」没有启用。`);
  if (rule.shedCode && rule.shedCode !== DEMO_SHED) {
    throw new Error(`种子规则「${SEED_RULE_NAME}」限定棚区 ${rule.shedCode}，样例在 ${DEMO_SHED}。`);
  }
  return rule;
}

export function assertAlertDetail(detail) {
  const missing = [];
  if (detail?.title !== ALERT_TITLE) missing.push('标题');
  if (detail?.shedCode !== DEMO_SHED) missing.push('棚区');
  if (detail?.sensorCode !== DEMO_SENSOR) missing.push('传感器');
  if (detail?.cameraCode) missing.push('摄像头应为空');
  if (detail?.level !== 'severe') missing.push('级别');
  if (detail?.status !== 'open') missing.push('状态');
  if (detail?.metric !== SEED_METRIC) missing.push('指标');
  if (!sameNumber(detail?.metricValue, DEMO_TEMPERATURE)) missing.push('当前值');
  if (!sameNumber(detail?.threshold, SEED_THRESHOLD)) missing.push('阈值');
  if (!detail?.createdAt) missing.push('时间');
  const message = String(detail?.message || '');
  if (!message.includes(`棚区 ${DEMO_SHED}`)) missing.push('说明里的棚区');
  if (!message.includes(`传感器 ${DEMO_SENSOR}`)) missing.push('说明里的传感器');
  if (!message.includes('温度过高')) missing.push('说明里的指标');
  if (!message.includes(String(DEMO_TEMPERATURE))) missing.push('说明里的当前值');
  if (!message.includes(`阈值 ${SEED_THRESHOLD}`)) missing.push('说明里的阈值');
  if (missing.length) throw new Error(`告警详情缺少${missing.join('、')}`);
  return detail;
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

export function formatDemoProof({
  channel,
  readingId,
  detail,
  topic,
  webOrigin = webOriginFromEnv(),
}) {
  const labels = contracts();
  const lines = [
    '发了 1 条环境遥测',
    `通道: ${channel}`,
    `读数 id: ${readingId}`,
    `棚区: ${DEMO_SHED}`,
    `传感器: ${DEMO_SENSOR}`,
    `温度: ${DEMO_TEMPERATURE}℃`,
    `种子规则: ${SEED_RULE_NAME}`,
    `阈值: ${SEED_THRESHOLD}`,
    `告警 id: ${detail.id}`,
    `标题: ${detail.title}`,
    `说明: ${detail.message}`,
    `级别: ${labels.ALERT_LEVEL_LABEL[detail.level] || detail.level}`,
    `状态: ${labels.ALERT_STATUS_LABEL[detail.status] || detail.status}`,
    `当前值: ${detail.metricValue}`,
    `阈值读回: ${detail.threshold}`,
    '登录: admin / Admin@123456',
    `告警列表: ${alertListUrl(detail.id, webOrigin)}`,
    `告警详情: ${alertDetailUrl(detail.id, webOrigin)}`,
  ];
  if (topic) lines.push(`主题: ${topic}`);
  return lines.join('\n');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const response = await fetch(`${apiBase()}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${method} ${path} 失败 ${response.status} ${messageText(payload)}`);
  }
  return payload;
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
    if (row?.sensorCode === DEMO_SENSOR) byId.set(row.id, row);
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

async function findFreshAlert(token, beforeIds) {
  const deadline = Date.now() + 8_000;
  while (Date.now() <= deadline) {
    const rows = (await listSensorAlerts(token)).filter(isOwnAlert);
    const fresh = rows.find((row) => !beforeIds.has(row.id));
    if (fresh) return fresh;
    if (Date.now() + 400 > deadline) break;
    await sleep(400);
  }
  throw new Error(
    `告警列表里没有棚区 ${DEMO_SHED} 传感器 ${DEMO_SENSOR} 的新温度过高告警。` +
      `确认种子规则「${SEED_RULE_NAME}」已启用，阈值 ${SEED_THRESHOLD}。`,
  );
}

export function resolveChannel(argv) {
  const index = argv.indexOf('--channel');
  const channel = index === -1 ? 'http' : argv[index + 1];
  if (channel !== 'http' && channel !== 'mqtt') {
    throw new Error('channel 只能是 http 或 mqtt');
  }
  return channel;
}

export async function sendDemo({
  channel = 'http',
  now = new Date(),
  publish = publishMqtt,
} = {}) {
  if (channel !== 'http' && channel !== 'mqtt') {
    throw new Error('channel 只能是 http 或 mqtt');
  }
  const body = buildDemoPayload(now);
  const value = validateDemoPayload(body, now);
  const token = await login();
  const rules = await api(token, 'GET', '/alert-rules');
  if (!Array.isArray(rules)) throw new Error('阈值规则列表不是数组');
  assertSeedRule(rules.find((rule) => rule.name === SEED_RULE_NAME));
  await closeSensorAlerts(token);
  const beforeIds = new Set((await listSensorAlerts(token)).map((row) => row.id));
  let topic;
  let readingId;
  if (channel === 'mqtt') {
    topic = environmentTopic(value.shedCode, value.sensorCode);
    await publish(topic, JSON.stringify(body));
    readingId = '(mqtt)';
  } else {
    readingId = (await postEnvironment(body)).id;
  }
  const row = await findFreshAlert(token, beforeIds);
  const detail = assertAlertDetail(await api(token, 'GET', `/alerts/${encodeURIComponent(row.id)}`));
  const listed = (await listByStatus(token, 'open')).find((item) => item.id === detail.id);
  assertAlertDetail(listed);
  const extras = (await listSensorAlerts(token)).filter((item) => item.metric !== SEED_METRIC);
  if (extras.length) {
    throw new Error(
      `传感器 ${DEMO_SENSOR} 还打开了 ${extras.map((item) => item.metric).join('、')}。这条样例只应触发温度过高。`,
    );
  }
  return { channel, readingId, detail, topic, body };
}

function usage() {
  return `用法:
  node scripts/demo-telemetry-threshold-alert.mjs
  node scripts/demo-telemetry-threshold-alert.mjs --channel mqtt

默认 HTTP POST /api/v1/ingest/environment。样例 ${DEMO_FIXTURE}。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const channel = resolveChannel(process.argv);
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
