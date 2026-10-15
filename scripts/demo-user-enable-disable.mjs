#!/usr/bin/env node
/**
 * 超管在用户页启停一条已有演示账号。
 * 停用前列表启用列是启用，正确密码能登录。
 * 停用后同一行启用列是停用，同一密码登录是 401。
 * 不改 admin、viewer、user-create-demo、user-reset-demo 的密码。
 * 不发识别，不发心跳，不改告警。
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { apiBase, repoRoot } from './lib/ingest-wire.mjs';
import { ADMIN_PASSWORD, ADMIN_USERNAME, loginAs } from './demo-rbac.mjs';

const require = createRequire(import.meta.url);

export const ENABLE_USERNAME = 'user-enable-demo';
export const ENABLE_PASSWORD = 'Enable@123456';
export const ENABLE_DISPLAY_NAME = '启停演示';
export const ENABLE_ROLE = 'viewer';
export const ENABLE_SHED = 'S01';

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function createBody() {
  return {
    username: ENABLE_USERNAME,
    password: ENABLE_PASSWORD,
    displayName: ENABLE_DISPLAY_NAME,
    role: ENABLE_ROLE,
    shedCodes: [ENABLE_SHED],
  };
}

export function enabledBody(enabled) {
  return { enabled };
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
  for (const secret of [ENABLE_PASSWORD, ADMIN_PASSWORD]) {
    if (serialized.includes(secret)) throw new Error('用户列表带回了密码。');
  }
}

function parsedRow(row) {
  const parsed = contracts().parseUserListItem(row);
  if (!parsed.ok) {
    throw new Error(`用户列表行不符合契约：${parsed.errors.join('；')}`);
  }
  return parsed.value;
}

export function assertEnabledRow(row, { fresh, enabled }) {
  assertNoSecret(row);
  const value = parsedRow(row);
  if (value.username !== ENABLE_USERNAME) {
    throw new Error(`用户名是 ${value.username || '空'}，应为 ${ENABLE_USERNAME}。`);
  }
  if (value.enabled !== enabled) {
    throw new Error(`启用列应是${enabled ? '启用' : '停用'}。`);
  }
  if (fresh) {
    if (value.displayName !== ENABLE_DISPLAY_NAME) {
      throw new Error(`显示名是 ${value.displayName || '空'}，应为 ${ENABLE_DISPLAY_NAME}。`);
    }
    if (value.role !== ENABLE_ROLE) {
      throw new Error(`角色是 ${value.role || '空'}，应为 ${ENABLE_ROLE}。`);
    }
    if (!value.shedCodes.includes(ENABLE_SHED)) {
      throw new Error(`棚号应含 ${ENABLE_SHED}。`);
    }
  }
  return value;
}

export function assertEnabledFlip(beforeRow, afterRow, patchBody) {
  const patch = contracts().parseSetUserEnabled(patchBody);
  if (!patch.ok || patch.value.enabled !== false) {
    throw new Error('停用请求应只带 enabled: false。');
  }
  const before = assertEnabledRow(beforeRow, { fresh: false, enabled: true });
  const after = assertEnabledRow(afterRow, { fresh: false, enabled: false });
  if (!before.id || before.id !== after.id) throw new Error('启停不应另建一行。');
  if (before.username !== after.username) throw new Error('启停不应改用户名。');
  if (before.displayName !== after.displayName || before.role !== after.role) {
    throw new Error('启停不应改显示名或角色。');
  }
  if (JSON.stringify(before.shedCodes) !== JSON.stringify(after.shedCodes)) {
    throw new Error('启停不应改棚号。');
  }
  return { before, after };
}

export function assertLoginContrast({ enabledStatus, disabledStatus }) {
  if (enabledStatus !== 200 && enabledStatus !== 201) {
    throw new Error(
      `启用时 ${ENABLE_USERNAME} 应能登录，实际 ${enabledStatus}。本命令不改已有密码。`,
    );
  }
  if (disabledStatus !== 401) {
    throw new Error(`停用后登录应是 401，实际 ${disabledStatus}。`);
  }
}

export function assertUsersPageCanToggle(source) {
  const text = source ?? readFileSync(join(repoRoot(), 'apps/web/src/views/UsersView.vue'), 'utf8');
  if (!text.includes('<th>启用</th>') || !text.includes('data-field="enabled"')) {
    throw new Error('用户页应有启用列。');
  }
  if (!text.includes("row.enabled ? '启用' : '停用'")) {
    throw new Error('启用列应写出启用或停用。');
  }
  if (!text.includes('text-accent') || !text.includes('text-danger')) {
    throw new Error('启用和停用应能从字色区分。');
  }
  if (!text.includes('http.patch') || !text.includes('{ enabled }')) {
    throw new Error('用户页应提交启停。');
  }
  if (!text.includes('currentUser') || !text.includes('isSelf')) {
    throw new Error('用户页不应让当前账号停用自己。');
  }
  if (!text.includes("row.enabled ? '停用' : '启用'")) {
    throw new Error('用户页应有停用和启用按钮。');
  }
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

async function patchEnabled(token, id, enabled) {
  const url = `${apiBase()}/users/${id}`;
  let response;
  try {
    response = await fetch(url, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(enabledBody(enabled)),
    });
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

function findRow(rows) {
  if (!Array.isArray(rows)) throw new Error('用户列表不是数组。');
  assertNoSecret(rows);
  return rows.find((item) => item?.username === ENABLE_USERNAME) ?? null;
}

export function formatUserEnableDisableProof({ webOrigin: origin = webOrigin() } = {}) {
  const base = String(origin).replace(/\/$/, '');
  return [
    `超管: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`,
    `账号: ${ENABLE_USERNAME} / ${ENABLE_PASSWORD}`,
    '启停前: 启用',
    '启停后: 停用',
    '停用后登录: 401',
    `登录: ${base}/login`,
    `用户页: ${base}/users`,
    `启用列: ${ENABLE_USERNAME}`,
  ].join('\n');
}

export async function showUserEnableDisable() {
  const adminSession = await loginAs(ADMIN_USERNAME, ADMIN_PASSWORD);
  const token = adminSession.accessToken;
  let listed = await getUsers(token);
  if (listed.status !== 200) throw new Error(`读取用户列表失败 ${listed.status}。`);
  let row = findRow(listed.body);
  let fresh = false;
  if (!row) {
    const created = await postUsers(token, createBody());
    fresh = created.status === 201;
    if (!fresh && !isConflict(created)) {
      throw new Error(
        `新建 ${ENABLE_USERNAME} 失败 ${created.status} ${messageText(created.body) || JSON.stringify(created.body)}。`,
      );
    }
    if (JSON.stringify(created.body ?? {}).includes(ENABLE_PASSWORD)) {
      throw new Error('新建响应带回了密码。');
    }
    listed = await getUsers(token);
    if (listed.status !== 200) throw new Error(`新建后读取用户列表失败 ${listed.status}。`);
    row = findRow(listed.body);
    if (!row) throw new Error(`用户列表应含 ${ENABLE_USERNAME}。`);
  }
  if (row.enabled !== true) {
    const turnedOn = await patchEnabled(token, row.id, true);
    if (turnedOn.status !== 200) {
      throw new Error(
        `启用 ${ENABLE_USERNAME} 失败 ${turnedOn.status} ${messageText(turnedOn.body) || JSON.stringify(turnedOn.body)}。`,
      );
    }
    listed = await getUsers(token);
    if (listed.status !== 200) throw new Error(`启用后读取用户列表失败 ${listed.status}。`);
    row = findRow(listed.body);
    if (!row) throw new Error(`启用后列表应仍有 ${ENABLE_USERNAME}。`);
  }
  const before = assertEnabledRow(row, { fresh, enabled: true });
  const enabledLogin = await loginResult(ENABLE_USERNAME, ENABLE_PASSWORD);
  if (enabledLogin.status !== 200 && enabledLogin.status !== 201) {
    throw new Error(
      `启用时 ${ENABLE_USERNAME} 应能登录，实际 ${enabledLogin.status}。本命令不改已有密码。`,
    );
  }
  const patch = await patchEnabled(token, before.id, false);
  if (patch.status !== 200) {
    throw new Error(
      `停用 ${ENABLE_USERNAME} 失败 ${patch.status} ${messageText(patch.body) || JSON.stringify(patch.body)}。`,
    );
  }
  const afterList = await getUsers(token);
  if (afterList.status !== 200) throw new Error(`停用后读取用户列表失败 ${afterList.status}。`);
  const afterRow = findRow(afterList.body);
  if (!afterRow) throw new Error(`停用后列表应仍有 ${ENABLE_USERNAME}。`);
  const flipped = assertEnabledFlip(before, afterRow, enabledBody(false));
  const disabledLogin = await loginResult(ENABLE_USERNAME, ENABLE_PASSWORD);
  assertLoginContrast({
    enabledStatus: enabledLogin.status,
    disabledStatus: disabledLogin.status,
  });
  assertUsersPageCanToggle();
  return { fresh, before: flipped.before, after: flipped.after };
}

function usage() {
  return `用法:
  node scripts/demo-user-enable-disable.mjs

用种子超管 ${ADMIN_USERNAME} / ${ADMIN_PASSWORD} 登录。
保证 ${ENABLE_USERNAME} / ${ENABLE_PASSWORD}（查看，棚号 ${ENABLE_SHED}）。
还没有这个用户名时新建。已有则不改密码、显示名、角色和棚号。
先确认启用列是启用且该密码能登录，再停用。
停用后同一行仍在，启用列是停用，同一密码登录是 401。
不改 viewer、admin、user-create-demo、user-reset-demo。不发识别，不发心跳，不改告警。
步骤见 docs/DEMO_USER_ENABLE_DISABLE.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    await showUserEnableDisable();
    process.stdout.write(`${formatUserEnableDisableProof()}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
