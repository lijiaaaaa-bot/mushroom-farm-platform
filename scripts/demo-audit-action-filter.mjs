#!/usr/bin/env node
/**
 * 留下两条操作审计，时间错开，再按用户名和起止时间查询。
 * 用户 audit-action-old 在当前时刻前 3 小时；用户 audit-action-new 在当前时刻。
 * 同一用户名和资源已在时只改时间，不另留一行。
 * 不发识别，不发心跳，不改告警。不改登录日志接口。
 */
import { pathToFileURL } from 'node:url';
import { apiBase, withPg } from './lib/ingest-wire.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';

export const ADMIN_USERNAME = 'admin';
export const ADMIN_PASSWORD = 'Admin@123456';
export const OLD_USERNAME = 'audit-action-old';
export const NEW_USERNAME = 'audit-action-new';
export const DEMO_ACTION = 'harvest.correct';
export const OLD_RESOURCE = 'recognition:audit-action-old';
export const NEW_RESOURCE = 'recognition:audit-action-new';
export const TOKEN_USER_AGENT = 'audit-action-filter-demo-token/1';
export const OUTSIDE_MS = 3 * 60 * 60 * 1000;
export const WIDE_BEFORE_MS = 4 * 60 * 60 * 1000;
export const NARROW_BEFORE_MS = 30 * 60 * 1000;
export const AFTER_MS = 60 * 1000;
export const PAGE_SIZE = '100';

export const OLD_DETAIL = {
  shedCode: 'S01',
  cameraCode: 'CAM-ACT-OLD',
  changes: { matureCount: { old: 1, new: 2 } },
};

export const NEW_DETAIL = {
  shedCode: 'S02',
  cameraCode: 'CAM-ACT-NEW',
  changes: { matureCount: { old: 3, new: 4 } },
};

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

export function inWindow(value, from, to) {
  const at = new Date(value).getTime();
  return Number.isFinite(at) && at >= from.getTime() && at <= to.getTime();
}

export function sameInstant(value, date) {
  const at = new Date(value).getTime();
  return Number.isFinite(at) && at === date.getTime();
}

export function matureMark(detail) {
  const change = detail?.changes?.matureCount;
  if (!change || typeof change.old !== 'number' || typeof change.new !== 'number') return '';
  return `${change.old}→${change.new}`;
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

async function getAuditPage(token, params) {
  const url = new URL(`${apiBase()}/audit-logs`);
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
    throw new Error(`操作审计失败 ${response.status} ${messageText(body) || JSON.stringify(body)}`);
  }
  if (!Array.isArray(body.items) || !Number.isFinite(Number(body.total))) {
    throw new Error('操作审计没有 items 或 total');
  }
  return { items: body.items, total: Number(body.total) };
}

export async function listAuditLogs(token, params, { maxPages = 20 } = {}) {
  const items = [];
  let total = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    const body = await getAuditPage(token, { ...params, page: String(page), pageSize: PAGE_SIZE });
    total = body.total;
    items.push(...body.items);
    if (items.length >= total || body.items.length === 0) break;
  }
  if (items.length < total) {
    throw new Error(`操作审计超过 ${maxPages} 页，没有读完`);
  }
  return { items, total };
}

export function assertAuditSelection(items, { required = [], forbidden = [], from, to, username } = {}) {
  for (const id of required) {
    const row = items.find((item) => item.id === id);
    if (!row) throw new Error(`操作审计里没有 ${id}`);
    if (from && to && !inWindow(row.createdAt, from, to)) {
      throw new Error(`操作审计 ${id} 的时间不在窗口内`);
    }
    if (username && row.username !== username) {
      throw new Error(`操作审计 ${id} 的用户不是 ${username}`);
    }
  }
  for (const id of forbidden) {
    if (items.some((item) => item.id === id)) throw new Error(`筛选结果里仍有 ${id}`);
  }
  if (from && to) {
    const stray = items.filter((item) => !inWindow(item.createdAt, from, to));
    if (stray.length) {
      throw new Error(`筛选结果里仍有窗口外的操作审计 ${stray.map((item) => item.id).join('、')}`);
    }
  }
  if (username) {
    const stray = items.filter((item) => item.username !== username);
    if (stray.length) {
      throw new Error(`筛选结果里仍有其他用户 ${stray.map((item) => item.username).join('、')}`);
    }
  }
}

