#!/usr/bin/env node
/**
 * 超管改告警未读轮询，系统参数页写出改前→改后。
 * 图片保留和时序保留不动。查看调用同一接口是 403。
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

export function nextUnreadPollSeconds(current) {
  return current === 45 ? 15 : 45;
}

export function assertParamsAdvanced(beforeRaw, afterRaw) {
  const api = contracts();
  const before = api.parseSystemParams(beforeRaw);
  const after = api.parseSystemParamsPatchResult(afterRaw);
  if (!before.ok) throw new Error(`改前参数不符合契约：${before.errors.join('；')}`);
  if (!after.ok) throw new Error(`改后参数不符合契约：${after.errors.join('；')}`);
  const expected = nextUnreadPollSeconds(before.value.alertUnreadPollSeconds);
  if (after.value.alertUnreadPollSeconds !== expected) {
    throw new Error(`告警未读轮询是 ${after.value.alertUnreadPollSeconds} 秒，应为 ${expected} 秒。`);
  }
  if (after.value.imageRetentionDays !== before.value.imageRetentionDays) {
    throw new Error('图片保留天数被改了。');
  }
  if (after.value.timeseriesRetentionDays !== before.value.timeseriesRetentionDays) {
    throw new Error('时序保留天数被改了。');
  }
  if (after.value.changes.length !== 1 || after.value.changes[0].key !== 'alertUnreadPollSeconds') {
    throw new Error('这次应只改告警未读轮询。');
  }
  const change = after.value.changes[0];
  const line = api.formatSystemParamChange(change);
  if (line !== `告警未读轮询：${change.beforeText} → ${change.afterText}`) {
    throw new Error(`前后文案是 ${line}。`);
  }
  if (!line.includes('→')) throw new Error('前后文案缺少箭头。');
  if (change.beforeText === change.afterText) throw new Error('前后秒数相同。');
  if (after.value.updatedBy !== ADMIN_USERNAME) {
    throw new Error(`修改人是 ${after.value.updatedBy || '空'}，应为 ${ADMIN_USERNAME}。`);
  }
  return { before: before.value, after: after.value, line };
}

export function assertParamsPage(source) {
  const text = source ?? readFileSync(join(repoRoot(), 'apps/web/src/views/SystemParamsView.vue'), 'utf8');
  if (!text.includes('系统参数') || !text.includes('当前')) {
    throw new Error('系统参数页应写出当前值。');
  }
  if (!text.includes('图片保留') && !text.includes('SYSTEM_PARAM_LABEL')) {
    throw new Error('系统参数页应写出图片保留。');
  }
  if (!text.includes("'/system-params'") || !text.includes('保存')) {
    throw new Error('系统参数页应能保存。');
  }
  if (!text.includes('formatSystemParamChange') || !text.includes('data-testid="sys-params-notice"')) {
    throw new Error('系统参数页应写出改前到改后。');
  }
  if (!text.includes('alertUnreadPollSeconds') || !text.includes('data-field') || !text.includes('data-current')) {
    throw new Error('系统参数页应标出当前秒数。');
  }
}

export function assertParamsNav(source) {
  const text = source ?? readFileSync(join(repoRoot(), 'apps/web/src/admin-nav.json'), 'utf8');
  const links = JSON.parse(text);
  const link = links.find((item) => item.to === '/system-params');
  if (!link || link.label !== '系统参数') throw new Error('侧栏应有系统参数。');
  if (JSON.stringify(link.roles) !== JSON.stringify(['super_admin'])) {
    throw new Error('系统参数只给超管。');
  }
  const backup = links.find((item) => item.to === '/backup');
  if (!backup || backup.label !== '数据备份') throw new Error('数据备份仍应在侧栏。');
}

export function formatParamsProof({ before, after, line, viewerStatus, webOrigin: origin = webOrigin() }) {
  const base = String(origin).replace(/\/$/, '');
  const api = contracts();
  return [
    `超管: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`,
    `图片保留: ${api.formatSystemParamValue('imageRetentionDays', after.imageRetentionDays)}`,
    `时序保留: ${api.formatSystemParamValue('timeseriesRetentionDays', after.timeseriesRetentionDays)}`,
    line,
    `修改人: ${after.updatedBy}`,
    `查看接口: ${viewerStatus}`,
    `登录: ${base}/login`,
    `系统参数页: ${base}/system-params`,
    `改前轮询: ${before.alertUnreadPollSeconds} 秒`,
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

export async function showSysParams() {
  const admin = await loginAs(ADMIN_USERNAME, ADMIN_PASSWORD);
  const beforeRes = await requestJson('/system-params', { token: admin.accessToken });
  if (beforeRes.status !== 200) {
    throw new Error(`读取系统参数失败 ${beforeRes.status} ${messageText(beforeRes.body)}。`);
  }
  const beforeParsed = contracts().parseSystemParams(beforeRes.body);
  if (!beforeParsed.ok) throw new Error(`改前参数不符合契约：${beforeParsed.errors.join('；')}`);
  const next = nextUnreadPollSeconds(beforeParsed.value.alertUnreadPollSeconds);
  const patched = await requestJson('/system-params', {
    token: admin.accessToken,
    method: 'PATCH',
    body: { alertUnreadPollSeconds: next },
  });
  if (patched.status !== 200) {
    throw new Error(`保存系统参数失败 ${patched.status} ${messageText(patched.body) || JSON.stringify(patched.body)}。`);
  }
  const advanced = assertParamsAdvanced(beforeRes.body, patched.body);
  const again = await requestJson('/system-params', { token: admin.accessToken });
  if (again.status !== 200 || again.body.alertUnreadPollSeconds !== next) {
    throw new Error('保存后再读，告警未读轮询没有留下来。');
  }
  if (
    again.body.imageRetentionDays !== beforeParsed.value.imageRetentionDays ||
    again.body.timeseriesRetentionDays !== beforeParsed.value.timeseriesRetentionDays
  ) {
    throw new Error('保存后再读，保留天数变了。');
  }
  const viewer = await loginAs(VIEWER_USERNAME, VIEWER_PASSWORD);
  const viewerGet = await requestJson('/system-params', { token: viewer.accessToken });
  const viewerPatch = await requestJson('/system-params', {
    token: viewer.accessToken,
    method: 'PATCH',
    body: { alertUnreadPollSeconds: next === 45 ? 15 : 45 },
  });
  if (viewerGet.status !== 403 || viewerPatch.status !== 403) {
    throw new Error(`查看调用系统参数应是 403，实际读取 ${viewerGet.status}、保存 ${viewerPatch.status}。`);
  }
  assertParamsPage();
  assertParamsNav();
  return { ...advanced, viewerStatus: viewerGet.status };
}

function usage() {
  return `用法:
  node scripts/demo-sys-params.mjs

用种子超管 ${ADMIN_USERNAME} / ${ADMIN_PASSWORD} 登录。
先读 GET /api/v1/system-params，再 PATCH 告警未读轮询。
15 秒改成 45 秒；已经是 45 秒则改回 15 秒。
图片保留和时序保留不动。
查看 ${VIEWER_USERNAME} / ${VIEWER_PASSWORD} 读取和保存都是 403。
不改用户密码。不发识别，不发心跳，不改告警。不改接入观测。
步骤见 docs/DEMO_SYS_PARAMS.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await showSysParams();
    process.stdout.write(`${formatParamsProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
