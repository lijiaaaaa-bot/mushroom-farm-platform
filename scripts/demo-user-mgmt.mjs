#!/usr/bin/env node
/**
 * 超管打开 /users 至少看到两条账号，角色列可读（超管、查看）。
 * 查看打开 /users 进不去：侧栏没有「用户」，接口 403，路由回到总览。
 * 查看账号的写入沿用 demo-rbac 的 ensureViewer。不发识别，不发心跳，不改告警。
 * 本命令只核对列表，不提交新建或重设。
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { apiBase, repoRoot } from './lib/ingest-wire.mjs';
import {
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  VIEWER_PASSWORD,
  VIEWER_USERNAME,
  ensureViewer,
  loginAs,
  menuLabels,
} from './demo-rbac.mjs';

const require = createRequire(import.meta.url);

export const ADMIN_ROLE = 'super_admin';
export const VIEWER_ROLE = 'viewer';
export const ADMIN_ROLE_LABEL = '超管';
export const VIEWER_ROLE_LABEL = '查看';

function roleLabels() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js')).ROLE_LABEL;
}

function webOrigin() {
  return process.env.WEB_ORIGIN || 'http://127.0.0.1:43123';
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

async function getUsers(token) {
  const url = `${apiBase()}/users`;
  let response;
  try {
    response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  } catch (error) {
    throw offline(url, error);
  }
  const body = await readJson(response);
  return { status: response.status, body };
}

export function assertUsersPageListsRoles(source) {
  const text = source ?? readFileSync(join(repoRoot(), 'apps/web/src/views/UsersView.vue'), 'utf8');
  if (!text.includes('<th>角色</th>') || !text.includes('ROLE_LABEL')) {
    throw new Error('用户页应有角色列，并用 ROLE_LABEL 写出超管、查看。');
  }
  if (!text.includes('data-testid="user-create-form"') || !text.includes('新建用户')) {
    throw new Error('用户页应有新建用户表单。');
  }
  if (!text.includes('重设密码') || !text.includes('resetPassword: true')) {
    throw new Error('用户页应有重设密码入口。');
  }
}

export function assertViewerCannotOpenUsersPage({ nav, routerSource } = {}) {
  const links =
    nav ?? JSON.parse(readFileSync(join(repoRoot(), 'apps/web/src/admin-nav.json'), 'utf8'));
  const users = links.find((link) => link.to === '/users');
  if (!users || users.label !== '用户' || JSON.stringify(users.roles) !== JSON.stringify(['super_admin'])) {
    throw new Error('侧栏「用户」应只给超管。');
  }
  const router =
    routerSource ?? readFileSync(join(repoRoot(), 'apps/web/src/router.ts'), 'utf8');
  if (!router.includes("path: 'users'") || !router.includes("roles: navRoles('/users')")) {
    throw new Error('用户路由应接上侧栏角色。');
  }
  if (!router.includes("if (!roleCanOpen(readSessionRole(), to.path)) return { path: '/' };")) {
    throw new Error('角色不匹配时打开 /users 应回到总览。');
  }
}

export function assertUserList(rows) {
  if (!Array.isArray(rows) || rows.length < 2) {
    throw new Error(`用户列表应至少有两条账号，实际是 ${Array.isArray(rows) ? rows.length : '空'}。`);
  }
  const serialized = JSON.stringify(rows);
  if (/password/i.test(serialized) || serialized.includes(ADMIN_PASSWORD) || serialized.includes(VIEWER_PASSWORD)) {
    throw new Error('用户列表带回了密码。');
  }
  const labels = roleLabels();
  if (labels[ADMIN_ROLE] !== ADMIN_ROLE_LABEL || labels[VIEWER_ROLE] !== VIEWER_ROLE_LABEL) {
    throw new Error(`角色文案应为${ADMIN_ROLE_LABEL}和${VIEWER_ROLE_LABEL}。`);
  }
  const admin = rows.find((row) => row?.username === ADMIN_USERNAME);
  const viewer = rows.find((row) => row?.username === VIEWER_USERNAME);
  if (!admin || admin.role !== ADMIN_ROLE) {
    throw new Error(`用户列表应有 ${ADMIN_USERNAME}，角色 ${ADMIN_ROLE}（${ADMIN_ROLE_LABEL}）。`);
  }
  if (!viewer || viewer.role !== VIEWER_ROLE) {
    throw new Error(`用户列表应有 ${VIEWER_USERNAME}，角色 ${VIEWER_ROLE}（${VIEWER_ROLE_LABEL}）。`);
  }
  return rows.map((row) => ({
    username: row.username,
    role: row.role,
    roleLabel: labels[row.role] ?? row.role,
  }));
}

export function assertUserMgmt({ adminSession, viewerSession, users }) {
  if (adminSession?.user?.role !== ADMIN_ROLE || adminSession.user.username !== ADMIN_USERNAME) {
    throw new Error(`超管登录角色是 ${adminSession?.user?.role || '空'}，应为 ${ADMIN_ROLE}。`);
  }
  if (viewerSession?.user?.role !== VIEWER_ROLE || viewerSession.user.username !== VIEWER_USERNAME) {
    throw new Error(`查看登录角色是 ${viewerSession?.user?.role || '空'}，应为 ${VIEWER_ROLE}。`);
  }
  if (users.adminStatus !== 200) {
    throw new Error(`超管读取用户列表失败 ${users.adminStatus}。`);
  }
  const listed = assertUserList(users.adminBody);
  if (users.viewerStatus !== 403) {
    throw new Error(`查看读取用户列表应是 403，实际 ${users.viewerStatus}。`);
  }
  const adminMenus = menuLabels('super_admin');
  const viewerMenus = menuLabels('viewer');
  if (!adminMenus.includes('用户')) {
    throw new Error('超管菜单应含用户。');
  }
  if (viewerMenus.includes('用户')) {
    throw new Error('查看菜单不应含用户。');
  }
  assertUsersPageListsRoles();
  assertViewerCannotOpenUsersPage();
  return { adminMenus, viewerMenus, listed };
}

export function formatUserMgmtProof({ listed, webOrigin: origin = webOrigin() }) {
  const base = String(origin).replace(/\/$/, '');
  const accounts = listed
    .map((row) => `账号: ${row.username} ${row.roleLabel}`)
    .join('\n');
  const lines = [
    `超管: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`,
    `查看: ${VIEWER_USERNAME} / ${VIEWER_PASSWORD}`,
    `登录: ${base}/login`,
    `用户页: ${base}/users`,
    `条数: ${listed.length}`,
    accounts,
    '超管菜单含用户',
    '查看菜单不含用户',
    '查看打开用户页回到总览',
    '用户接口: 超管 200，查看 403',
    `总览: ${base}/`,
  ];
  return lines.join('\n');
}

export async function showUserMgmt() {
  const adminSession = await loginAs(ADMIN_USERNAME, ADMIN_PASSWORD);
  await ensureViewer(adminSession.accessToken);
  const viewerSession = await loginAs(VIEWER_USERNAME, VIEWER_PASSWORD);
  const [adminUsers, viewerUsers] = await Promise.all([
    getUsers(adminSession.accessToken),
    getUsers(viewerSession.accessToken),
  ]);
  return assertUserMgmt({
    adminSession,
    viewerSession,
    users: {
      adminStatus: adminUsers.status,
      adminBody: adminUsers.body,
      viewerStatus: viewerUsers.status,
    },
  });
}

function usage() {
  return `用法:
  node scripts/demo-user-mgmt.mjs

用种子超管登录，把查看账号写成 ${VIEWER_USERNAME} / ${VIEWER_PASSWORD}（与 make demo-rbac 同一写入）。
再核对用户列表至少有 ${ADMIN_USERNAME}（${ADMIN_ROLE_LABEL}）和 ${VIEWER_USERNAME}（${VIEWER_ROLE_LABEL}）。
查看读用户列表是 403，侧栏没有「用户」，打开 /users 回到总览。
不发识别，不发心跳，不改告警。本命令不提交新建或重设。
步骤见 docs/DEMO_USER_MGMT.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const scopes = await showUserMgmt();
    process.stdout.write(`${formatUserMgmtProof(scopes)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