async function ensureRow(useDb, spec) {
  let created = false;
  let id;
  try {
    id = await useDb(async (db) => {
      const found = await db.query(
        'SELECT id FROM audit_logs WHERE username = $1 AND resource = $2 ORDER BY created_at DESC',
        [spec.username, spec.resource],
      );
      const existing = found?.rows?.[0]?.id;
      let kept = existing;
      if (!kept) {
        created = true;
        const inserted = await db.query(
          `INSERT INTO audit_logs (username, action, resource, detail, created_at)
           VALUES ($1, $2, $3, $4::jsonb, $5)
           RETURNING id`,
          [
            spec.username,
            spec.action,
            spec.resource,
            JSON.stringify(spec.detail),
            spec.createdAt.toISOString(),
          ],
        );
        kept = inserted?.rows?.[0]?.id;
        if (!kept) throw new Error(`没有写入操作审计 ${spec.username}`);
      } else {
        const updated = await db.query(
          `UPDATE audit_logs
           SET created_at = $1, action = $2, detail = $3::jsonb
           WHERE id = $4::uuid`,
          [spec.createdAt.toISOString(), spec.action, JSON.stringify(spec.detail), kept],
        );
        if (!updated?.rowCount) throw new Error(`没有改到操作审计 ${kept}`);
      }
      await db.query(
        'DELETE FROM audit_logs WHERE username = $1 AND resource = $2 AND id <> $3::uuid',
        [spec.username, spec.resource, kept],
      );
      return kept;
    });
  } catch (error) {
    if (String(error.message).startsWith('没有')) throw error;
    throw new Error(`操作审计没有写入数据库。先执行 make up、make migrate。${error.message}`);
  }
  return { id, created };
}

