#!/usr/bin/env node
/**
 * 留下一条失败登录和一条成功登录，时间错开，再按用户名和起止时间查询。
 * 失败用户 login-log-fail 在当前时刻前 3 小时；超管成功登录在当前时刻。
 * 同一用户名、结果和 User-Agent 已在时只改时间，不另留一行。
 * 不发识别，不发心跳，不改告警。登录日志接口的查询参数不改。
 */
import { pathToFileURL } from 'node:url';
import { apiBase, withPg } from './lib/ingest-wire.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';

export const ADMIN_USERNAME = 'admin';
export const ADMIN_PASSWORD = 'Admin@123456';
export const FAIL_USERNAME = 'login-log-fail';
export const FAIL_PASSWORD = 'LoginLogFail@000000';
export const DEMO_USER_AGENT = 'audit-login-log-demo/1';
export const TOKEN_USER_AGENT = 'audit-login-log-demo-token/1';
export const OUTSIDE_MS = 3 * 60 * 60 * 1000;
export const WIDE_BEFORE_MS = 4 * 60 * 60 * 1000;
export const NARROW_BEFORE_MS = 30 * 60 * 1000;
export const AFTER_MS = 60 * 1000;
export const PAGE_SIZE = '100';

export function demoWindows(now = new Date()) {
  const stamp = now.getTime();
  return {
    now,
    outsideAt: new Date(stamp - OUTSIDE_MS),
    insideNowAt: new Date(stamp),
    wideFrom: new Date(stamp - WIDE_BEFORE_MS),
    narrowFrom: new Date(stamp - NARROW_BEFORE_MS),
    to: new Date(stamp + AFTER_MS),
  };
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

function offline(url, error) {
  return new Error(`API 连不上（${url}）。先执行 make up、make migrate、make api。${error.message}`);
}

function itemsOf(body) {
  return Array.isArray(body?.items) ? body.items : [];
}

export function inWindow(value, from, to) {
  const at = new Date(value).getTime();
  return Number.isFinite(at) && at >= from.getTime() && at <= to.getTime();
}

export function sameInstant(value, date) {
  const at = new Date(value).getTime();
  return Number.isFinite(at) && at === date.getTime();
}

async function requestJson(path, { method = 'GET', token, body, userAgent } = {}) {
  const url = `${apiBase()}${path}`;
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (userAgent) headers['user-agent'] = userAgent;
  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw offline(url, error);
  }
  return { status: response.status, body: await readJson(response) };
}

async function login(username, password, userAgent) {
  return requestJson('/auth/login', {
    method: 'POST',
    body: { username, password },
    userAgent,
  });
}

async function getLoginPage(token, params) {
  const url = new URL(`${apiBase()}/login-logs`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, value instanceof Date ? value.toISOString() : String(value));
  }
  let response;
  try {
    response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  } catch (error) {
    throw offline(url, error);
  }
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`登录日志失败 ${response.status} ${messageText(body) || JSON.stringify(body)}`);
  }
  if (!Array.isArray(body.items) || !Number.isFinite(Number(body.total))) {
    throw new Error('登录日志没有 items 或 total');
  }
  return { items: body.items, total: Number(body.total) };
}

export async function listLoginLogs(token, params, { maxPages = 20 } = {}) {
  const items = [];
  let total = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    const body = await getLoginPage(token, { ...params, page: String(page), pageSize: PAGE_SIZE });
    total = body.total;
    items.push(...body.items);
    if (items.length >= total || body.items.length === 0) break;
  }
  if (items.length < total) {
    throw new Error(`登录日志超过 ${maxPages} 页，没有读完`);
  }
  return { items, total };
}

async function getAuditPage(token, page) {
  const result = await requestJson(`/audit-logs?page=${page}&pageSize=${PAGE_SIZE}`, { token });
  if (result.status !== 200) {
    throw new Error(`操作审计失败 ${result.status} ${messageText(result.body) || JSON.stringify(result.body)}`);
  }
  return {
    items: itemsOf(result.body),
    total: Number(result.body?.total),
  };
}

export async function listAuditLogs(token, { maxPages = 5 } = {}) {
  const items = [];
  let total = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    const body = await getAuditPage(token, page);
    total = body.total;
    items.push(...body.items);
    if (!Number.isFinite(total) || items.length >= total || body.items.length === 0) break;
  }
  return { items, total };
}

