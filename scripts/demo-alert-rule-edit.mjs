#!/usr/bin/env node
/**
 * 新建或沿用「演示规则新建」，再改阈值、等级、窗口和启用。
 * 改前和改后都读列表与详情，两处必须一致。
 * 不改种子规则「温度过高」，不改其他规则。不发识别，不发环境。
 */
import { pathToFileURL } from 'node:url';
import { apiBase } from './lib/ingest-wire.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';
import {
  SEED_RULE_NAME,
  assertSeedUntouched,
  ruleDetailUrl,
  rulesListUrl,
  sameNumber,
} from './demo-alert-rules.mjs';

export const RULE_NAME = '演示规则新建';
export const RULE_METRIC = 'humidity_low';
export const RULE_METRIC_LABEL = '湿度过低';
export const BEFORE_THRESHOLD = 40;
export const BEFORE_LEVEL = 'info';
export const BEFORE_LEVEL_LABEL = '提示';
export const BEFORE_WINDOW = 180;
export const AFTER_THRESHOLD = 55;
export const AFTER_LEVEL = 'warning';
export const AFTER_LEVEL_LABEL = '一般';
export const AFTER_WINDOW = 90;

const LEVEL_LABEL = {
  info: '提示',
  warning: '一般',
  severe: '严重',
};

export function beforeBody() {
  return {
    name: RULE_NAME,
    metric: RULE_METRIC,
    threshold: BEFORE_THRESHOLD,
    level: BEFORE_LEVEL,
    windowMinutes: BEFORE_WINDOW,
  };
}

export function afterPatch() {
  return {
    threshold: AFTER_THRESHOLD,
    level: AFTER_LEVEL,
    windowMinutes: AFTER_WINDOW,
    enabled: false,
  };
}

export function shedOf(rule) {
  const code = typeof rule?.shedCode === 'string' ? rule.shedCode.trim() : '';
  return code || null;
}

export function isBeforeState(rule) {
  return (
    rule?.name === RULE_NAME &&
    rule?.metric === RULE_METRIC &&
    shedOf(rule) === null &&
    sameNumber(rule?.threshold, BEFORE_THRESHOLD) &&
    rule?.level === BEFORE_LEVEL &&
    Number(rule?.windowMinutes) === BEFORE_WINDOW &&
    rule?.enabled === true
  );
}

export function isAfterState(rule) {
  return (
    rule?.name === RULE_NAME &&
    rule?.metric === RULE_METRIC &&
    shedOf(rule) === null &&
    sameNumber(rule?.threshold, AFTER_THRESHOLD) &&
    rule?.level === AFTER_LEVEL &&
    Number(rule?.windowMinutes) === AFTER_WINDOW &&
    rule?.enabled === false
  );
}

function levelLabel(level) {
  return LEVEL_LABEL[level] || level || '空';
}

function enabledLabel(enabled) {
  return enabled === true ? '是' : '否';
}

