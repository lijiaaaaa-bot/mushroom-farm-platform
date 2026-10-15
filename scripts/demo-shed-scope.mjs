#!/usr/bin/env node
/**
 * 同一库里对照超管与棚区负责人的可见棚。
 * 超管看到 S01 与 S02；shedlead 只保留负责棚 S01。
 * 棚列表、总览棚数、告警列表三处同时核对。
 * 不发识别，不发心跳，不改接入观测。不改 admin、producer、viewer。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { apiBase, repoRoot } from './lib/ingest-wire.mjs';
import { ADMIN_PASSWORD, ADMIN_USERNAME, loginAs } from './demo-rbac.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';

export const SHEDLEAD_USERNAME = 'shedlead';
export const SHEDLEAD_PASSWORD = 'Shed@123456';
export const SHEDLEAD_NAME = '一号棚负责人';
export const ASSIGNED_SHED = 'S01';
export const OTHER_SHED = 'S02';
export const ASSIGNED_TITLE = '棚范围一号棚';
export const OTHER_TITLE = '棚范围二号棚';
export const ASSIGNED_CAMERA = 'CAM-SCOPE-S01';
export const OTHER_CAMERA = 'CAM-SCOPE-S02';

export function shedleadBody() {
  return {
    username: SHEDLEAD_USERNAME,
    password: SHEDLEAD_PASSWORD,
    displayName: SHEDLEAD_NAME,
    role: 'shed_manager',
    shedCodes: [ASSIGNED_SHED],
    resetPassword: true,
  };
}

export function scopeAlertBody(shedCode, now = new Date()) {
  if (shedCode === ASSIGNED_SHED) {
    return {
      shedCode: ASSIGNED_SHED,
      cameraCode: ASSIGNED_CAMERA,
      level: 'warning',
      title: ASSIGNED_TITLE,
      message: `棚区 ${ASSIGNED_SHED} 负责人可见`,
      createdAt: now.toISOString(),
    };
  }
  if (shedCode === OTHER_SHED) {
    return {
      shedCode: OTHER_SHED,
      cameraCode: OTHER_CAMERA,
      level: 'warning',
      title: OTHER_TITLE,
      message: `棚区 ${OTHER_SHED} 仅全场角色可见`,
      createdAt: now.toISOString(),
    };
  }
  throw new Error(`演示告警只写 ${ASSIGNED_SHED} 与 ${OTHER_SHED}。`);
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

function codesOf(body) {
  const rows = Array.isArray(body) ? body : [];
  return rows.map((row) => row?.code).filter((code) => typeof code === 'string');
}

function alertRows(body) {
  return Array.isArray(body?.items) ? body.items : [];
}

function hasAlert(rows, title, shedCode) {
  return rows.some((row) => row?.title === title && row?.shedCode === shedCode);
}

export function assertShedScopeContrast({
  adminSession,
  leadSession,
  sheds,
  overviews,
  alerts,
}) {
  if (adminSession?.user?.role !== 'super_admin' || adminSession.user.username !== ADMIN_USERNAME) {
    throw new Error(`超管登录角色是 ${adminSession?.user?.role || '空'}，应为 super_admin。`);
  }
  if (leadSession?.user?.role !== 'shed_manager' || leadSession.user.username !== SHEDLEAD_USERNAME) {
    throw new Error(`棚区负责人登录角色是 ${leadSession?.user?.role || '空'}，应为 shed_manager。`);
  }
  const sessionSheds = leadSession.user.shedCodes ?? [];
  if (!sessionSheds.includes(ASSIGNED_SHED) || sessionSheds.includes(OTHER_SHED)) {
    throw new Error(`登录返回的负责棚应为 ${ASSIGNED_SHED}，实际是 ${JSON.stringify(sessionSheds)}。`);
  }

  const adminCodes = codesOf(sheds.adminBody);
  const leadCodes = codesOf(sheds.leadBody);
  if (!adminCodes.includes(ASSIGNED_SHED) || !adminCodes.includes(OTHER_SHED) || adminCodes.length < 2) {
    throw new Error(
      `超管棚列表应至少含 ${ASSIGNED_SHED} 和 ${OTHER_SHED}，实际是 ${adminCodes.join('、') || '空'}。确认种子棚已写入。`,
    );
  }
  if (leadCodes.length !== 1 || leadCodes[0] !== ASSIGNED_SHED || leadCodes.includes(OTHER_SHED)) {
    throw new Error(`负责人棚列表应只有 ${ASSIGNED_SHED}，实际是 ${leadCodes.join('、') || '空'}。`);
  }

  const adminCount = overviews.adminBody?.shedCount;
  const leadCount = overviews.leadBody?.shedCount;
  if (typeof adminCount !== 'number' || adminCount < 2) {
    throw new Error(`超管总览棚数应至少为 2，实际是 ${adminCount ?? '空'}。`);
  }
  if (leadCount !== 1) {
    throw new Error(`负责人总览棚数应为 1，实际是 ${leadCount ?? '空'}。`);
  }
  const leadRecent = Array.isArray(overviews.leadBody?.recentAlerts) ? overviews.leadBody.recentAlerts : [];
  if (leadRecent.some((row) => row?.shedCode === OTHER_SHED)) {
    throw new Error(`负责人总览最近告警含 ${OTHER_SHED}。`);
  }

  const adminItems = alertRows(alerts.adminBody);
  const leadItems = alertRows(alerts.leadBody);
  if (!hasAlert(adminItems, ASSIGNED_TITLE, ASSIGNED_SHED) || !hasAlert(adminItems, OTHER_TITLE, OTHER_SHED)) {
    throw new Error(`超管告警列表应同时有「${ASSIGNED_TITLE}」和「${OTHER_TITLE}」。`);
  }
  if (leadItems.some((row) => row?.shedCode === OTHER_SHED) || hasAlert(leadItems, OTHER_TITLE, OTHER_SHED)) {
    throw new Error(`负责人告警列表含 ${OTHER_SHED}。`);
  }
  if (!hasAlert(leadItems, ASSIGNED_TITLE, ASSIGNED_SHED)) {
    throw new Error(`负责人告警列表应有「${ASSIGNED_TITLE}」。`);
  }
  const adminOther = alertRows(alerts.adminOtherBody);
  const leadOther = alertRows(alerts.leadOtherBody);
  if (!hasAlert(adminOther, OTHER_TITLE, OTHER_SHED)) {
    throw new Error(`超管按标题搜索应看到「${OTHER_TITLE}」。`);
  }
  if (leadOther.length !== 0 || (alerts.leadOtherBody?.total ?? 0) !== 0) {
    throw new Error(`负责人按标题搜索「${OTHER_TITLE}」应为空。`);
  }

  return { adminCodes, leadCodes, adminCount, leadCount };
}

export function assertScopePages(sources) {
  const sheds = sources?.sheds ?? readFileSync(join(repoRoot(), 'apps/web/src/views/ShedsView.vue'), 'utf8');
  const duty = sources?.duty ?? readFileSync(join(repoRoot(), 'apps/web/src/views/DutyScreenView.vue'), 'utf8');
  const alerts = sources?.alerts ?? readFileSync(join(repoRoot(), 'apps/web/src/views/AlertsView.vue'), 'utf8');
  const screen = sources?.screen ?? readFileSync(join(repoRoot(), 'apps/web/src/views/BigScreenView.vue'), 'utf8');
  if (!sheds.includes('row.code') || !sheds.includes('编号')) {
    throw new Error('棚区页应写出棚编号。');
  }
  if (!duty.includes('data-shed') || !duty.includes('card.code') || !duty.includes('overview.shedCount')) {
    throw new Error('值班看板应写出棚卡编号和总览棚数。');
  }
  if (!alerts.includes('row.shedCode') || !alerts.includes('棚区')) {
    throw new Error('告警页应写出棚区列。');
  }
  if (!screen.includes('point.shed.code') || !screen.includes("http.get<ShedRow[]>('/sheds')")) {
    throw new Error('基地大屏棚点应来自棚列表。');
  }
}

export function formatShedScopeProof({
  adminCodes,
  leadCodes,
  adminCount,
  leadCount,
  webOrigin = webOriginFromEnv(),
}) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const otherQuery = encodeURIComponent(OTHER_TITLE);
  return [
    `超管: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`,
    `棚区负责人: ${SHEDLEAD_USERNAME} / ${SHEDLEAD_PASSWORD}`,
    `登录: ${origin}/login`,
    `棚列表: 超管 ${adminCodes.join('、')}；负责人 ${leadCodes.join('、')}`,
    `总览棚数: 超管 ${adminCount}；负责人 ${leadCount}`,
    `告警: 超管有「${ASSIGNED_TITLE}」「${OTHER_TITLE}」；负责人有「${ASSIGNED_TITLE}」，搜索「${OTHER_TITLE}」为空`,
    `棚区页: ${origin}/sheds`,
    `值班看板: ${origin}/duty-screen`,
    `基地大屏: ${origin}/big-screen`,
    `告警页: ${origin}/alerts`,
    `二号棚搜索: ${origin}/alerts?q=${otherQuery}`,
  ].join('\n');
}

async function requestJson(path, { token, method = 'GET', body }) {
  const url = `${apiBase()}${path}`;
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    throw offline(url, error);
  }
  return { status: response.status, body: await readJson(response) };
}

export async function ensureShedlead(adminToken) {
  const written = await requestJson('/users', {
    token: adminToken,
    method: 'POST',
    body: shedleadBody(),
  });
  if (!written.status || written.status >= 300) {
    throw new Error(
      `写入棚区负责人失败 ${written.status} ${messageText(written.body) || JSON.stringify(written.body)}。`,
    );
  }
  if (written.body.username !== SHEDLEAD_USERNAME || written.body.role !== 'shed_manager') {
    throw new Error(`棚区负责人角色是 ${written.body.role || '空'}，应为 shed_manager。`);
  }
  const codes = written.body.shedCodes ?? [];
  if (!Array.isArray(codes) || codes.includes(OTHER_SHED) || !codes.includes(ASSIGNED_SHED) || codes.length !== 1) {
    throw new Error(`棚区负责人棚号应为 ${ASSIGNED_SHED}，实际是 ${JSON.stringify(codes)}。`);
  }
  if (JSON.stringify(written.body).includes(SHEDLEAD_PASSWORD)) {
    throw new Error('写入棚区负责人的响应带回了密码。');
  }
  return written.body;
}

async function findScopeAlert(token, body) {
  const listed = await requestJson(
    `/alerts?q=${encodeURIComponent(body.title)}&pageSize=100`,
    { token },
  );
  if (listed.status !== 200) {
    throw new Error(`读取告警失败 ${listed.status} ${messageText(listed.body) || JSON.stringify(listed.body)}。`);
  }
  return alertRows(listed.body).find(
    (row) => row?.title === body.title && row?.shedCode === body.shedCode && row?.cameraCode === body.cameraCode,
  );
}

export async function ensureScopeAlert(token, body) {
  const existing = await findScopeAlert(token, body);
  const saved = await requestJson('/alerts', { token, method: 'POST', body });
  if (!saved.status || saved.status >= 300) {
    throw new Error(
      `写入告警「${body.title}」失败 ${saved.status} ${messageText(saved.body) || JSON.stringify(saved.body)}。`,
    );
  }
  if (saved.body?.title !== body.title || saved.body?.shedCode !== body.shedCode) {
    throw new Error(`告警「${body.title}」没有落在 ${body.shedCode}。`);
  }
  return { action: existing ? '沿用' : '新建', alert: saved.body };
}

export async function showShedScope(now = new Date()) {
  const adminSession = await loginAs(ADMIN_USERNAME, ADMIN_PASSWORD);
  await ensureShedlead(adminSession.accessToken);
  const stamped = now instanceof Date ? now : new Date(now);
  const assigned = scopeAlertBody(ASSIGNED_SHED, stamped);
  const other = scopeAlertBody(OTHER_SHED, stamped);
  const assignedWrite = await ensureScopeAlert(adminSession.accessToken, assigned);
  const otherWrite = await ensureScopeAlert(adminSession.accessToken, other);
  const leadSession = await loginAs(SHEDLEAD_USERNAME, SHEDLEAD_PASSWORD);
  const [
    adminSheds,
    leadSheds,
    adminOverview,
    leadOverview,
    adminAlerts,
    leadAlerts,
    adminOther,
    leadOther,
  ] = await Promise.all([
    requestJson('/sheds', { token: adminSession.accessToken }),
    requestJson('/sheds', { token: leadSession.accessToken }),
    requestJson('/dashboard/overview', { token: adminSession.accessToken }),
    requestJson('/dashboard/overview', { token: leadSession.accessToken }),
    requestJson('/alerts?pageSize=100', { token: adminSession.accessToken }),
    requestJson('/alerts?pageSize=100', { token: leadSession.accessToken }),
    requestJson(`/alerts?q=${encodeURIComponent(OTHER_TITLE)}&pageSize=100`, { token: adminSession.accessToken }),
    requestJson(`/alerts?q=${encodeURIComponent(OTHER_TITLE)}&pageSize=100`, { token: leadSession.accessToken }),
  ]);
  for (const part of [adminSheds, leadSheds, adminOverview, leadOverview, adminAlerts, leadAlerts, adminOther, leadOther]) {
    if (part.status !== 200) {
      throw new Error(`对照读取失败 ${part.status} ${messageText(part.body) || JSON.stringify(part.body)}。`);
    }
  }
  const contrast = assertShedScopeContrast({
    adminSession,
    leadSession,
    sheds: { adminBody: adminSheds.body, leadBody: leadSheds.body },
    overviews: { adminBody: adminOverview.body, leadBody: leadOverview.body },
    alerts: {
      adminBody: adminAlerts.body,
      leadBody: leadAlerts.body,
      adminOtherBody: adminOther.body,
      leadOtherBody: leadOther.body,
    },
  });
  assertScopePages();
  return {
    ...contrast,
    assignedAction: assignedWrite.action,
    otherAction: otherWrite.action,
  };
}

function usage() {
  return `用法:
  node scripts/demo-shed-scope.mjs

用种子超管登录，把棚区负责人写成 ${SHEDLEAD_USERNAME} / ${SHEDLEAD_PASSWORD}（棚号 ${ASSIGNED_SHED}）。
再留下「${ASSIGNED_TITLE}」和「${OTHER_TITLE}」，核对棚列表、总览棚数和告警列表。
不发识别，不发心跳，不改接入观测。
步骤见 docs/DEMO_SHED_SCOPE.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await showShedScope();
    const proof = formatShedScopeProof(result);
    process.stdout.write(
      `${proof}\n告警 ${ASSIGNED_TITLE}: ${result.assignedAction}\n告警 ${OTHER_TITLE}: ${result.otherAction}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