export function assertLoginSelection(items, { required = [], forbidden = [], from, to, username } = {}) {
  for (const id of required) {
    const row = items.find((item) => item.id === id);
    if (!row) throw new Error(`登录日志里没有 ${id}`);
    if (from && to && !inWindow(row.createdAt, from, to)) {
      throw new Error(`登录日志 ${id} 的时间不在窗口内`);
    }
    if (username && row.username !== username) {
      throw new Error(`登录日志 ${id} 的用户不是 ${username}`);
    }
  }
  for (const id of forbidden) {
    if (items.some((item) => item.id === id)) throw new Error(`筛选结果里仍有 ${id}`);
  }
  if (from && to) {
    const stray = items.filter((item) => !inWindow(item.createdAt, from, to));
    if (stray.length) {
      throw new Error(`筛选结果里仍有窗口外的登录 ${stray.map((item) => item.id).join('、')}`);
    }
  }
  if (username) {
    const stray = items.filter((item) => item.username !== username);
    if (stray.length) {
      throw new Error(`筛选结果里仍有其他用户 ${stray.map((item) => item.username).join('、')}`);
    }
  }
}

async function findLogin(token, { username, result, userAgent }) {
  const listed = await listLoginLogs(token, { username });
  return listed.items.find(
    (row) => row?.username === username && row?.result === result && row?.userAgent === userAgent,
  );
}

function isFailureAudit(row) {
  return row?.action === 'auth.login_failed' && row?.detail?.username === FAIL_USERNAME;
}

function isSuccessAudit(row) {
  return row?.action === 'auth.login' && row?.username === ADMIN_USERNAME;
}

async function placeLoginTime(useDb, { id, createdAt, username, result, userAgent }) {
  try {
    await useDb(async (db) => {
      const updated = await db.query('UPDATE login_logs SET created_at = $1 WHERE id = $2', [
        createdAt.toISOString(),
        id,
      ]);
      if (!updated?.rowCount) {
        throw new Error(`没有改到登录日志 ${id}`);
      }
      await db.query(
        'DELETE FROM login_logs WHERE username = $1 AND user_agent = $2 AND result = $3 AND id <> $4',
        [username, userAgent, result, id],
      );
    });
  } catch (error) {
    if (error.message.startsWith('没有改到登录日志')) throw error;
    throw new Error(`登录日志时间没有写入数据库。先执行 make up、make migrate。${error.message}`);
  }
}

async function ensureLogin(token, useDb, spec) {
  let row = await findLogin(token, spec);
  const audits = await listAuditLogs(token);
  const auditHit = audits.items.some(spec.audit);
  let created = false;
  if (!row || !auditHit) {
    const response = await login(spec.username, spec.password, spec.userAgent);
    if (spec.result === 'failure') {
      if (response.status !== 401) {
        throw new Error(`登录 ${spec.username} 应是 401，实际 ${response.status} ${messageText(response.body)}`);
      }
    } else if (!response.body?.accessToken) {
      throw new Error(
        `登录 ${spec.username} 失败 ${response.status} ${messageText(response.body) || JSON.stringify(response.body)}`,
      );
    }
    created = true;
    row = await findLogin(token, spec);
  }
  if (!row?.id) {
    throw new Error(`登录日志里没有用户 ${spec.username}、结果 ${spec.result}、User-Agent ${spec.userAgent}`);
  }
  await placeLoginTime(useDb, {
    id: row.id,
    createdAt: spec.createdAt,
    username: spec.username,
    result: spec.result,
    userAgent: spec.userAgent,
  });
  const placed = await findLogin(token, spec);
  if (!placed || !sameInstant(placed.createdAt, spec.createdAt)) {
    throw new Error(`用户 ${spec.username} 的登录时间不是 ${spec.createdAt.toISOString()}`);
  }
  if (placed.result !== spec.result) {
    throw new Error(`用户 ${spec.username} 的结果不是 ${spec.result}`);
  }
  return { id: placed.id, createdAt: placed.createdAt, result: placed.result, created };
}

export function auditPageUrl(query = {}, webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, value instanceof Date ? value.toISOString() : String(value));
  }
  const search = params.toString();
  return `${origin}/audit${search ? `?${search}` : ''}`;
}

export function formatAuditLoginProof({
  failure,
  success,
  clock,
  wideCount,
  narrowCount,
  userCount,
  emptyCount,
  webOrigin = webOriginFromEnv(),
}) {
  const lines = [
    `登录: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`,
    `登录日志: 用户 ${FAIL_USERNAME}，结果失败，时间 ${failure.createdAt}，User-Agent ${DEMO_USER_AGENT}`,
    `登录日志: 用户 ${ADMIN_USERNAME}，结果成功，时间 ${success.createdAt}，User-Agent ${DEMO_USER_AGENT}`,
    `宽窗口: ${clock.wideFrom.toISOString()} 至 ${clock.to.toISOString()}`,
    `宽窗口条数: ${wideCount}`,
    `窄窗口: ${clock.narrowFrom.toISOString()} 至 ${clock.to.toISOString()}`,
    `窄窗口条数: ${narrowCount}`,
    '窄窗口少于宽窗口: 是',
    '窄窗口含成功、不含失败: 是',
    `用户 ${FAIL_USERNAME} 条数: ${userCount}`,
    `用户 ${FAIL_USERNAME} 窄窗口条数: ${emptyCount}`,
    `操作审计: 登录失败，明细 ${FAIL_USERNAME}（action auth.login_failed）`,
    `操作审计: 用户 ${ADMIN_USERNAME}，登录成功（action auth.login）`,
    `审计页: ${auditPageUrl({}, webOrigin)}`,
    `宽窗口列表: ${auditPageUrl({ from: clock.wideFrom, to: clock.to }, webOrigin)}`,
    `窄窗口列表: ${auditPageUrl({ from: clock.narrowFrom, to: clock.to }, webOrigin)}`,
    `失败用户列表: ${auditPageUrl({ username: FAIL_USERNAME }, webOrigin)}`,
    `空筛选列表: ${auditPageUrl({ username: FAIL_USERNAME, from: clock.narrowFrom, to: clock.to }, webOrigin)}`,
  ];
  return lines.join('\n');
}

