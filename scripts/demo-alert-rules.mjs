#!/usr/bin/env node
/**
 * 保证阈值规则「演示规则列表」在列表和详情里都能读到。
 * 不改种子规则「温度过高」。不发识别，不发环境，不改其他规则。
 */
import { pathToFileURL } from 'node:url';
import { apiBase } from './lib/ingest-wire.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';

export const RULE_NAME = '演示规则列表';
export const RULE_METRIC = 'humidity_high';
export const RULE_METRIC_LABEL = '湿度过高';
export const RULE_THRESHOLD = 95;
export const RULE_LEVEL = 'info';
export const RULE_LEVEL_LABEL = '提示';
export const RULE_SHED = 'S01';
export const RULE_WINDOW = 360;
export const SEED_RULE_NAME = '温度过高';
export const SEED_THRESHOLD = 28;

export function sameNumber(left, right) {
  const a = Number(left);
  const b = Number(right);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-6;
}

export function ruleBody() {
  return {
    name: RULE_NAME,
    metric: RULE_METRIC,
    threshold: RULE_THRESHOLD,
    level: RULE_LEVEL,
    shedCode: RULE_SHED,
    windowMinutes: RULE_WINDOW,
  };
}

export function assertSeedUntouched(rule) {
  if (!rule) throw new Error(`没有种子规则「${SEED_RULE_NAME}」。这条演示不新建它。`);
  if (rule.metric !== 'temperature_high') {
    throw new Error(`种子规则「${SEED_RULE_NAME}」的指标是 ${rule.metric}，应为温度过高。这条演示不改它。`);
  }
  if (!sameNumber(rule.threshold, SEED_THRESHOLD)) {
    throw new Error(
      `种子规则「${SEED_RULE_NAME}」阈值是 ${rule.threshold}，应为 ${SEED_THRESHOLD}。这条演示不改它。`,
    );
  }
  if (rule.enabled !== true) {
    throw new Error(`种子规则「${SEED_RULE_NAME}」没有启用。这条演示不改它。`);
  }
  return rule;
}

export function assertRuleFields(rule, label = '阈值规则') {
  const missing = [];
  if (rule?.name !== RULE_NAME) missing.push('名称');
  if (rule?.metric !== RULE_METRIC) missing.push('指标');
  if (rule?.shedCode !== RULE_SHED) missing.push('棚区');
  if (!sameNumber(rule?.threshold, RULE_THRESHOLD)) missing.push('阈值');
  if (rule?.level !== RULE_LEVEL) missing.push('等级');
  if (Number(rule?.windowMinutes) !== RULE_WINDOW) missing.push('窗口分钟');
  if (rule?.enabled !== true) missing.push('启用');
  if (!rule?.id) missing.push('id');
  if (missing.length) throw new Error(`${label}缺少${missing.join('、')}`);
  return rule;
}

export function assertDetailMatches(detail, listed) {
  assertRuleFields(detail, '阈值规则详情');
  assertRuleFields(listed, '阈值规则列表');
  if (detail.id !== listed.id) throw new Error('详情和列表不是同一条规则。');
  if (detail.name !== listed.name || detail.metric !== listed.metric) {
    throw new Error('详情的名称或指标和列表不一致。');
  }
  if (detail.shedCode !== listed.shedCode) throw new Error('详情的棚区和列表不一致。');
  if (!sameNumber(detail.threshold, listed.threshold)) throw new Error('详情的阈值和列表不一致。');
  if (detail.level !== listed.level) throw new Error('详情的等级和列表不一致。');
  if (Number(detail.windowMinutes) !== Number(listed.windowMinutes)) {
    throw new Error('详情的窗口分钟和列表不一致。');
  }
  if (detail.enabled !== listed.enabled) throw new Error('详情的启用和列表不一致。');
  return detail;
}

export function rulesListUrl(id, webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const params = new URLSearchParams({ ruleId: id });
  return `${origin}/alert-rules?${params.toString()}`;
}

