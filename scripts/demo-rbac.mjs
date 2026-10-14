#!/usr/bin/env node
/**
 * 保证超管 admin 与查看 viewer 可以用已知密码登录。
 * 已有 viewer 时重设密码、显示名、角色和棚号 S01，不另建一行。
 * 核对两边菜单、用户/审计/登录日志的 403，以及查看看不到 S02。
 * 不发识别，不发心跳，不改告警。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { apiBase, repoRoot } from './lib/ingest-wire.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';

export const ADMIN_USERNAME = 'admin';
export const ADMIN_PASSWORD = 'Admin@123456';
export const VIEWER_USERNAME = 'viewer';
export const VIEWER_PASSWORD = 'Viewer@123456';
export const VIEWER_SHED = 'S01';
export const HIDDEN_SHED = 'S02';

export function viewerBody() {
  return {
    username: VIEWER_USERNAME,
    password: VIEWER_PASSWORD,
    displayName: '只读查看',
    role: 'viewer',
    shedCodes: [VIEWER_SHED],
    resetPassword: true,
  };
}

export function loadAdminNav() {
  return JSON.parse(readFileSync(join(repoRoot(), 'apps/web/src/admin-nav.json'), 'utf8'));
}

/** 与 apps/web/src/nav.ts 的 visibleNav 同一规则。 */
export function menusFor(role) {
  return loadAdminNav().filter((link) => !link.roles?.length || link.roles.includes(role));
}

export function menuLabels(role) {
  return menusFor(role).map((link) => link.label);
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

export async function loginAs(username, password) {
  const url = `${apiBase()}/auth/login`;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  } catch (error) {
    throw offline(url, error);
  }
  const session = await readJson(response);
  if (!response.ok || !session.accessToken || !session.user) {
    throw new Error(
      `登录 ${username} 失败 ${response.status} ${messageText(session) || JSON.stringify(session)}。` +
        '确认 API 已启动，并且超管仍是种子密码 Admin@123456。',
    );
  }
  return session;
}

export async function ensureViewer(adminToken) {
  const url = `${apiBase()}/users`;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(viewerBody()),
    });
  } catch (error) {
    throw offline(url, error);
  }
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(
      `写入查看账号失败 ${response.status} ${messageText(body) || JSON.stringify(body)}。`,
    );
  }
  if (body.username !== VIEWER_USERNAME || body.role !== 'viewer') {
    throw new Error(`查看账号角色是 ${body.role || '空'}，应为 viewer。`);
  }
  if (!Array.isArray(body.shedCodes) || body.shedCodes.includes(HIDDEN_SHED) || !body.shedCodes.includes(VIEWER_SHED)) {
    throw new Error(`查看账号棚号应为 ${VIEWER_SHED}，实际是 ${JSON.stringify(body.shedCodes ?? null)}。`);
  }
  return body;
}

async function getJson(token, path) {
  const url = `${apiBase()}${path}`;
  let response;
  try {
    response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  } catch (error) {
    throw offline(url, error);
  }
  const body = await readJson(response);
  return { status: response.status, body };
}

function shedCodes(body) {
  const rows = Array.isArray(body) ? body : [];
  return rows.map((row) => row?.code).filter((code) => typeof code === 'string');
}

