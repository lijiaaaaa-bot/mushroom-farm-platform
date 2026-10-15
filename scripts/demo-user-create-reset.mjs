#!/usr/bin/env node
/**
 * 超管用现有 POST /api/v1/users 新建一条演示账号，再对另一条已有账号重设密码。
 * 新建后 GET /users 含这一行，且不含密码。
 * 重设后同一行仍在；新密码能登录，旧密码是 401。
 * 不改 viewer / admin / producer / shedlead。不发识别，不发心跳，不改告警。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { apiBase, repoRoot } from './lib/ingest-wire.mjs';
import { ADMIN_PASSWORD, ADMIN_USERNAME, loginAs } from './demo-rbac.mjs';

export const CREATE_USERNAME = 'user-create-demo';
export const CREATE_PASSWORD = 'Create@123456';
export const CREATE_DISPLAY_NAME = '新建演示';
export const CREATE_ROLE = 'viewer';
export const CREATE_SHED = 'S01';

export const RESET_USERNAME = 'user-reset-demo';
export const RESET_OLD_PASSWORD = 'ResetOld@123456';
export const RESET_NEW_PASSWORD = 'ResetNew@123456';
export const RESET_DISPLAY_NAME = '重设演示';
export const RESET_ROLE = 'viewer';
export const RESET_SHED = 'S02';

export function createBody() {
  return {
    username: CREATE_USERNAME,
    password: CREATE_PASSWORD,
    displayName: CREATE_DISPLAY_NAME,
    role: CREATE_ROLE,
    shedCodes: [CREATE_SHED],
  };
}

export function resetSeedBody() {
  return {
    username: RESET_USERNAME,
    password: RESET_OLD_PASSWORD,
    displayName: RESET_DISPLAY_NAME,
    role: RESET_ROLE,
    shedCodes: [RESET_SHED],
  };
}

export function resetBody() {
  return {
    username: RESET_USERNAME,
    password: RESET_NEW_PASSWORD,
    displayName: RESET_DISPLAY_NAME,
    role: RESET_ROLE,
    shedCodes: [RESET_SHED],
    resetPassword: true,
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
  for (const secret of [CREATE_PASSWORD, RESET_OLD_PASSWORD, RESET_NEW_PASSWORD, ADMIN_PASSWORD]) {
    if (serialized.includes(secret)) throw new Error('用户列表带回了密码。');
  }
}

export function assertCreateRow(rows, { fresh }) {
  if (!Array.isArray(rows)) throw new Error('用户列表不是数组。');
  assertNoSecret(rows);
  const row = rows.find((item) => item?.username === CREATE_USERNAME);
  if (!row) throw new Error(`用户列表应含 ${CREATE_USERNAME}。`);
  if (fresh) {
    if (row.displayName !== CREATE_DISPLAY_NAME) {
      throw new Error(`新建账号显示名是 ${row.displayName || '空'}，应为 ${CREATE_DISPLAY_NAME}。`);
    }
    if (row.role !== CREATE_ROLE) {
      throw new Error(`新建账号角色是 ${row.role || '空'}，应为 ${CREATE_ROLE}。`);
    }
    if (!Array.isArray(row.shedCodes) || !row.shedCodes.includes(CREATE_SHED)) {
      throw new Error(`新建账号棚号应含 ${CREATE_SHED}。`);
    }
    if (row.enabled !== true) throw new Error('新建账号应为启用。');
  }
  return row;
}

export function assertResetKept(beforeRows, afterRows, resetResponse) {
  if (!Array.isArray(beforeRows) || !Array.isArray(afterRows)) throw new Error('用户列表不是数组。');
  assertNoSecret(afterRows);
  const before = beforeRows.find((item) => item?.username === RESET_USERNAME);
  const after = afterRows.find((item) => item?.username === RESET_USERNAME);
  if (!before || !after) throw new Error(`重设后列表应仍有 ${RESET_USERNAME}。`);
  if (!before.id || before.id !== after.id) throw new Error('重设密码不应另建一行。');
  if (resetResponse?.id && resetResponse.id !== after.id) throw new Error('重设密码不应另建一行。');
  if (afterRows.length !== beforeRows.length) throw new Error('重设密码不应另建一行。');
  if (after.displayName !== RESET_DISPLAY_NAME || after.role !== RESET_ROLE) {
    throw new Error(`重设后显示名或角色不对：${after.displayName || '空'} / ${after.role || '空'}。`);
  }
  if (!Array.isArray(after.shedCodes) || !after.shedCodes.includes(RESET_SHED)) {
    throw new Error(`重设后棚号应含 ${RESET_SHED}。`);
  }
  if (after.enabled !== true) throw new Error('重设后账号应为启用。');
  if (!afterRows.some((item) => item?.username === CREATE_USERNAME)) {
    throw new Error(`重设后列表仍应含 ${CREATE_USERNAME}。`);
  }
  if (JSON.stringify(resetResponse ?? {}).includes(RESET_NEW_PASSWORD)) {
    throw new Error('重设响应带回了密码。');
  }
  return after;
}

export function assertLoginContrast({ freshStatus, freshBody, staleStatus }) {
  if (freshStatus !== 200 && freshStatus !== 201) {
    throw new Error(`新密码登录应成功，实际 ${freshStatus}。`);
  }
  if (!freshBody?.accessToken || freshBody?.user?.username !== RESET_USERNAME) {
    throw new Error(`新密码登录的用户是 ${freshBody?.user?.username || '空'}，应为 ${RESET_USERNAME}。`);
  }
  if (staleStatus !== 401) throw new Error(`旧密码登录应是 401，实际 ${staleStatus}。`);
}

export function assertUsersPageCanCreateAndReset(source) {
  const text = source ?? readFileSync(join(repoRoot(), 'apps/web/src/views/UsersView.vue'), 'utf8');
  if (!text.includes('data-testid="user-create-form"') || !text.includes('新建用户')) {
    throw new Error('用户页应有新建用户表单。');
  }
  for (const label of ['用户名', '密码', '显示名', '角色', '棚号']) {
    if (!text.includes(`aria-label="${label}"`)) throw new Error(`新建表单应有${label}。`);
  }
  if (!text.includes('resetPassword: true') || !text.includes('重设密码')) {
    throw new Error('用户页应有重设密码入口。');
  }
  if (!text.includes('type="password"')) throw new Error('密码输入不应明文。');
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

export function formatUserCreateResetProof({ webOrigin: origin = webOrigin() } = {}) {
  const base = String(origin).replace(/\/$/, '');
  return [
    `超管: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`,
    `新建: ${CREATE_USERNAME} / ${CREATE_PASSWORD}`,
    `重设账号: ${RESET_USERNAME}`,
    `旧密码: ${RESET_OLD_PASSWORD}`,
    `新密码: ${RESET_NEW_PASSWORD}`,
    '旧密码登录: 401',
    '新密码登录: 成功',
    `登录: ${base}/login`,
    `用户页: ${base}/users`,
    `列表含 ${CREATE_USERNAME}`,
    `重设后仍有 ${RESET_USERNAME}`,
  ].join('\n');
}

export async function showUserCreateReset() {
  const adminSession = await loginAs(ADMIN_USERNAME, ADMIN_PASSWORD);
  const token = adminSession.accessToken;
  const created = await postUsers(token, createBody());
  const fresh = created.status === 201;
  if (!fresh && !isConflict(created)) {
    throw new Error(
      `新建 ${CREATE_USERNAME} 失败 ${created.status} ${messageText(created.body) || JSON.stringify(created.body)}。`,
    );
  }
  if (JSON.stringify(created.body ?? {}).includes(CREATE_PASSWORD)) {
    throw new Error('新建响应带回了密码。');
  }
  const listed = await getUsers(token);
  if (listed.status !== 200) throw new Error(`读取用户列表失败 ${listed.status}。`);
  assertCreateRow(listed.body, { fresh });

  const seeded = await postUsers(token, resetSeedBody());
  if (seeded.status !== 201 && !isConflict(seeded)) {
    throw new Error(
      `准备 ${RESET_USERNAME} 失败 ${seeded.status} ${messageText(seeded.body) || JSON.stringify(seeded.body)}。`,
    );
  }
  const before = await getUsers(token);
  if (before.status !== 200) throw new Error(`重设前读取用户列表失败 ${before.status}。`);
  const reset = await postUsers(token, resetBody());
  if (reset.status !== 201) {
    throw new Error(
      `重设 ${RESET_USERNAME} 失败 ${reset.status} ${messageText(reset.body) || JSON.stringify(reset.body)}。`,
    );
  }
  const after = await getUsers(token);
  if (after.status !== 200) throw new Error(`重设后读取用户列表失败 ${after.status}。`);
  assertResetKept(before.body, after.body, reset.body);

  const freshLogin = await loginResult(RESET_USERNAME, RESET_NEW_PASSWORD);
  const staleLogin = await loginResult(RESET_USERNAME, RESET_OLD_PASSWORD);
  assertLoginContrast({
    freshStatus: freshLogin.status,
    freshBody: freshLogin.body,
    staleStatus: staleLogin.status,
  });
  assertUsersPageCanCreateAndReset();
  return { fresh, listed: after.body };
}

function usage() {
  return `用法:
  node scripts/demo-user-create-reset.mjs

用种子超管 ${ADMIN_USERNAME} / ${ADMIN_PASSWORD} 登录。
新建 ${CREATE_USERNAME} / ${CREATE_PASSWORD}（已存在则不改这一行）。
再把 ${RESET_USERNAME} 从 ${RESET_OLD_PASSWORD} 重设为 ${RESET_NEW_PASSWORD}。
已存在则不另建一行。新密码能登录，旧密码是 401。
不改 viewer、admin、producer、shedlead。不发识别，不发心跳，不改告警。
步骤见 docs/DEMO_USER_CREATE_RESET.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    await showUserCreateReset();
    process.stdout.write(`${formatUserCreateResetProof()}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