export function formatAlertRuleEditProof({
  action,
  before,
  after,
  webOrigin = webOriginFromEnv(),
}) {
  const lines = [
    `阈值规则: ${action}`,
    `id: ${after.id}`,
    `名称: ${after.name}`,
    `指标: ${RULE_METRIC_LABEL}`,
    '棚区: 全场',
    `改前阈值: ${before.threshold}`,
    `改前等级: ${levelLabel(before.level)}`,
    `改前窗口分钟: ${before.windowMinutes}`,
    `改前启用: ${enabledLabel(before.enabled)}`,
    `改后阈值: ${after.threshold}`,
    `改后等级: ${levelLabel(after.level)}`,
    `改后窗口分钟: ${after.windowMinutes}`,
    `改后启用: ${enabledLabel(after.enabled)}`,
    `对照: 阈值 ${before.threshold} → ${after.threshold}；等级 ${levelLabel(before.level)} → ${levelLabel(after.level)}；窗口分钟 ${before.windowMinutes} → ${after.windowMinutes}；启用 ${enabledLabel(before.enabled)} → ${enabledLabel(after.enabled)}`,
    '登录: admin / Admin@123456',
    `改后列表: ${rulesListUrl(after.id, webOrigin)}`,
    `改后详情: ${ruleDetailUrl(after.id, webOrigin)}`,
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

function fingerprint(rule) {
  return {
    id: rule.id,
    name: rule.name,
    metric: rule.metric,
    threshold: Number(rule.threshold),
    level: rule.level,
    windowMinutes: Number(rule.windowMinutes),
    enabled: rule.enabled,
    shedCode: shedOf(rule),
  };
}

function sameFingerprint(left, right) {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.metric === right.metric &&
    sameNumber(left.threshold, right.threshold) &&
    left.level === right.level &&
    left.windowMinutes === right.windowMinutes &&
    left.enabled === right.enabled &&
    left.shedCode === right.shedCode
  );
}

function othersOf(rules) {
  return rules.filter((rule) => rule.name !== RULE_NAME).map(fingerprint);
}

function assertOthersUntouched(beforeRules, afterRules) {
  const before = othersOf(beforeRules);
  const after = othersOf(afterRules);
  if (before.length !== after.length) {
    throw new Error('其他阈值规则的行数变了。这条演示只改「演示规则新建」。');
  }
  for (const row of before) {
    const found = after.find((item) => item.id === row.id);
    if (!found || !sameFingerprint(row, found)) {
      throw new Error(`其他规则「${row.name}」被改了。这条演示只改「演示规则新建」。`);
    }
  }
}

function findDemo(rules) {
  const matches = rules.filter((rule) => rule.name === RULE_NAME);
  if (matches.length > 1) {
    throw new Error(`有 ${matches.length} 条「${RULE_NAME}」。这条演示不另建一行。`);
  }
  return matches[0] ?? null;
}

function assertEditable(rule) {
  if (rule.metric !== RULE_METRIC) {
    throw new Error(`规则「${RULE_NAME}」的指标是 ${rule.metric}，应为 ${RULE_METRIC}。这条演示不另建一行。`);
  }
  if (shedOf(rule) !== null) {
    throw new Error(`规则「${RULE_NAME}」的棚区是 ${rule.shedCode}，应为全场。这条演示不另建一行。`);
  }
  if (!rule.id) throw new Error(`规则「${RULE_NAME}」没有 id。`);
  return rule;
}

function listedAs(rules, id, label) {
  const row = rules.find((rule) => rule.id === id);
  if (!row) throw new Error(`${label}里没有这条规则。`);
  return row;
}

function assertPair(detail, listed, predicate, label) {
  if (detail.id !== listed.id) throw new Error(`${label}的详情和列表不是同一条规则。`);
  if (!predicate(detail) || !predicate(listed)) {
    throw new Error(`${label}的列表或详情字段对不上。`);
  }
  if (detail.name !== listed.name || detail.metric !== listed.metric) {
    throw new Error(`${label}的名称或指标在列表和详情不一致。`);
  }
  if (shedOf(detail) !== shedOf(listed)) throw new Error(`${label}的棚区在列表和详情不一致。`);
  if (!sameNumber(detail.threshold, listed.threshold)) throw new Error(`${label}的阈值在列表和详情不一致。`);
  if (detail.level !== listed.level) throw new Error(`${label}的等级在列表和详情不一致。`);
  if (Number(detail.windowMinutes) !== Number(listed.windowMinutes)) {
    throw new Error(`${label}的窗口分钟在列表和详情不一致。`);
  }
  if (detail.enabled !== listed.enabled) throw new Error(`${label}的启用在列表和详情不一致。`);
  return listed;
}

async function readRules(token) {
  const body = await api(token, 'GET', '/alert-rules');
  if (!Array.isArray(body)) throw new Error('阈值规则列表不是数组');
  assertSeedUntouched(body.find((rule) => rule.name === SEED_RULE_NAME));
  return body;
}

async function readPair(token, id, predicate, label) {
  const detail = await api(token, 'GET', `/alert-rules/${encodeURIComponent(id)}`);
  const rules = await readRules(token);
  const listed = listedAs(rules, id, label);
  assertPair(detail, listed, predicate, label);
  return { detail, listed, rules };
}

export async function sendAlertRuleEditDemo() {
  const token = await login();
  const initial = await readRules(token);
  const found = findDemo(initial);
  let action;
  let id;
  if (!found) {
    const created = await api(token, 'POST', '/alert-rules', beforeBody());
    id = created.id;
    action = '新建';
  } else {
    assertEditable(found);
    id = found.id;
    action = '沿用';
    if (!isBeforeState(found)) {
      await api(token, 'PATCH', `/alert-rules/${encodeURIComponent(id)}`, {
        threshold: BEFORE_THRESHOLD,
        level: BEFORE_LEVEL,
        windowMinutes: BEFORE_WINDOW,
        enabled: true,
      });
    }
  }
  const beforePair = await readPair(token, id, isBeforeState, '改前');
  await api(token, 'PATCH', `/alert-rules/${encodeURIComponent(id)}`, afterPatch());
  const afterPair = await readPair(token, id, isAfterState, '改后');
  assertOthersUntouched(initial, afterPair.rules);
  assertSeedUntouched(afterPair.rules.find((rule) => rule.name === SEED_RULE_NAME));
  return {
    action,
    before: beforePair.listed,
    after: afterPair.listed,
    detail: afterPair.detail,
  };
}

function usage() {
  return `用法:
  node scripts/demo-alert-rule-edit.mjs

新建或沿用「${RULE_NAME}」，再把阈值、等级、窗口和启用改掉。步骤见 docs/DEMO_ALERT_RULE_EDIT.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const sent = await sendAlertRuleEditDemo();
    process.stdout.write(`${formatAlertRuleEditProof(sent)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