export function assertRbacScopes({
  adminSession,
  viewerSession,
  users,
  auditLogs,
  loginLogs,
  sheds,
}) {
  if (adminSession?.user?.role !== 'super_admin' || adminSession.user.username !== ADMIN_USERNAME) {
    throw new Error(`超管登录角色是 ${adminSession?.user?.role || '空'}，应为 super_admin。`);
  }
  if (viewerSession?.user?.role !== 'viewer' || viewerSession.user.username !== VIEWER_USERNAME) {
    throw new Error(`查看登录角色是 ${viewerSession?.user?.role || '空'}，应为 viewer。`);
  }
  const viewerShedsOnSession = viewerSession.user.shedCodes ?? [];
  if (!viewerShedsOnSession.includes(VIEWER_SHED) || viewerShedsOnSession.includes(HIDDEN_SHED)) {
    throw new Error(`登录返回的查看棚号应为 ${VIEWER_SHED}，实际是 ${JSON.stringify(viewerShedsOnSession)}。`);
  }
  if (users.adminStatus !== 200) {
    throw new Error(`超管读取用户列表失败 ${users.adminStatus}。`);
  }
  const names = (Array.isArray(users.adminBody) ? users.adminBody : []).map((row) => row?.username);
  if (!names.includes(ADMIN_USERNAME) || !names.includes(VIEWER_USERNAME)) {
    throw new Error(`用户列表里应同时有 ${ADMIN_USERNAME} 和 ${VIEWER_USERNAME}。`);
  }
  if (JSON.stringify(users.adminBody).includes(VIEWER_PASSWORD)) {
    throw new Error('用户列表带回了查看密码。');
  }
  if (users.viewerStatus !== 403) {
    throw new Error(`查看读取用户列表应是 403，实际 ${users.viewerStatus}。`);
  }
  if (auditLogs.adminStatus !== 200) {
    throw new Error(`超管读取审计失败 ${auditLogs.adminStatus}。`);
  }
  if (auditLogs.viewerStatus !== 403) {
    throw new Error(`查看读取审计应是 403，实际 ${auditLogs.viewerStatus}。`);
  }
  if (loginLogs.adminStatus !== 200) {
    throw new Error(`超管读取登录日志失败 ${loginLogs.adminStatus}。`);
  }
  if (loginLogs.viewerStatus !== 403) {
    throw new Error(`查看读取登录日志应是 403，实际 ${loginLogs.viewerStatus}。`);
  }
  const adminCodes = shedCodes(sheds.adminBody);
  const viewerCodes = shedCodes(sheds.viewerBody);
  if (!adminCodes.includes(VIEWER_SHED) || !adminCodes.includes(HIDDEN_SHED)) {
    throw new Error(
      `超管棚列表应含 ${VIEWER_SHED} 和 ${HIDDEN_SHED}，实际是 ${adminCodes.join('、') || '空'}。确认种子棚已写入。`,
    );
  }
  if (!viewerCodes.includes(VIEWER_SHED) || viewerCodes.includes(HIDDEN_SHED)) {
    throw new Error(
      `查看棚列表应含 ${VIEWER_SHED} 且不含 ${HIDDEN_SHED}，实际是 ${viewerCodes.join('、') || '空'}。`,
    );
  }
  const adminMenus = menuLabels('super_admin');
  const viewerMenus = menuLabels('viewer');
  if (!adminMenus.includes('审计') || !adminMenus.includes('用户')) {
    throw new Error('超管菜单应含审计和用户。');
  }
  if (viewerMenus.includes('审计') || viewerMenus.includes('用户')) {
    throw new Error('查看菜单不应含审计或用户。');
  }
  return { adminMenus, viewerMenus, adminCodes, viewerCodes };
}

export function formatRbacProof({ adminMenus, viewerMenus, webOrigin = webOriginFromEnv() }) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const lines = [
    `超管: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`,
    `查看: ${VIEWER_USERNAME} / ${VIEWER_PASSWORD}`,
    `登录: ${origin}/login`,
    `超管菜单: ${adminMenus.join('、')}`,
    `查看菜单: ${viewerMenus.join('、')}`,
    '查看没有: 审计、用户',
    '用户接口: 超管 200，查看 403',
    '审计接口: 超管 200，查看 403',
    '登录日志: 超管 200，查看 403',
    `棚区: 超管含 ${VIEWER_SHED}、${HIDDEN_SHED}；查看含 ${VIEWER_SHED}，不含 ${HIDDEN_SHED}`,
    `总览: ${origin}/`,
    `审计页: ${origin}/audit`,
    `用户页: ${origin}/users`,
  ];
  return lines.join('\n');
}

export async function showRbac() {
  const adminSession = await loginAs(ADMIN_USERNAME, ADMIN_PASSWORD);
  await ensureViewer(adminSession.accessToken);
  const viewerSession = await loginAs(VIEWER_USERNAME, VIEWER_PASSWORD);
  const [adminUsers, viewerUsers, adminAudit, viewerAudit, adminLoginLogs, viewerLoginLogs, adminSheds, viewerSheds] =
    await Promise.all([
      getJson(adminSession.accessToken, '/users'),
      getJson(viewerSession.accessToken, '/users'),
      getJson(adminSession.accessToken, '/audit-logs'),
      getJson(viewerSession.accessToken, '/audit-logs'),
      getJson(adminSession.accessToken, '/login-logs'),
      getJson(viewerSession.accessToken, '/login-logs'),
      getJson(adminSession.accessToken, '/sheds'),
      getJson(viewerSession.accessToken, '/sheds'),
    ]);
  const scopes = assertRbacScopes({
    adminSession,
    viewerSession,
    users: { adminStatus: adminUsers.status, adminBody: adminUsers.body, viewerStatus: viewerUsers.status },
    auditLogs: { adminStatus: adminAudit.status, viewerStatus: viewerAudit.status },
    loginLogs: { adminStatus: adminLoginLogs.status, viewerStatus: viewerLoginLogs.status },
    sheds: { adminBody: adminSheds.body, viewerBody: viewerSheds.body },
  });
  return scopes;
}

function usage() {
  return `用法:
  node scripts/demo-rbac.mjs

用种子超管登录，把查看账号写成 ${VIEWER_USERNAME} / ${VIEWER_PASSWORD}（棚号 ${VIEWER_SHED}）。
再核对菜单、用户与审计接口、棚列表。不发识别，不发心跳，不改告警。
步骤见 docs/DEMO_RBAC.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const scopes = await showRbac();
    process.stdout.write(`${formatRbacProof(scopes)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
