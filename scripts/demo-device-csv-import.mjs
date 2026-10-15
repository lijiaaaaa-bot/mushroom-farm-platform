#!/usr/bin/env node
/**
 * 用 CSV 导入 CAM-CSV-01。同一文件的第二行编码冲突，跳过且不改第一行。
 * 再读设备页同一份列表。不发识别，不发心跳，不单条登记。
 */
import { pathToFileURL } from 'node:url';
import { apiBase } from './lib/ingest-wire.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';
import { login } from './demo-register-and-ingest.mjs';
import {
  heartbeatLabel,
  lensCodeOf,
  listDevices,
  statusLabel,
} from './demo-camera-list.mjs';

export const CSV_CAMERA = 'CAM-CSV-01';
export const CSV_SHED = 'S01';
export const CSV_NAME = 'CSV导入镜头';
export const CSV_NOTE = 'CSV导入可演示';
export const CSV_CONFLICT_NAME = '覆盖名称';
export const CSV_CONFLICT_NOTE = '覆盖备注';
export const CSV_SKIP_REASON = '设备编码已存在，已跳过';

export function demoCsvText() {
  return [
    '设备编码,棚编码,名称,类型,备注',
    [CSV_CAMERA, CSV_SHED, CSV_NAME, '摄像头', CSV_NOTE].join(','),
    [CSV_CAMERA, CSV_SHED, CSV_CONFLICT_NAME, '摄像头', CSV_CONFLICT_NOTE].join(','),
  ].join('\n');
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

function sameValue(left, right) {
  return (left ?? null) === (right ?? null);
}

export function assertImportReport(report, { created }) {
  if (!report || typeof report !== 'object') {
    throw new Error('导入响应不是报告。');
  }
  if (report.failCount !== 0) {
    const reason = report.errors?.[0]?.reason || '未知';
    throw new Error(`导入有失败行（${report.failCount}）：${reason}`);
  }
  const skipped = Array.isArray(report.skipped) ? report.skipped : [];
  if (created) {
    if (report.successCount !== 1 || report.skippedCount !== 1) {
      throw new Error(
        `新建时期望成功 1、跳过 1，实际成功 ${report.successCount}、跳过 ${report.skippedCount}。`,
      );
    }
    if (!skipped.some((item) => item?.row === 2 && item?.reason === CSV_SKIP_REASON)) {
      throw new Error(`第二行应跳过，原因是「${CSV_SKIP_REASON}」。`);
    }
  } else if (report.successCount !== 0 || report.skippedCount !== 2) {
    throw new Error(
      `已有档案时期望成功 0、跳过 2，实际成功 ${report.successCount}、跳过 ${report.skippedCount}。`,
    );
  }
  if (!skipped.some((item) => item?.reason === CSV_SKIP_REASON)) {
    throw new Error(`跳过原因里没有「${CSV_SKIP_REASON}」。`);
  }
  return report;
}

export function assertImportedCamera(device, { created }) {
  if (!device) {
    throw new Error(
      `设备列表里没有 ${CSV_CAMERA}。打开 /devices，在镜头码一列找这一台。`,
    );
  }
  if (!device.id) throw new Error(`${CSV_CAMERA} 这一行没有 id。`);
  if (device.code !== CSV_CAMERA || lensCodeOf(device) !== CSV_CAMERA) {
    throw new Error(
      `${CSV_CAMERA} 的类型是 ${device.type || '空'}，镜头码只标在摄像头上。`,
    );
  }
  if (device.shedCode !== CSV_SHED) {
    throw new Error(
      `${CSV_CAMERA} 在棚区 ${device.shedCode || '空'}。CSV 导入演示用的是 ${CSV_SHED}。不改已有档案。`,
    );
  }
  if (device.onlineStatus !== 'online' && device.onlineStatus !== 'offline') {
    throw new Error(`${CSV_CAMERA} 的状态是 ${device.onlineStatus || '空'}，应为在线或离线。`);
  }
  if (device.name === CSV_CONFLICT_NAME || device.note === CSV_CONFLICT_NOTE) {
    throw new Error(
      `${CSV_CAMERA} 写成了冲突行的名称或备注。编码冲突应跳过，不覆盖原档案。`,
    );
  }
  if (created) {
    if (device.name !== CSV_NAME || device.note !== CSV_NOTE) {
      throw new Error(
        `新建的 ${CSV_CAMERA} 名称或备注与 CSV 不一致（名称 ${device.name}，备注 ${device.note ?? '—'}）。`,
      );
    }
    if (device.onlineStatus !== 'offline' || device.lastHeartbeatAt || device.lastSeenAt) {
      throw new Error('新建摄像头应是离线，且还没有心跳。这条命令不发心跳。');
    }
  }
  return device;
}

export function assertArchiveUnchanged(before, after) {
  if (!before?.id || !after?.id) throw new Error('对照档案缺 id。');
  if (before.id !== after.id) {
    throw new Error(`导入后 id 变成 ${after.id}，导入前是 ${before.id}。冲突跳过不应另建一行。`);
  }
  if (before.name !== after.name || !sameValue(before.note, after.note)) {
    throw new Error(
      `导入改了已有档案（名称 ${before.name} → ${after.name}，备注 ${before.note ?? '—'} → ${after.note ?? '—'}）。`,
    );
  }
  if (before.shedCode !== after.shedCode || before.type !== after.type) {
    throw new Error('导入改了已有档案的棚区或类型。');
  }
  if (
    before.onlineStatus !== after.onlineStatus ||
    !sameValue(before.lastHeartbeatAt, after.lastHeartbeatAt) ||
    !sameValue(before.lastSeenAt, after.lastSeenAt) ||
    !sameValue(before.enabled, after.enabled)
  ) {
    throw new Error('导入改了已有档案的状态、心跳或启用。这条命令不发心跳。');
  }
  return after;
}

async function postCsv(token, csv) {
  let response;
  try {
    response = await fetch(`${apiBase()}/devices/import`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ csv }),
    });
  } catch (error) {
    throw new Error(
      `API 连不上（${apiBase()}/devices/import）。先执行 make up、make migrate、make api。${error.message}`,
    );
  }
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(
      `导入失败 ${response.status} ${messageText(payload) || JSON.stringify(payload)}`,
    );
  }
  return payload;
}