function assertPlaced(row, spec) {
  if (!row?.id) throw new Error(`操作审计里没有用户 ${spec.username}、资源 ${spec.resource}`);
  if (!sameInstant(row.createdAt, spec.createdAt)) {
    throw new Error(`用户 ${spec.username} 的操作时间不是 ${spec.createdAt.toISOString()}`);
  }
  if (row.username !== spec.username) throw new Error(`用户不是 ${spec.username}`);
  if (row.action !== spec.action) throw new Error(`动作不是 ${spec.action}`);
  if (row.resource !== spec.resource) throw new Error(`资源不是 ${spec.resource}`);
  if (matureMark(row.detail) !== matureMark(spec.detail)) {
    throw new Error(`用户 ${spec.username} 的明细不是成熟数 ${matureMark(spec.detail)}`);
  }
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

export function formatAuditActionProof({
  older,
  recent,
  clock,
  wideCount,
  narrowCount,
  userCount,
  emptyCount,
  reversedStatus,
  invalidStatus,
  webOrigin = webOriginFromEnv(),
}) {
  const lines = [
    `登录: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`,
    `操作审计: 用户 ${OLD_USERNAME}，动作 ${DEMO_ACTION}，资源 ${OLD_RESOURCE}，时间 ${older.createdAt}，明细成熟数 ${matureMark(OLD_DETAIL)}`,
    `操作审计: 用户 ${NEW_USERNAME}，动作 ${DEMO_ACTION}，资源 ${NEW_RESOURCE}，时间 ${recent.createdAt}，明细成熟数 ${matureMark(NEW_DETAIL)}`,
    `宽窗口: ${clock.wideFrom.toISOString()} 至 ${clock.to.toISOString()}`,
    `宽窗口条数: ${wideCount}`,
    `窄窗口: ${clock.narrowFrom.toISOString()} 至 ${clock.to.toISOString()}`,
    `窄窗口条数: ${narrowCount}`,
    '窄窗口少于宽窗口: 是',
    `窄窗口含 ${NEW_USERNAME}、不含 ${OLD_USERNAME}: 是`,
    `用户 ${OLD_USERNAME} 条数: ${userCount}`,
    `用户 ${OLD_USERNAME} 窄窗口条数: ${emptyCount}`,
    `开始晚于结束: ${reversedStatus}`,
    `时间填不开: ${invalidStatus}`,
    `审计页: ${auditPageUrl({}, webOrigin)}`,
    `宽窗口列表: ${auditPageUrl({ auditFrom: clock.wideFrom, auditTo: clock.to }, webOrigin)}`,
    `窄窗口列表: ${auditPageUrl({ auditFrom: clock.narrowFrom, auditTo: clock.to }, webOrigin)}`,
    `用户列表: ${auditPageUrl({ auditUsername: OLD_USERNAME }, webOrigin)}`,
    `空筛选列表: ${auditPageUrl({ auditUsername: OLD_USERNAME, auditFrom: clock.narrowFrom, auditTo: clock.to }, webOrigin)}`,
  ];
  return lines.join('\n');
}

export async function showAuditActionFilter({ now = new Date(), db } = {}) {
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
  const olderSpec = {
    username: OLD_USERNAME,
    action: DEMO_ACTION,
    resource: OLD_RESOURCE,
    detail: OLD_DETAIL,
    createdAt: clock.outsideAt,
  };
  const recentSpec = {
    username: NEW_USERNAME,
    action: DEMO_ACTION,
    resource: NEW_RESOURCE,
    detail: NEW_DETAIL,
    createdAt: clock.insideNowAt,
  };
  const olderStored = await ensureRow(useDb, olderSpec);
  const recentStored = await ensureRow(useDb, recentSpec);
  const olderListed = await listAuditLogs(token, { username: OLD_USERNAME });
  const recentListed = await listAuditLogs(token, { username: NEW_USERNAME });
  const older = olderListed.items.find((row) => row.id === olderStored.id);
  const recent = recentListed.items.find((row) => row.id === recentStored.id);
  assertPlaced(older, olderSpec);
  assertPlaced(recent, recentSpec);
  const wide = await listAuditLogs(token, { from: clock.wideFrom, to: clock.to });
  const narrow = await listAuditLogs(token, { from: clock.narrowFrom, to: clock.to });
  const byUser = await listAuditLogs(token, { username: OLD_USERNAME });
  const empty = await listAuditLogs(token, {
    username: OLD_USERNAME,
    from: clock.narrowFrom,
    to: clock.to,
  });
  assertAuditSelection(wide.items, {
    required: [older.id, recent.id],
    from: clock.wideFrom,
    to: clock.to,
  });
  assertAuditSelection(narrow.items, {
    required: [recent.id],
    forbidden: [older.id],
    from: clock.narrowFrom,
    to: clock.to,
  });
  if (!(narrow.total < wide.total)) {
    throw new Error(`窄窗口条数 ${narrow.total} 没有少于宽窗口 ${wide.total}`);
  }
  const narrowUsernames = new Set(narrow.items.map((row) => row.username));
  if (!narrowUsernames.has(NEW_USERNAME) || narrowUsernames.has(OLD_USERNAME)) {
    throw new Error(`窄窗口应含 ${NEW_USERNAME}、不含 ${OLD_USERNAME}`);
  }
  assertAuditSelection(byUser.items, {
    required: [older.id],
    forbidden: [recent.id],
    username: OLD_USERNAME,
  });
  if (byUser.total !== 1) {
    throw new Error(`用户 ${OLD_USERNAME} 的操作审计应是 1 条，实际 ${byUser.total}`);
  }
  if (empty.total !== 0 || empty.items.length !== 0) {
    throw new Error(`用户 ${OLD_USERNAME} 的窄窗口应是 0 条，实际 ${empty.total}`);
  }
  const reversed = await requestJson(
    `/audit-logs?from=${encodeURIComponent(clock.to.toISOString())}&to=${encodeURIComponent(clock.wideFrom.toISOString())}`,
    { token },
  );
  if (reversed.status !== 400) {
    throw new Error(`开始晚于结束应是 400，实际 ${reversed.status}`);
  }
  const invalid = await requestJson('/audit-logs?from=not-a-time', { token });
  if (invalid.status !== 400) {
    throw new Error(`时间填不开应是 400，实际 ${invalid.status}`);
  }
  return {
    older,
    recent,
    clock,
    wideCount: wide.total,
    narrowCount: narrow.total,
    userCount: byUser.total,
    emptyCount: empty.total,
    reversedStatus: reversed.status,
    invalidStatus: invalid.status,
    created: { older: olderStored.created, recent: recentStored.created },
  };
}

function usage() {
  return `用法:
  node scripts/demo-audit-action-filter.mjs

留下用户 ${OLD_USERNAME} 的操作审计（前 3 小时）和 ${NEW_USERNAME} 的操作审计（当前时刻）。
再按用户名和起止时间核对操作审计。
不发识别，不发心跳，不改告警。步骤见 docs/DEMO_AUDIT_ACTION_FILTER.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await showAuditActionFilter();
    process.stdout.write(`${formatAuditActionProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
