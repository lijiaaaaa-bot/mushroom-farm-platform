#!/usr/bin/env node
/**
 * 用真实登录留下可认出的登录日志和操作审计。
 * 超管成功登录，以及不存在的用户 audit-demo 失败登录。
 * 查看仍不能读这两份列表。不发识别，不发心跳，不改告警。
 */
import { pathToFileURL } from 'node:url';
import { apiBase } from './lib/ingest-wire.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';
import {
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  VIEWER_PASSWORD,
  VIEWER_USERNAME,
  ensureViewer,
} from './demo-rbac.mjs';

export const DEMO_LOGIN_USERNAME = 'audit-demo';
export const DEMO_LOGIN_PASSWORD = 'AuditDemo@000000';
export const DEMO_USER_AGENT = 'audit-log-demo/1';
export const PAGE_SIZE = '20';

export function failedLoginBody() {
  return {
    username: DEMO_LOGIN_USERNAME,
    password: DEMO_LOGIN_PASSWORD,
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

async function login(username, password) {
  const result = await requestJson('/auth/login', {
    method: 'POST',
    body: { username, password },
    userAgent: DEMO_USER_AGENT,
  });
  if (!result.body?.accessToken || !result.body?.user) {
    throw new Error(
      `登录 ${username} 失败 ${result.status} ${messageText(result.body) || JSON.stringify(result.body)}。` +
        '确认 API 已启动，并且超管仍是种子密码 Admin@123456。',
    );
  }
  return result;
}

export function assertAuditEntries({
  failedStatus,
  loginLogs,
  auditLogs,
}) {
  if (failedStatus !== 401) {
    throw new Error(`用户 ${DEMO_LOGIN_USERNAME} 的失败登录应是 401，实际 ${failedStatus}。`);
  }
  if (loginLogs.adminStatus !== 200) {
    throw new Error(`超管读取登录日志失败 ${loginLogs.adminStatus}。`);
  }
  if (loginLogs.viewerStatus !== 403) {
    throw new Error(`查看读取登录日志应是 403，实际 ${loginLogs.viewerStatus}。`);
  }
  if (auditLogs.adminStatus !== 200) {
    throw new Error(`超管读取操作审计失败 ${auditLogs.adminStatus}。`);
  }
  if (auditLogs.viewerStatus !== 403) {
    throw new Error(`查看读取操作审计应是 403，实际 ${auditLogs.viewerStatus}。`);
  }
  const loginItems = itemsOf(loginLogs.adminBody);
  const auditItems = itemsOf(auditLogs.adminBody);
  const failedLogin = loginItems.find(
    (row) =>
      row?.username === DEMO_LOGIN_USERNAME &&
      row?.result === 'failure' &&
      row?.userAgent === DEMO_USER_AGENT,
  );
  if (!failedLogin) {
    throw new Error(
      `登录日志第一页应有用户 ${DEMO_LOGIN_USERNAME}、结果 failure、User-Agent ${DEMO_USER_AGENT}。`,
    );
  }
  const adminLogin = loginItems.find(
    (row) =>
      row?.username === ADMIN_USERNAME &&
      row?.result === 'success' &&
      row?.userAgent === DEMO_USER_AGENT,
  );
  if (!adminLogin) {
    throw new Error(
      `登录日志第一页应有用户 ${ADMIN_USERNAME}、结果 success、User-Agent ${DEMO_USER_AGENT}。`,
    );
  }
  const failedAudit = auditItems.find(
    (row) => row?.action === 'auth.login_failed' && row?.detail?.username === DEMO_LOGIN_USERNAME,
  );
  if (!failedAudit) {
    throw new Error(`操作审计第一页应有动作 auth.login_failed，明细用户 ${DEMO_LOGIN_USERNAME}。`);
  }
  const adminAudit = auditItems.find(
    (row) => row?.action === 'auth.login' && row?.username === ADMIN_USERNAME,
  );
  if (!adminAudit) {
    throw new Error(`操作审计第一页应有用户 ${ADMIN_USERNAME} 的动作 auth.login。`);
  }
  return { failedLogin, adminLogin, failedAudit, adminAudit };
}

export function formatAuditProof({ webOrigin = webOriginFromEnv() } = {}) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const lines = [
    `超管: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`,
    `查看: ${VIEWER_USERNAME} / ${VIEWER_PASSWORD}`,
    `登录日志: 用户 ${DEMO_LOGIN_USERNAME}，结果失败，User-Agent ${DEMO_USER_AGENT}`,
    `登录日志: 用户 ${ADMIN_USERNAME}，结果成功，User-Agent ${DEMO_USER_AGENT}`,
    `操作审计: 登录失败，明细 ${DEMO_LOGIN_USERNAME}（action auth.login_failed）`,
    `操作审计: 用户 ${ADMIN_USERNAME}，登录成功（action auth.login）`,
    '登录日志接口: 超管 200，查看 403',
    '审计接口: 超管 200，查看 403',
    `审计页: ${origin}/audit`,
    `总览: ${origin}/`,
    '查看打开审计页回到总览',
  ];
  return lines.join('\n');
}

export async function showAuditLogs() {
  const admin = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  await ensureViewer(admin.body.accessToken);
  const failed = await requestJson('/auth/login', {
    method: 'POST',
    body: failedLoginBody(),
    userAgent: DEMO_USER_AGENT,
  });
  const viewer = await login(VIEWER_USERNAME, VIEWER_PASSWORD);
  const listQuery = `?pageSize=${PAGE_SIZE}`;
  const [adminLoginLogs, viewerLoginLogs, adminAudit, viewerAudit] = await Promise.all([
    requestJson(`/login-logs${listQuery}`, { token: admin.body.accessToken }),
    requestJson(`/login-logs${listQuery}`, { token: viewer.body.accessToken }),
    requestJson(`/audit-logs${listQuery}`, { token: admin.body.accessToken }),
    requestJson(`/audit-logs${listQuery}`, { token: viewer.body.accessToken }),
  ]);
  assertAuditEntries({
    failedStatus: failed.status,
    loginLogs: {
      adminStatus: adminLoginLogs.status,
      adminBody: adminLoginLogs.body,
      viewerStatus: viewerLoginLogs.status,
    },
    auditLogs: {
      adminStatus: adminAudit.status,
      adminBody: adminAudit.body,
      viewerStatus: viewerAudit.status,
    },
  });
  return { adminStatus: admin.status, viewerRole: viewer.body.user.role };
}

function usage() {
  return `用法:
  node scripts/demo-audit-log.mjs

用 ${ADMIN_USERNAME} / ${ADMIN_PASSWORD} 登录，User-Agent 为 ${DEMO_USER_AGENT}。
再对不存在的用户 ${DEMO_LOGIN_USERNAME} 做一次失败登录。
核对 /audit 对应的登录日志和操作审计第一页里有这两条，查看仍是 403。
不发识别，不发心跳，不改告警。步骤见 docs/DEMO_AUDIT_LOG.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    await showAuditLogs();
    process.stdout.write(`${formatAuditProof()}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
