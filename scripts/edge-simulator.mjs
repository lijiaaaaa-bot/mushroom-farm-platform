#!/usr/bin/env node
/**
 * 边缘模拟实体：读取 packages/contracts/fixtures，用真实 MQTT 客户端或 HTTP POST 发出原始 JSON。
 * stdout 只有一条发送记录。业务是否接受由 scripts/smoke.mjs 核对列表和数据库。
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  FIXTURE_LABEL,
  heartbeatTopic,
  ingestRecognitionUrl,
  ingestToken,
  postJson,
  publishMqtt,
  readFixture,
  recognitionTopic,
  withRuntimeClock,
} from './lib/ingest-wire.mjs';

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`未知参数 ${arg}`);
    const key = arg.slice(2);
    if (key === 'heartbeat') {
      out.heartbeat = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`缺少 ${arg} 的值`);
    out[key] = value;
    i += 1;
  }
  return out;
}

function topicFromRecognition(rawBody) {
  const shedCode = rawBody.shedCode || rawBody['棚区编号'];
  const cameraCode = rawBody.cameraCode || rawBody['摄像头编号'];
  if (!shedCode || !cameraCode) throw new Error('报文缺少棚区或摄像头编号，无法组主题');
  return recognitionTopic(String(shedCode), String(cameraCode));
}

export function planSend(argv, options = {}) {
  const args = parseArgs(argv);
  const now = options.now || new Date();
  if (args.channel !== 'http' && args.channel !== 'mqtt') {
    throw new Error('需要 --channel http 或 --channel mqtt');
  }
  if (args['raw-utf8-file']) {
    if (!args.fixture) throw new Error('重放需要 --fixture');
    const rawUtf8 = readFileSync(args['raw-utf8-file'], 'utf8');
    const rawBody = JSON.parse(rawUtf8);
    const plan = {
      channel: args.channel,
      fixture: args.fixture,
      fixtureLabel: '重放已计时的契约黄金报文字节',
      rawBody,
      rawUtf8,
      byteLength: Buffer.byteLength(rawUtf8),
    };
    if (args.channel === 'mqtt') {
      plan.topic = args.topic || topicFromRecognition(rawBody);
    } else {
      plan.method = 'POST';
      plan.path = '/api/v1/ingest/recognition';
      plan.url = ingestRecognitionUrl();
    }
    return plan;
  }
  if (args.heartbeat) {
    if (args.channel !== 'mqtt') throw new Error('心跳只走 --channel mqtt');
    const fixtureName = args.fixture || 'heartbeat.mqtt.json';
    const fixture = readFixture(fixtureName);
    const body = { ...fixture.body };
    if (args.device) body.deviceCode = args.device;
    if (args['device-type']) body.deviceType = args['device-type'];
    const shedCode = args.shed || fixture.shedCode;
    const deviceCode = args.device || fixture.deviceCode || body.deviceCode;
    if (!shedCode || !deviceCode) throw new Error('心跳缺少 shedCode 或 deviceCode');
    const rawUtf8 = JSON.stringify(body);
    return {
      channel: 'mqtt',
      fixture: fixtureName,
      fixtureLabel: fixture.label || '心跳夹具',
      topic: args.topic || heartbeatTopic(String(shedCode), String(deviceCode)),
      rawBody: JSON.parse(rawUtf8),
      rawUtf8,
      byteLength: Buffer.byteLength(rawUtf8),
    };
  }
  if (!args.fixture) throw new Error('需要 --fixture <name.json>');
  const fixture = readFixture(args.fixture);
  const rawUtf8 = JSON.stringify(withRuntimeClock(fixture.body, now));
  const rawBody = JSON.parse(rawUtf8);
  const plan = {
    channel: args.channel,
    fixture: args.fixture,
    fixtureLabel: FIXTURE_LABEL,
    rawBody,
    rawUtf8,
    byteLength: Buffer.byteLength(rawUtf8),
  };
  if (args.channel === 'mqtt') {
    plan.topic = args.topic || topicFromRecognition(rawBody);
  } else {
    plan.method = 'POST';
    plan.path = '/api/v1/ingest/recognition';
    plan.url = ingestRecognitionUrl();
  }
  return plan;
}

export async function executeSend(plan) {
  const timestamp = new Date().toISOString();
  if (plan.channel === 'mqtt') {
    const ack = await publishMqtt(plan.topic, plan.rawUtf8);
    return { timestamp, actor: 'edge-simulator', ...plan, ...ack };
  }
  const posted = await postJson(plan.url, plan.rawUtf8, {
    'content-type': 'application/json',
    'x-ingest-token': ingestToken(),
  });
  return {
    timestamp,
    actor: 'edge-simulator',
    ...plan,
    requestHeaders: {
      'content-type': 'application/json',
      'x-ingest-token': '<redacted>',
    },
    responseStatus: posted.responseStatus,
    responseBody: posted.responseBody,
  };
}

function usage() {
  return `用法:
  node scripts/edge-simulator.mjs --channel http --fixture recognition.golden.json
  node scripts/edge-simulator.mjs --channel mqtt --fixture recognition.mqtt.json
  node scripts/edge-simulator.mjs --channel mqtt --heartbeat
  node scripts/edge-simulator.mjs --channel mqtt --fixture recognition.golden.json --raw-utf8-file <file>

stdout 只有一条 JSON：主题或路径、发出的原始 UTF-8、以及 PUBACK 或 HTTP 响应。
报文来自 packages/contracts/fixtures，不是客户现场抓包。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const plan = planSend(process.argv.slice(2));
    const sent = await executeSend(plan);
    process.stderr.write(
      `edge-simulator sent ${sent.channel} ${sent.topic || sent.path} bytes=${sent.byteLength} fixture=${sent.fixture}\n`,
    );
    process.stdout.write(`${JSON.stringify(sent)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
