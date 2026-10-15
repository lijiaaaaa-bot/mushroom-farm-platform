#!/usr/bin/env node
/**
 * 登录用户改自己的密码。
 * 夹具账号先回到旧密码，再 POST /auth/change-password。
 * 旧密码登录是 401，新密码登录成功。
 * 不改 admin / viewer / producer / shedlead，也不改其他演示账号。
 * 不发识别，不发心跳，不改告警，不改接入观测。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { apiBase, repoRoot } from './lib/ingest-wire.mjs';
import {
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  loadAdminNav,
  loginAs,
  menuLabels,
} from './demo-rbac.mjs';

export const SELF_USERNAME = 'pwd-self-demo';
export const SELF_OLD_PASSWORD = 'PwdOld@123456';
export const SELF_NEW_PASSWORD = 'PwdNew@123456';
export const SELF_DISPLAY_NAME = '改密演示';
export const SELF_ROLE = 'viewer';
export const SELF_SHED = 'S01';

const ROLES = ['super_admin', 'production_admin', 'shed_manager', 'viewer'];

export function createBody() {
  return {
    username: SELF_USERNAME,
    password: SELF_OLD_PASSWORD,
    displayName: SELF_DISPLAY_NAME,
    role: SELF_ROLE,
    shedCodes: [SELF_SHED],
  };
}

export function restoreBody() {
  return { ...createBody(), resetPassword: true };
}

export function changeBody() {
  return {
    currentPassword: SELF_OLD_PASSWORD,
    newPassword: SELF_NEW_PASSWORD,
  };
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

function isConflict(result) {
  return result.status === 409 && messageText(result.body).includes('用户名已存在');
}

export function assertNoSecret(rows) {
  const serialized = JSON.stringify(rows ?? null);
  if (/password/i.test(serialized)) throw new Error('用户列表带回了密码。');
  for (const secret of [SELF_OLD_PASSWORD, SELF_NEW_PASSWORD, ADMIN_PASSWORD]) {
    if (serialized.includes(secret)) throw new Error('用户列表带回了密码。');
  }
}

function findRow(rows) {
  if (!Array.isArray(rows)) throw new Error('用户列表不是数组。');
  assertNoSecret(rows);
  return rows.find((item) => item?.username === SELF_USERNAME) ?? null;
}

export function assertChangeResponse(body) {
  if (body?.username !== SELF_USERNAME || body?.changed !== true) {
    throw new Error(`改密响应不是 ${SELF_USERNAME} 已修改。`);
  }
  const serialized = JSON.stringify(body);
  if (/password/i.test(serialized) || serialized.includes(SELF_NEW_PASSWORD) || serialized.includes(SELF_OLD_PASSWORD)) {
    throw new Error('改密响应带回了密码。');
  }
}

export function assertLoginContrast({ oldStatus, newStatus, newBody }) {
  if (oldStatus !== 401) throw new Error(`旧密码登录应是 401，实际 ${oldStatus}。`);
  if (newStatus !== 200 && newStatus !== 201) {
    throw new Error(`新密码登录应成功，实际 ${newStatus}。`);
  }
  if (!newBody?.accessToken || newBody?.user?.username !== SELF_USERNAME) {
    throw new Error(`新密码登录的用户是 ${newBody?.user?.username || '空'}，应为 ${SELF_USERNAME}。`);
  }
}

export function assertPasswordPage(source) {
  const text = source ?? readFileSync(join(repoRoot(), 'apps/web/src/views/ChangePasswordView.vue'), 'utf8');
  if (!text.includes('data-testid="password-self-form"') || !text.includes('修改密码')) {
    throw new Error('修改密码页应有表单。');
  }
  for (const label of ['当前密码', '新密码', '确认新密码']) {
    if (!text.includes(`aria-label="${label}"`)) throw new Error(`修改密码页应有${label}。`);
  }
  if (!text.includes("'/auth/change-password'") || !text.includes('currentPassword') || !text.includes('newPassword')) {
    throw new Error('修改密码页应提交当前密码和新密码。');
  }
  if (text.includes('resetPassword')) throw new Error('修改密码页不应走超管重设。');
  if (!text.includes('旧密码不能登录') || !text.includes('新密码可以登录')) {
    throw new Error('修改密码页应写出旧密码不能登录、新密码可以登录。');
  }
  if (!text.includes('旧密码：不能登录') || !text.includes('新密码：可以登录')) {
    throw new Error('修改密码页应在成功后写出登录对照。');
  }
  if (!text.includes('type="password"')) throw new Error('密码输入不应明文。');
}

export function assertPasswordNav(source) {
  const links = source ?? loadAdminNav();
  const link = links.find((item) => item.to === '/account/password');
  if (!link || link.label !== '修改密码') throw new Error('侧栏应有修改密码。');
  if (link.roles) throw new Error('修改密码应给所有已登录角色。');
  for (const role of ROLES) {
    if (!menuLabels(role).includes('修改密码')) {
      throw new Error(`${role} 的侧栏应有修改密码。`);
    }
  }
  if (menuLabels('viewer').includes('用户')) throw new Error('查看菜单不应含用户。');
}

async function postUsers(token, body) {
  const url = `${apiBase()}/users`;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw offline(url, error);
  }
  return { status: response.status, body: await readJson(response) };
}

async function getUsers(token) {
  const url = `${apiBase()}/users`;
  let response;
  try {
    response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  } catch (error) {
    throw offline(url, error);
  }
  return { status: response.status, body: await readJson(response) };
}

async function loginResult(username, password) {
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
  return { status: response.status, body: await readJson(response) };
}

async function changePassword(token, body) {
  const url = `${apiBase()}/auth/change-password`;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw offline(url, error);
  }
  return { status: response.status, body: await readJson(response) };
}

export function formatPasswordSelfProof({ newStatus = 201, webOrigin: origin = webOrigin() } = {}) {
  const base = String(origin).replace(/\/$/, '');
  return [
    `超管: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`,
    `账号: ${SELF_USERNAME}`,
    `旧密码: ${SELF_OLD_PASSWORD}`,
    `新密码: ${SELF_NEW_PASSWORD}`,
    '改密: 200',
    '旧密码登录: 401',
    `新密码登录: ${newStatus}`,
    `登录页: ${base}/login`,
    `修改密码页: ${base}/account/password`,
    `登录成功后: ${base}/`,
    `当前账号: ${SELF_USERNAME}`,
  ].join('\n');
}

export async function showPasswordSelf() {
  const adminSession = await loginAs(ADMIN_USERNAME, ADMIN_PASSWORD);
  const token = adminSession.accessToken;
  let listed = await getUsers(token);
  if (listed.status !== 200) throw new Error(`读取用户列表失败 ${listed.status}。`);
  let row = findRow(listed.body);
  if (!row) {
    const created = await postUsers(token, createBody());
    if (created.status !== 201 && !isConflict(created)) {
      throw new Error(
        `新建 ${SELF_USERNAME} 失败 ${created.status} ${messageText(created.body) || JSON.stringify(created.body)}。`,
      );
    }
    if (JSON.stringify(created.body ?? {}).includes(SELF_OLD_PASSWORD)) {
      throw new Error('新建响应带回了密码。');
    }
    listed = await getUsers(token);
    if (listed.status !== 200) throw new Error(`新建后读取用户列表失败 ${listed.status}。`);
    row = findRow(listed.body);
    if (!row?.id) throw new Error(`用户列表应含 ${SELF_USERNAME}。`);
  } else {
    const beforeId = row.id;
    const restored = await postUsers(token, restoreBody());
    if (restored.status !== 201) {
      throw new Error(
        `写回 ${SELF_USERNAME} 的旧密码失败 ${restored.status} ${messageText(restored.body) || JSON.stringify(restored.body)}。`,
      );
    }
    if (restored.body?.id && restored.body.id !== beforeId) throw new Error('写回旧密码不应另建一行。');
    listed = await getUsers(token);
    if (listed.status !== 200) throw new Error(`写回后读取用户列表失败 ${listed.status}。`);
    row = findRow(listed.body);
    if (!row || row.id !== beforeId) throw new Error('写回旧密码不应另建一行。');
  }
  const beforeId = row.id;
  const ready = await loginResult(SELF_USERNAME, SELF_OLD_PASSWORD);
  if (ready.status !== 200 && ready.status !== 201) {
    throw new Error(`改密前旧密码应能登录，实际 ${ready.status}。`);
  }
  const changed = await changePassword(ready.body.accessToken, changeBody());
  if (changed.status !== 200) {
    throw new Error(
      `改密失败 ${changed.status} ${messageText(changed.body) || JSON.stringify(changed.body)}。`,
    );
  }
  assertChangeResponse(changed.body);
  const stale = await loginResult(SELF_USERNAME, SELF_OLD_PASSWORD);
  const fresh = await loginResult(SELF_USERNAME, SELF_NEW_PASSWORD);
  assertLoginContrast({
    oldStatus: stale.status,
    newStatus: fresh.status,
    newBody: fresh.body,
  });
  const after = await getUsers(token);
  if (after.status !== 200) throw new Error(`改密后读取用户列表失败 ${after.status}。`);
  const kept = findRow(after.body);
  if (!kept || kept.id !== beforeId) throw new Error('改密不应另建一行。');
  assertPasswordPage();
  assertPasswordNav();
  return { newStatus: fresh.status };
}

function usage() {
  return `用法:
  node scripts/demo-password-self.mjs

用种子超管 ${ADMIN_USERNAME} / ${ADMIN_PASSWORD} 准备 ${SELF_USERNAME}。
还没有这个用户名时，用旧密码 ${SELF_OLD_PASSWORD} 新建（查看，棚号 ${SELF_SHED}）。
已经有则用现有 resetPassword 写回旧密码，不另建一行。
再由该账号 POST /auth/change-password，把密码改成 ${SELF_NEW_PASSWORD}。
改密接口是 200。旧密码登录是 401，新密码登录成功。
不改 admin、viewer、producer、shedlead。不发识别，不发心跳，不改告警。
步骤见 docs/DEMO_PASSWORD_SELF.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await showPasswordSelf();
    process.stdout.write(`${formatPasswordSelfProof({ newStatus: result.newStatus })}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
