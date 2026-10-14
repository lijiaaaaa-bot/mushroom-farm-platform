#!/usr/bin/env node
/**
 * 保证一条温度过高告警，并打印详情地址 /alerts/<id>。
 * 播种与 make demo-one-alert 相同，不改那个命令，也不改样例文件。
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from './lib/ingest-wire.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';
import {
  ALERT_CAMERA,
  ALERT_TEMPERATURE,
  ALERT_THRESHOLD,
  alertDetailUrl,
  sendAlertDemo,
} from './demo-one-alert.mjs';

const require = createRequire(import.meta.url);

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

function blank(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function quantity(metric, value) {
  if (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) return '—';
  if (metric === 'temperature_high' || metric === 'temperature_low') return `${value}℃`;
  if (metric === 'humidity_high' || metric === 'humidity_low' || metric === 'substrate_moisture_low') {
    return `${value}%`;
  }
  if (metric === 'co2_high') return `${value} ppm`;
  if (metric === 'mature_ratio') return `${Math.round(Number(value) * 100)}%`;
  return String(value);
}

export function formatDetailProof({
  created,
  detail,
  webOrigin = webOriginFromEnv(),
}) {
  if (!detail?.id) throw new Error('告警详情没有 id');
  const url = alertDetailUrl(detail.id, webOrigin);
  const path = `/alerts/${encodeURIComponent(detail.id)}`;
  if (!url.endsWith(path)) throw new Error(`详情地址不是 ${path}`);
  const labels = contracts();
  const metric = labels.ALERT_METRIC_LABEL[detail.metric] || detail.metric || '—';
  const closeReason = detail.closeReason
    ? labels.ALERT_CLOSE_REASON_LABEL[detail.closeReason] || detail.closeReason
    : '—';
  const lines = [
    created ? '告警: 新建' : '告警: 沿用未闭合',
    `告警 id: ${detail.id}`,
    `告警详情: ${url}`,
    `标题: ${detail.title}`,
    `说明: ${detail.message}`,
    `级别: ${labels.ALERT_LEVEL_LABEL[detail.level] || detail.level}`,
    `状态: ${labels.ALERT_STATUS_LABEL[detail.status] || detail.status}`,
    `棚区: ${detail.shedCode}`,
    `摄像头: ${blank(detail.cameraCode)}`,
    `发生时间: ${detail.createdAt}`,
    `指标: ${metric}`,
    `当前值: ${quantity(detail.metric, detail.metricValue)}`,
    `阈值: ${quantity(detail.metric, detail.threshold)}`,
    `认领人: ${blank(detail.claimedBy)}`,
    `认领时间: ${blank(detail.claimedAt)}`,
    `确认人: ${blank(detail.ackedBy)}`,
    `确认时间: ${blank(detail.ackedAt)}`,
    `关闭原因: ${closeReason}`,
    `关闭人: ${blank(detail.closedBy)}`,
    `关闭时间: ${blank(detail.closedAt)}`,
    '登录: admin / Admin@123456',
  ];
  return lines.join('\n');
}

export async function sendAlertDetailDemo(options) {
  const result = await sendAlertDemo(options);
  formatDetailProof(result);
  return result;
}

function usage() {
  return `用法:
  node scripts/demo-alert-detail.mjs

保证一条温度过高告警（摄像头 ${ALERT_CAMERA}，温度 ${ALERT_TEMPERATURE}℃，阈值 ${ALERT_THRESHOLD}），打印 /alerts/<id>。步骤见 docs/DEMO_ALERT_DETAIL.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await sendAlertDetailDemo();
    process.stdout.write(`${formatDetailProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
