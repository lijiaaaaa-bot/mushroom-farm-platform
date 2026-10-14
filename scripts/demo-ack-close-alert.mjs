#!/usr/bin/env node
/**
 * 确认或关闭 make demo-one-alert 留下的温度过高告警，再读一次详情和列表。
 * 不改 recognition.demo-one.json，也不改 demo-one-alert 本身。
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { apiBase, repoRoot } from './lib/ingest-wire.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';
import {
  ALERT_CAMERA,
  ALERT_SHED,
  ALERT_TITLE,
  alertListUrl,
  listTemperatureAlerts,
  readAlert,
  sendAlertDemo,
} from './demo-one-alert.mjs';

const require = createRequire(import.meta.url);

export const ACK_NOTE = '已确认';
export const CLOSE_NOTE = '已关闭';

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function parseAction(argv) {
  const args = argv.filter((arg) => arg !== '--help' && arg !== '-h');
  if (args.length !== 1 || (args[0] !== 'ack' && args[0] !== 'close')) {
    throw new Error('要写 ack 或 close');
  }
  return args[0];
}

function messageText(payload) {
  const message = payload?.message ?? payload?.error;
  if (Array.isArray(message)) return message.join('；');
  if (typeof message === 'string') return message;
  return '';
}

async function login() {
  let response;
  try {
    response = await fetch(`${apiBase()}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'Admin@123456' }),
    });
  } catch (error) {
    throw new Error(`API 连不上（${apiBase()}）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const session = await response.json().catch(() => ({}));
  if (!response.ok || !session.accessToken) {
    throw new Error(`登录失败 ${response.status}。确认 API 已用种子账号启动。`);
  }
  return session.accessToken;
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

async function listByStatus(token, status) {
  const url =
    `${apiBase()}/alerts?shedCode=${encodeURIComponent(ALERT_SHED)}` +
    `&status=${encodeURIComponent(status)}&pageSize=100`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`告警列表失败 ${response.status} ${messageText(body) || JSON.stringify(body)}`);
  }
  return Array.isArray(body.items) ? body.items : [];
}

async function postAction(token, id, action, note) {
  let response;
  try {
    response = await fetch(`${apiBase()}/alerts/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ note }),
    });
  } catch (error) {
    throw new Error(`API 连不上（${apiBase()}）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const body = await readJson(response);
  if (!response.ok) {
    const verb = action === 'ack' ? '确认' : '关闭';
    throw new Error(`${verb}失败 ${response.status} ${messageText(body) || JSON.stringify(body)}`);
  }
  return body;
}

export function assertDisposed(detail, action) {
  if (!detail?.id) throw new Error('刷新后没有告警 id');
  if (detail.shedCode !== ALERT_SHED) throw new Error(`刷新后棚区是 ${detail.shedCode}`);
  if (detail.cameraCode !== ALERT_CAMERA) throw new Error(`刷新后摄像头是 ${detail.cameraCode}`);
  if (detail.title !== ALERT_TITLE) throw new Error(`刷新后标题是 ${detail.title}`);
  if (action === 'ack') {
    if (detail.status !== 'acked') {
      throw new Error(`刷新后状态是 ${detail.status}，应为已确认`);
    }
    if (detail.ackNote !== ACK_NOTE) {
      throw new Error(`确认备注是 ${detail.ackNote ?? '空'}，应为 ${ACK_NOTE}`);
    }
    return detail;
  }
  if (action === 'close') {
    if (detail.status !== 'closed') {
      throw new Error(`刷新后状态是 ${detail.status}，应为已关闭`);
    }
    if (detail.closeReason !== 'resolved') {
      throw new Error(`关闭原因是 ${detail.closeReason ?? '空'}，应为 resolved`);
    }
    if (detail.closeNote !== CLOSE_NOTE) {
      throw new Error(`关闭备注是 ${detail.closeNote ?? '空'}，应为 ${CLOSE_NOTE}`);
    }
    return detail;
  }
  throw new Error(`未知动作 ${action}`);
}

function sameAlert(row, detail) {
  return row?.id === detail.id && row.status === detail.status;
}

async function expectListed(token, status, detail) {
  const items = await listByStatus(token, status);
  if (!items.some((row) => sameAlert(row, detail))) {
    throw new Error(`刷新后 status=${status} 的列表里没有告警 ${detail.id}`);
  }
}

async function expectAbsent(token, status, id) {
  const items = await listByStatus(token, status);
  if (items.some((row) => row.id === id)) {
    throw new Error(`刷新后 status=${status} 的列表里还有告警 ${id}`);
  }
}

export function formatDisposeProof({
  action,
  detail,
  seeded,
  webOrigin = webOriginFromEnv(),
}) {
  const labels = contracts();
  const status = labels.ALERT_STATUS_LABEL[detail.status] || detail.status;
  const lines = [
    action === 'ack' ? '确认了 1 条告警' : '关闭了 1 条告警',
    seeded ? '来源: 本次补了一条识别' : '来源: 沿用未闭合',
    `告警 id: ${detail.id}`,
    `标题: ${detail.title}`,
    `棚区: ${ALERT_SHED}`,
    `摄像头编号: ${ALERT_CAMERA}`,
    `刷新后状态: ${status}`,
  ];
  if (action === 'ack') lines.push(`确认备注: ${detail.ackNote}`);
  if (action === 'close') {
    const reason = labels.ALERT_CLOSE_REASON_LABEL[detail.closeReason] || detail.closeReason;
    lines.push(`关闭原因: ${reason}`);
    lines.push(`关闭备注: ${detail.closeNote}`);
  }
  lines.push('登录: admin / Admin@123456');
  lines.push(`告警列表: ${alertListUrl(webOrigin)}`);
  lines.push('刷新告警列表后，这一条的状态仍是上面的刷新后状态。');
  return lines.join('\n');
}

export async function disposeAlertDemo({ action, now = new Date() } = {}) {
  if (action !== 'ack' && action !== 'close') throw new Error(`未知动作 ${action}`);
  const token = await login();
  const pending = await listTemperatureAlerts(token);
  let target = null;
  let seeded = false;
  if (action === 'ack') {
    target = pending.find((row) => row.status === 'open') ?? null;
    if (!target && pending.some((row) => row.status === 'acked')) {
      throw new Error(
        `棚区 ${ALERT_SHED} 摄像头 ${ALERT_CAMERA} 的温度过高告警已经是已确认，没有待确认的一条。` +
          '先执行 make demo-close-one-alert，或在告警列表点「关闭」，再执行 make demo-one-alert。',
      );
    }
  } else {
    target = pending[0] ?? null;
  }
  if (!target) {
    const created = await sendAlertDemo({ now });
    target = created.detail;
    seeded = true;
    if (action === 'ack' && target.status !== 'open') {
      throw new Error(`没有待确认的温度过高告警。当前状态是 ${target.status}。`);
    }
  }
  const note = action === 'ack' ? ACK_NOTE : CLOSE_NOTE;
  await postAction(token, target.id, action, note);
  const detail = assertDisposed(await readAlert(token, target.id), action);
  if (action === 'ack') {
    await expectListed(token, 'acked', detail);
    await expectAbsent(token, 'open', detail.id);
  } else {
    await expectListed(token, 'closed', detail);
    await expectAbsent(token, 'open', detail.id);
    await expectAbsent(token, 'acked', detail.id);
  }
  return { action, detail, seeded };
}

function usage() {
  return `用法:
  node scripts/demo-ack-close-alert.mjs ack
  node scripts/demo-ack-close-alert.mjs close

确认或关闭棚区 ${ALERT_SHED} 摄像头 ${ALERT_CAMERA} 的温度过高告警，再读一次。步骤见 docs/DEMO_ACK_CLOSE_ALERT.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const action = parseAction(process.argv.slice(2));
    const result = await disposeAlertDemo({ action });
    process.stdout.write(`${formatDisposeProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