export function ruleDetailUrl(id, webOrigin = webOriginFromEnv()) {
  return `${String(webOrigin).replace(/\/$/, '')}/alert-rules/${encodeURIComponent(id)}`;
}

export function formatAlertRulesProof({
  action,
  rule,
  webOrigin = webOriginFromEnv(),
}) {
  const lines = [
    `阈值规则: ${action}`,
    `id: ${rule.id}`,
    `名称: ${rule.name}`,
    `指标: ${RULE_METRIC_LABEL}`,
    `棚区: ${rule.shedCode}`,
    `阈值: ${rule.threshold}`,
    `等级: ${RULE_LEVEL_LABEL}`,
    `窗口分钟: ${rule.windowMinutes}`,
    '启用: 是',
    '登录: admin / Admin@123456',
    `阈值规则列表: ${rulesListUrl(rule.id, webOrigin)}`,
    `阈值规则详情: ${ruleDetailUrl(rule.id, webOrigin)}`,
  ];
  return lines.join('\n');
}

function messageText(payload) {
  const message = payload?.message ?? payload?.error;
  if (Array.isArray(message)) return message.join('；');
  if (typeof message === 'string') return message;
  return '';
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

function aligned(rule) {
  return (
    rule.metric === RULE_METRIC &&
    rule.shedCode === RULE_SHED &&
    sameNumber(rule.threshold, RULE_THRESHOLD) &&
    rule.level === RULE_LEVEL &&
    Number(rule.windowMinutes) === RULE_WINDOW &&
    rule.enabled === true
  );
}

async function readRules(token) {
  const body = await api(token, 'GET', '/alert-rules');
  if (!Array.isArray(body)) throw new Error('阈值规则列表不是数组');
  assertSeedUntouched(body.find((rule) => rule.name === SEED_RULE_NAME));
  return body;
}

export async function sendAlertRulesDemo() {
  const token = await login();
  const before = await readRules(token);
  const found = before.find((rule) => rule.name === RULE_NAME);
  let saved;
  let action;
  if (!found) {
    saved = await api(token, 'POST', '/alert-rules', ruleBody());
    action = '新建';
  } else if (found.metric !== RULE_METRIC) {
    throw new Error(`规则「${RULE_NAME}」的指标是 ${found.metric}，应为 ${RULE_METRIC}。这条演示不另建一行。`);
  } else if (found.shedCode !== RULE_SHED) {
    throw new Error(`规则「${RULE_NAME}」的棚区是 ${found.shedCode || '全场'}，应为 ${RULE_SHED}。这条演示不另建一行。`);
  } else if (!aligned(found)) {
    saved = await api(token, 'PATCH', `/alert-rules/${encodeURIComponent(found.id)}`, {
      threshold: RULE_THRESHOLD,
      level: RULE_LEVEL,
      windowMinutes: RULE_WINDOW,
      enabled: true,
    });
    action = '已改';
  } else {
    saved = found;
    action = '已有';
  }
  assertRuleFields(saved);
  const detail = await api(token, 'GET', `/alert-rules/${encodeURIComponent(saved.id)}`);
  const after = await readRules(token);
  const listed = after.find((rule) => rule.id === saved.id);
  if (!listed) throw new Error('阈值规则列表里没有这条规则。');
  assertDetailMatches(detail, listed);
  const others = after.filter((rule) => rule.id !== saved.id && rule.name !== RULE_NAME);
  const beforeOthers = before.filter((rule) => rule.id !== saved.id && rule.name !== RULE_NAME);
  if (others.length !== beforeOthers.length) {
    throw new Error('阈值规则列表的其他行数变了。');
  }
  return { action, rule: listed, detail };
}

function usage() {
  return `用法:
  node scripts/demo-alert-rules.mjs

保证规则「${RULE_NAME}」在列表和详情里。步骤见 docs/DEMO_ALERT_RULES.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const sent = await sendAlertRulesDemo();
    process.stdout.write(`${formatAlertRulesProof(sent)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
