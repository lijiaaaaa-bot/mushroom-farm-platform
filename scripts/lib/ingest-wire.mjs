import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);

let contracts;

function loadContracts() {
  if (!contracts) {
    contracts = require(join(root, 'packages/contracts/dist/index.js'));
  }
  return contracts;
}

export function repoRoot() {
  return root;
}

export function fixtureFile(name) {
  return join(root, 'packages/contracts/fixtures', name);
}

export function readFixture(name) {
  return JSON.parse(readFileSync(fixtureFile(name), 'utf8'));
}

export function withRuntimeClock(body, now) {
  return loadContracts().withRuntimeClock(body, now);
}

export function recognitionTopic(shedCode, cameraCode) {
  return loadContracts().MQTT_RECOGNITION_TOPIC.replace('+', shedCode).replace('+', cameraCode);
}

export function heartbeatTopic(shedCode, deviceCode) {
  return loadContracts().MQTT_HEARTBEAT_TOPIC.replace('+', shedCode).replace('+', deviceCode);
}

export function apiBase() {
  return process.env.API_BASE || 'http://127.0.0.1:41821/api/v1';
}

export function mqttUrl() {
  return process.env.MQTT_URL || 'mqtt://127.0.0.1:1883';
}

export function ingestToken() {
  return process.env.INGEST_TOKEN || 'dev-ingest-token';
}

export function ingestRecognitionUrl() {
  return `${apiBase()}/ingest/recognition`;
}

export const FIXTURE_LABEL = '契约黄金报文';

let mqttSeq = 0;

export function publishMqtt(topic, payload) {
  const mqtt = require(join(root, 'apps/api/node_modules/mqtt'));
  const url = mqttUrl();
  const clientId = `edge-sim-${process.pid}-${++mqttSeq}`;
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(url, {
      reconnectPeriod: 0,
      connectTimeout: 4000,
      clientId,
    });
    const timer = setTimeout(() => {
      client.end(true);
      reject(new Error(`MQTT 连接超时 ${url}`));
    }, 5000);
    client.on('error', (error) => {
      clearTimeout(timer);
      client.end(true);
      reject(error);
    });
    client.on('connect', () => {
      client.publish(topic, payload, { qos: 1 }, (error) => {
        clearTimeout(timer);
        client.end();
        if (error) reject(error);
        else resolve({ puback: true, clientId, mqttUrl: url, qos: 1 });
      });
    });
  });
}

export async function postJson(url, rawUtf8, headers) {
  const response = await fetch(url, { method: 'POST', headers, body: rawUtf8 });
  const text = await response.text();
  let responseBody = text;
  try {
    responseBody = JSON.parse(text);
  } catch {
    // 非 JSON 响应原样保留
  }
  return { responseStatus: response.status, responseBody };
}

export async function withPg(fn) {
  const { Client } = require(join(root, 'apps/api/node_modules/pg'));
  const db = new Client({
    connectionString:
      process.env.DATABASE_URL || 'postgres://mushroom:mushroom@127.0.0.1:5432/mushroom',
  });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

export async function clearIdempotency(idempotencyKey) {
  const Redis = require(join(root, 'apps/api/node_modules/ioredis'));
  await withPg((db) =>
    db.query('DELETE FROM recognition_records WHERE idempotency_key = $1', [idempotencyKey]),
  );
  const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
  });
  try {
    await redis.del(`ingest:idemp:${idempotencyKey}`);
  } finally {
    redis.disconnect();
  }
}