export async function importListedCamera(token) {
  const before =
    (await listDevices(token)).find((row) => row && row.code === CSV_CAMERA) ?? null;
  const created = !before;
  const report = assertImportReport(await postCsv(token, demoCsvText()), { created });
  const device = assertImportedCamera(
    (await listDevices(token)).find((row) => row && row.code === CSV_CAMERA) ?? null,
    { created },
  );
  if (before) assertArchiveUnchanged(before, device);
  return { created, report, device };
}

export function formatImportProof({ created, report, device, webOrigin = webOriginFromEnv() }) {
  const origin = String(webOrigin).replace(/\/$/, '');
  const note = device.note == null || device.note === '' ? '—' : device.note;
  const skipped = Array.isArray(report?.skipped) ? report.skipped : [];
  const lines = [
    created ? '导入: 新建' : '导入: 已有，未改档案',
    `成功: ${report.successCount}`,
    `失败: ${report.failCount}`,
    `跳过: ${report.skippedCount}`,
    ...skipped.map((item) => `跳过明细: 第 ${item.row} 行：${item.reason}`),
    `镜头码: ${lensCodeOf(device)}`,
    `编号: ${device.code}`,
    `名称: ${device.name}`,
    '类型: 摄像头',
    `棚区: ${device.shedCode}`,
    `状态: ${statusLabel(device.onlineStatus)}`,
    `备注: ${note}`,
    `最近心跳: ${heartbeatLabel(device)}`,
    `设备页: ${origin}/devices`,
  ];
  return lines.join('\n');
}

export async function showCsvImport() {
  const token = await login();
  return importListedCamera(token);
}

function usage() {
  return `用法:
  node scripts/demo-device-csv-import.mjs

生成两行 CSV，POST /devices/import。第一行是 ${CSV_CAMERA}，第二行同编码，用来跳过。再读 GET /devices?pageSize=100。不发识别，不发心跳。步骤见 docs/DEMO_DEVICE_CSV_IMPORT.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const result = await showCsvImport();
    process.stdout.write(`${formatImportProof(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
