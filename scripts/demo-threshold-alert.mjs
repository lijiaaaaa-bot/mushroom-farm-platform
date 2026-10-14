#!/usr/bin/env node
/**
 * 把「演示二氧化碳过高」的阈值从 1500 改成 1000，再 POST 一条 CO₂ 1200 的识别。
 * 1200 高于改后的阈值，低于种子规则「二氧化碳过高」的 2000。
 * 告警列表里出现这条 CO₂过高告警。样例文件与种子规则不改。
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  apiBase,
  ingestRecognitionUrl,
  ingestToken,
  postJson,
  repoRoot,
} from './lib/ingest-wire.mjs';
import {
  buildDemoPayload,
  validateDemoPayload,
  webOriginFromEnv,
} from './demo-one-http-recognition.mjs';

const require = createRequire(import.meta.url);

export const RULE_NAME = '演示二氧化碳过高';
export const SEED_CO2_RULE_NAME = '二氧化碳过高';
export const RULE_METRIC = 'co2_high';
export const THRESHOLD_CAMERA = 'CAM-THRESH-01';
export const THRESHOLD_SHED = 'S01';
export const CO2_SAMPLE = 1200;
export const THRESHOLD_BEFORE = 1500;
export const THRESHOLD_AFTER = 1000;
export const SEED_CO2_THRESHOLD = 2000;
export const THRESHOLD_TITLE = 'CO₂过高告警';
export const CLOSE_NOTE = '改阈值前关闭旧告警';

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function sameNumber(left, right) {
  const a = Number(left);
  const b = Number(right);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-6;
}

export function buildThresholdRecognition(now = new Date()) {
  const body = buildDemoPayload(now);
  body.cameraCode = THRESHOLD_CAMERA;
  body.shedCode = THRESHOLD_SHED;
  body.co2 = CO2_SAMPLE;
  body.idempotencyKey = `demo-thresh-${now.getTime()}`;
  return body;
}

export function isOwnCo2Alert(row, ruleId) {
  return Boolean(
    row &&
      row.ruleId === ruleId &&
      row.shedCode === THRESHOLD_SHED &&
      row.cameraCode === THRESHOLD_CAMERA &&
      row.metric === RULE_METRIC &&
      (row.status === 'open' || row.status === 'acked'),
  );
}

function messageText(payload) {
  const message = payload?.message ?? payload?.error;
  if (Array.isArray(message)) return message.join('；');
  if (typeof message === 'string') return message;
  return '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function readJson(response) {
  return response.json().catch(() => ({}));
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
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(`${method} ${path} 失败 ${response.status} ${messageText(payload) || JSON.stringify(payload)}`);
  }
  return payload;
}

async function listRules(token) {
  const body = await api(token, 'GET', '/alert-rules');
  if (!Array.isArray(body)) throw new Error('阈值规则列表不是数组');
  return body;
}

function rejectText(responseBody) {
  const inner =
    responseBody && typeof responseBody.message === 'object' ? responseBody.message : responseBody;
  const errors = inner?.errors || responseBody?.errors;
  const code = inner?.code || responseBody?.code;
  const list = Array.isArray(errors) ? errors.join('；') : JSON.stringify(responseBody);
  return code ? `${code} ${list}` : list;
}

async function postRecognition(body) {
  let posted;
  try {
    posted = await postJson(ingestRecognitionUrl(), JSON.stringify(body), {
      'content-type': 'application/json',
      'x-ingest-token': ingestToken(),
    });
  } catch (error) {
    throw new Error(
      `API 连不上（${ingestRecognitionUrl()}）。先执行 make up、make migrate、make api。${error.message}`,
    );
  }
  const payload = posted.responseBody;
  const accepted = payload?.accepted === true || payload?.message?.accepted === true;
  const id = payload?.id || payload?.message?.id;
  if (posted.responseStatus < 200 || posted.responseStatus >= 300 || !accepted || !id) {
    throw new Error(`接入拒绝 ${posted.responseStatus} ${rejectText(payload)}`);
  }
  return { id, duplicate: Boolean(payload?.duplicate || payload?.message?.duplicate) };
}

async function listByStatus(token, status) {
  const path =
    `/alerts?shedCode=${encodeURIComponent(THRESHOLD_SHED)}` +
    `&status=${encodeURIComponent(status)}&pageSize=100`;
  const body = await api(token, 'GET', path);
  return Array.isArray(body.items) ? body.items : [];
}

async function listOwnAlerts(token, ruleId) {
  const [open, acked] = await Promise.all([
    listByStatus(token, 'open'),
    listByStatus(token, 'acked'),
  ]);
  const byId = new Map();
  for (const row of [...open, ...acked]) {
    if (isOwnCo2Alert(row, ruleId)) byId.set(row.id, row);
  }
  return [...byId.values()];
}

export function assertThresholdListRow(row, ruleId) {
  const missing = [];
  if (row?.ruleId !== ruleId) missing.push('规则');
  if (row?.title !== THRESHOLD_TITLE) missing.push('标题');
  if (row?.shedCode !== THRESHOLD_SHED) missing.push('棚区');
  if (row?.cameraCode !== THRESHOLD_CAMERA) missing.push('摄像头');
  if (row?.level !== 'warning') missing.push('级别');
  if (row?.status !== 'open') missing.push('状态');
  if (row?.metric !== RULE_METRIC) missing.push('指标');
  if (!sameNumber(row?.metricValue, CO2_SAMPLE)) missing.push('当前值');
  if (!sameNumber(row?.threshold, THRESHOLD_AFTER)) missing.push('阈值');
  const message = String(row?.message || '');
  if (!message.includes(`棚区 ${THRESHOLD_SHED}`)) missing.push('说明里的棚区');
  if (!message.includes(`摄像头 ${THRESHOLD_CAMERA}`)) missing.push('说明里的摄像头');
  if (!message.includes('CO₂过高')) missing.push('说明里的指标');
  if (!message.includes(String(CO2_SAMPLE))) missing.push('说明里的当前值');
  if (!message.includes(`阈值 ${THRESHOLD_AFTER}`)) missing.push('说明里的阈值');
  if (missing.length) throw new Error(`告警列表里的这一条缺少${missing.join('、')}`);
  return row;
}

async function ensureRule(token) {
  const rules = await listRules(token);
  const found = rules.find((rule) => rule.name === RULE_NAME);
  if (!found) {
    return api(token, 'POST', '/alert-rules', {
      name: RULE_NAME,
      metric: RULE_METRIC,
      threshold: THRESHOLD_BEFORE,
      level: 'warning',
      shedCode: THRESHOLD_SHED,
      windowMinutes: 720,
    });
  }
  if (found.metric !== RULE_METRIC) {
    throw new Error(`规则「${RULE_NAME}」的指标是 ${found.metric}，这条演示要改 ${RULE_METRIC}。`);
  }
  if (found.shedCode && found.shedCode !== THRESHOLD_SHED) {
    throw new Error(`规则「${RULE_NAME}」限定棚区 ${found.shedCode}，这条识别在 ${THRESHOLD_SHED}。`);
  }
  return found;
}

async function patchThreshold(token, id, threshold, extra = {}) {
  const saved = await api(token, 'PATCH', `/alert-rules/${encodeURIComponent(id)}`, {
    threshold,
    ...extra,
  });
  if (!sameNumber(saved.threshold, threshold)) {
    throw new Error(`保存后的阈值是 ${saved.threshold}，要写成 ${threshold}。`);
  }
  return saved;
}

async function closeOwnAlerts(token, ruleId) {
  const open = await listOwnAlerts(token, ruleId);
  for (const row of open) {
    await api(token, 'POST', `/alerts/${encodeURIComponent(row.id)}/close`, { note: CLOSE_NOTE });
  }
  const left = await listOwnAlerts(token, ruleId);
  if (left.length) {
    throw new Error(`摄像头 ${THRESHOLD_CAMERA} 上还有未闭合的二氧化碳告警，新阈值不会另建一条。`);
  }
  return open.length;
}

async function confirmRule(token, id) {
  const rules = await listRules(token);
  const rule = rules.find((item) => item.id === id);
  if (!rule) throw new Error('阈值规则列表里没有刚改过的规则');
  if (!sameNumber(rule.threshold, THRESHOLD_AFTER)) {
    throw new Error(`规则列表里的阈值是 ${rule.threshold}，应为 ${THRESHOLD_AFTER}。`);
  }
  if (rule.enabled !== true) throw new Error(`规则「${RULE_NAME}」没有启用。`);
  const seed = rules.find((item) => item.name === SEED_CO2_RULE_NAME);
  if (seed && !sameNumber(seed.threshold, SEED_CO2_THRESHOLD)) {
    throw new Error(
      `种子规则「${SEED_CO2_RULE_NAME}」阈值变成了 ${seed.threshold}，应仍是 ${SEED_CO2_THRESHOLD}。`,
    );
  }
  return rule;
}

async function findFreshAlert(token, ruleId, beforeIds) {
  const deadline = Date.now() + 3_000;
  while (Date.now() <= deadline) {
    const rows = await listOwnAlerts(token, ruleId);
    const fresh = rows.find((row) => !beforeIds.has(row.id));
    if (fresh) return fresh;
    if (Date.now() + 400 > deadline) break;
    await sleep(400);
  }
  throw new Error(
    `告警列表里没有棚区 ${THRESHOLD_SHED} 摄像头 ${THRESHOLD_CAMERA} 的新二氧化碳告警。` +
      `确认规则「${RULE_NAME}」已启用，阈值 ${THRESHOLD_AFTER}。`,
  );
}

export function thresholdAlertListUrl(id, webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const params = new URLSearchParams({
    shedCode: THRESHOLD_SHED,
    alertId: id,
  });
  return `${origin}/alerts?${params.toString()}`;
}

export function thresholdRulesUrl(webOrigin = webOriginFromEnv()) {
  return `${String(webOrigin).replace(/\/$/, '')}/alert-rules`;
}

export function formatThresholdProof({
  recognitionId,
  closedCount,
  detail,
  webOrigin = webOriginFromEnv(),
}) {
  const labels = contracts();
  const lines = [
    `规则: ${RULE_NAME}`,
    `指标: ${labels.ALERT_METRIC_LABEL[RULE_METRIC] || RULE_METRIC}`,
    `阈值: ${THRESHOLD_BEFORE} → ${THRESHOLD_AFTER}`,
    `关闭旧告警: ${closedCount} 条`,
    '发了 1 条识别',
    `识别 id: ${recognitionId}`,
    `棚区: ${THRESHOLD_SHED}`,
    `摄像头编号: ${THRESHOLD_CAMERA}`,
    `CO₂: ${CO2_SAMPLE}`,
    '告警: 新建',
    `告警 id: ${detail.id}`,
    `标题: ${detail.title}`,
    `说明: ${detail.message}`,
    `级别: ${labels.ALERT_LEVEL_LABEL[detail.level] || detail.level}`,
    `状态: ${labels.ALERT_STATUS_LABEL[detail.status] || detail.status}`,
    `当前值: ${detail.metricValue}`,
    `阈值: ${detail.threshold}`,
    '列表里有这一条: 是',
    '登录: admin / Admin@123456',
    `阈值规则: ${thresholdRulesUrl(webOrigin)}`,
    `告警列表: ${thresholdAlertListUrl(detail.id, webOrigin)}`,
  ];
  return lines.join('\n');
}

export async function sendThresholdAlertDemo({ now = new Date() } = {}) {
  const body = buildThresholdRecognition(now);
  validateDemoPayload(body, now);
  if (body.cameraCode !== THRESHOLD_CAMERA) {
    throw new Error(`这次识别的摄像头编号是 ${body.cameraCode}，应为 ${THRESHOLD_CAMERA}`);
  }
  if (!sameNumber(body.co2, CO2_SAMPLE)) {
    throw new Error(`这次识别的 CO₂ 是 ${body.co2}，应为 ${CO2_SAMPLE}`);
  }
  if (body.temperature !== 22.5) {
    throw new Error(`这次识别的温度是 ${body.temperature}，应保持样例里的 22.5`);
  }
  const token = await login();
  const rule = await ensureRule(token);
  if (!rule.id) throw new Error('阈值规则没有 id');
  await patchThreshold(token, rule.id, THRESHOLD_BEFORE);
  const closedCount = await closeOwnAlerts(token, rule.id);
  await patchThreshold(token, rule.id, THRESHOLD_AFTER, { enabled: true });
  await confirmRule(token, rule.id);
  const beforeIds = new Set((await listOwnAlerts(token, rule.id)).map((row) => row.id));
  const posted = await postRecognition(body);
  const listed = assertThresholdListRow(await findFreshAlert(token, rule.id, beforeIds), rule.id);
  const detail = await api(token, 'GET', `/alerts/${encodeURIComponent(listed.id)}`);
  assertThresholdListRow(detail, rule.id);
  return {
    recognitionId: posted.id,
    closedCount,
    detail: listed,
    body,
  };
}

function usage() {
  return `用法:
  node scripts/demo-threshold-alert.mjs

把规则「${RULE_NAME}」的阈值从 ${THRESHOLD_BEFORE} 改成 ${THRESHOLD_AFTER}，再 POST 一次 CO₂ ${CO2_SAMPLE} 的识别。步骤见 docs/DEMO_THRESHOLD_ALERT.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await sendThresholdAlertDemo();
    process.stdout.write(`${formatThresholdProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