export async function showAuditLoginLogs({ now = new Date(), db } = {}) {
  const clock = demoWindows(now);
  const useDb = db ? async (fn) => fn(db) : withPg;
  const session = await login(ADMIN_USERNAME, ADMIN_PASSWORD, TOKEN_USER_AGENT);
  if (!session.body?.accessToken) {
    throw new Error(
      `登录 ${ADMIN_USERNAME} 失败 ${session.status} ${messageText(session.body) || JSON.stringify(session.body)}。` +
        '确认 API 已启动，并且超管仍是种子密码 Admin@123456。',
    );
  }
  const token = session.body.accessToken;
  const failure = await ensureLogin(token, useDb, {
    username: FAIL_USERNAME,
    password: FAIL_PASSWORD,
    result: 'failure',
    userAgent: DEMO_USER_AGENT,
    createdAt: clock.outsideAt,
    audit: isFailureAudit,
  });
  const success = await ensureLogin(token, useDb, {
    username: ADMIN_USERNAME,
    password: ADMIN_PASSWORD,
    result: 'success',
    userAgent: DEMO_USER_AGENT,
    createdAt: clock.insideNowAt,
    audit: isSuccessAudit,
  });
  const wide = await listLoginLogs(token, { from: clock.wideFrom, to: clock.to });
  const narrow = await listLoginLogs(token, { from: clock.narrowFrom, to: clock.to });
  const byUser = await listLoginLogs(token, { username: FAIL_USERNAME });
  const empty = await listLoginLogs(token, {
    username: FAIL_USERNAME,
    from: clock.narrowFrom,
    to: clock.to,
  });
  assertLoginSelection(wide.items, {
    required: [failure.id, success.id],
    from: clock.wideFrom,
    to: clock.to,
  });
  assertLoginSelection(narrow.items, {
    required: [success.id],
    forbidden: [failure.id],
    from: clock.narrowFrom,
    to: clock.to,
  });
  if (!(narrow.total < wide.total)) {
    throw new Error(`窄窗口条数 ${narrow.total} 没有少于宽窗口 ${wide.total}`);
  }
  assertLoginSelection(byUser.items, {
    required: [failure.id],
    forbidden: [success.id],
    username: FAIL_USERNAME,
  });
  if (byUser.total !== 1) {
    throw new Error(`用户 ${FAIL_USERNAME} 的登录日志应是 1 条，实际 ${byUser.total}`);
  }
  const failedRow = byUser.items.find((row) => row.id === failure.id);
  if (failedRow?.result !== 'failure') {
    throw new Error(`用户 ${FAIL_USERNAME} 的结果不是 failure`);
  }
  if (empty.total !== 0 || empty.items.length !== 0) {
    throw new Error(`用户 ${FAIL_USERNAME} 的窄窗口应是 0 条，实际 ${empty.total}`);
  }
  const audits = await listAuditLogs(token);
  if (!audits.items.some(isFailureAudit)) {
    throw new Error(`操作审计里没有动作 auth.login_failed，明细 ${FAIL_USERNAME}`);
  }
  if (!audits.items.some(isSuccessAudit)) {
    throw new Error(`操作审计里没有用户 ${ADMIN_USERNAME} 的动作 auth.login`);
  }
  return {
    failure,
    success,
    clock,
    wideCount: wide.total,
    narrowCount: narrow.total,
    userCount: byUser.total,
    emptyCount: empty.total,
  };
}

function usage() {
  return `用法:
  node scripts/demo-audit-login-log.mjs

留下用户 ${FAIL_USERNAME} 的失败登录（前 3 小时）和 ${ADMIN_USERNAME} 的成功登录（当前时刻）。
User-Agent 是 ${DEMO_USER_AGENT}。再按用户名和起止时间核对登录日志。
不发识别，不发心跳，不改告警。步骤见 docs/DEMO_AUDIT_LOGIN_LOG.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await showAuditLoginLogs();
    process.stdout.write(`${formatAuditLoginProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
