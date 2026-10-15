#!/usr/bin/env node
/**
 * 超管触发一次 Postgres 备份，备份页的最近成功时间从空或更早变为这次。
 * 查看调用同一接口是 403。
 * 不发识别，不发心跳，不改告警。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { apiBase, repoRoot } from './lib/ingest-wire.mjs';
import { ADMIN_PASSWORD, ADMIN_USERNAME, VIEWER_PASSWORD, VIEWER_USERNAME, loginAs } from './demo-rbac.mjs';

const require = createRequire(import.meta.url);

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
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

export function assertBackupAdvanced(beforeRaw, afterRaw) {
  const before = contracts().parseBackupStatus(beforeRaw);
  const after = contracts().parseBackupStatus(afterRaw);
  if (!before.ok) throw new Error(`备份前状态不符合契约：${before.errors.join('；')}`);
  if (!after.ok) throw new Error(`备份后状态不符合契约：${after.errors.join('；')}`);
  const serialized = JSON.stringify(afterRaw);
  if (/postgres(?:ql)?:\/\//i.test(serialized) || /password/i.test(serialized)) {
    throw new Error('备份状态带回了连接串或密码。');
  }
  if (after.value.lastStatus !== 'success') {
    throw new Error(
      `最近一次应是成功，实际 ${after.value.lastStatus}。${after.value.lastError || ''}`.trim(),
    );
  }
  if (!after.value.lastSuccessAt) throw new Error('最近成功时间是空的。');
  if (before.value.lastSuccessAt && !(Date.parse(after.value.lastSuccessAt) > Date.parse(before.value.lastSuccessAt))) {
    throw new Error('最近成功时间没有更新。');
  }
  if (!/^mushroom-.*\.sql$/.test(after.value.lastFileName || '')) {
    throw new Error(`文件名是 ${after.value.lastFileName || '空'}，应为 mushroom-*.sql。`);
  }
  if (after.value.triggeredBy !== ADMIN_USERNAME) {
    throw new Error(`触发人是 ${after.value.triggeredBy || '空'}，应为 ${ADMIN_USERNAME}。`);
  }
  return { before: before.value, after: after.value };
}

export function assertBackupPage(source) {
  const text = source ?? readFileSync(join(repoRoot(), 'apps/web/src/views/BackupView.vue'), 'utf8');
  if (!text.includes('数据备份') || !text.includes('尚未成功备份')) {
    throw new Error('备份页应写出尚未成功备份。');
  }
  if (!text.includes('data-field="lastSuccessAt"') || !text.includes('data-field="lastStatus"')) {
    throw new Error('备份页应标出最近成功时间和最近一次结果。');
  }
  if (!text.includes('立即备份') || !text.includes("'/backups/run'")) {
    throw new Error('备份页应能立即备份。');
  }
  if (!text.includes('本次备份成功') || !text.includes('本次备份失败')) {
    throw new Error('备份页应写出本次备份成功或失败。');
  }
  if (!text.includes('text-accent') || !text.includes('text-danger')) {
    throw new Error('成功和失败应能从字色区分。');
  }
}

export function assertBackupNav(source) {
  const text = source ?? readFileSync(join(repoRoot(), 'apps/web/src/admin-nav.json'), 'utf8');
  const links = JSON.parse(text);
  const link = links.find((item) => item.to === '/backup');
  if (!link || link.label !== '数据备份') throw new Error('侧栏应有数据备份。');
  if (JSON.stringify(link.roles) !== JSON.stringify(['super_admin'])) {
    throw new Error('数据备份只给超管。');
  }
}

export function formatBackupRunProof({ before, after, viewerStatus, webOrigin: origin = webOrigin() }) {
  const base = String(origin).replace(/\/$/, '');
  return [
    `超管: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`,
    `最近成功（前）: ${before.lastSuccessAt ?? '尚未成功备份'}`,
    `最近成功（后）: ${after.lastSuccessAt}`,
    '最近一次: 成功',
    `文件: ${after.lastFileName}`,
    `触发人: ${after.triggeredBy}`,
    `查看接口: ${viewerStatus}`,
    `登录: ${base}/login`,
    `备份页: ${base}/backup`,
  ].join('\n');
}

async function requestJson(path, { token, method = 'GET' }) {
  const url = `${apiBase()}${path}`;
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (error) {
    throw offline(url, error);
  }
  return { status: response.status, body: await readJson(response) };
}

export async function showBackupRun() {
  const admin = await loginAs(ADMIN_USERNAME, ADMIN_PASSWORD);
  const beforeRes = await requestJson('/backups/status', { token: admin.accessToken });
  if (beforeRes.status !== 200) {
    throw new Error(`读取备份状态失败 ${beforeRes.status} ${messageText(beforeRes.body)}。`);
  }
  const started = await requestJson('/backups/run', { token: admin.accessToken, method: 'POST' });
  if (started.status !== 200 && started.status !== 201) {
    throw new Error(`立即备份失败 ${started.status} ${messageText(started.body) || JSON.stringify(started.body)}。`);
  }
  const afterRes = await requestJson('/backups/status', { token: admin.accessToken });
  if (afterRes.status !== 200) {
    throw new Error(`备份后读取状态失败 ${afterRes.status} ${messageText(afterRes.body)}。`);
  }
  const advanced = assertBackupAdvanced(beforeRes.body, afterRes.body);
  const viewer = await loginAs(VIEWER_USERNAME, VIEWER_PASSWORD);
  const viewerGet = await requestJson('/backups/status', { token: viewer.accessToken });
  const viewerPost = await requestJson('/backups/run', { token: viewer.accessToken, method: 'POST' });
  if (viewerGet.status !== 403 || viewerPost.status !== 403) {
    throw new Error(`查看调用备份接口应是 403，实际读取 ${viewerGet.status}、触发 ${viewerPost.status}。`);
  }
  assertBackupPage();
  assertBackupNav();
  return { ...advanced, viewerStatus: viewerGet.status };
}

function usage() {
  return `用法:
  node scripts/demo-backup-run.mjs

用种子超管 ${ADMIN_USERNAME} / ${ADMIN_PASSWORD} 登录。
先读 GET /api/v1/backups/status，再 POST /api/v1/backups/run。
最近成功时间从空或更早变为这次成功时间。最近一次是成功。
查看 ${VIEWER_USERNAME} / ${VIEWER_PASSWORD} 读取和触发都是 403。
不改用户密码。不发识别，不发心跳，不改告警。不改接入观测。
本机需要 pg_dump 或 docker 里的 Postgres，否则这次备份失败，命令退出码非 0，页面上最近一次是失败。
步骤见 docs/DEMO_BACKUP_RUN.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await showBackupRun();
    process.stdout.write(`${formatBackupRunProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
