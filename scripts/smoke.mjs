import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { withRuntimeClock, MQTT_RECOGNITION_TOPIC } = require(
  join(root, 'packages/contracts/dist/index.js'),
);

const base = process.env.API_BASE || 'http://127.0.0.1:41821/api/v1';
const ingestToken = process.env.INGEST_TOKEN || 'dev-ingest-token';

function fixture(name) {
  return JSON.parse(readFileSync(join(root, 'packages/contracts/fixtures', name), 'utf8'));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function recognitionTopic(shedCode, cameraCode) {
  return MQTT_RECOGNITION_TOPIC.replace('+', shedCode).replace('+', cameraCode);
}

let mqttSeq = 0;

function publishMqtt(topic, payload) {
  const mqtt = require(join(root, 'apps/api/node_modules/mqtt'));
  const url = process.env.MQTT_URL || 'mqtt://127.0.0.1:1883';
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(url, {
      reconnectPeriod: 0,
      connectTimeout: 4000,
      clientId: `smoke-${process.pid}-${++mqttSeq}`,
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
        else resolve();
      });
    });
  });
}

async function listRecognitions(auth, cameraCode) {
  const listed = await fetch(
    `${base}/ingest/recognitions?cameraCode=${encodeURIComponent(cameraCode)}&pageSize=100`,
    { headers: auth },
  );
  const listBody = await listed.json();
  if (!listed.ok) throw new Error(`列表失败 ${listed.status} ${JSON.stringify(listBody)}`);
  return listBody;
}

async function clearIdempotency(idempotencyKey) {
  const { Client } = require(join(root, 'apps/api/node_modules/pg'));
  const Redis = require(join(root, 'apps/api/node_modules/ioredis'));
  const db = new Client({
    connectionString:
      process.env.DATABASE_URL || 'postgres://mushroom:mushroom@127.0.0.1:5432/mushroom',
  });
  await db.connect();
  try {
    await db.query('DELETE FROM recognition_records WHERE idempotency_key = $1', [idempotencyKey]);
  } finally {
    await db.end();
  }
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

async function waitForMqttRecord(auth, body) {
  const topic = recognitionTopic(body.shedCode, body.cameraCode);
  const payload = JSON.stringify(body);
  const deadline = Date.now() + 25_000;
  let last = '尚未发布';
  while (Date.now() < deadline) {
    try {
      await publishMqtt(topic, payload);
      last = '已发布';
    } catch (error) {
      last = error.message;
      await sleep(500);
      continue;
    }
    const listBody = await listRecognitions(auth, body.cameraCode);
    const hit = (listBody.items || []).find(
      (item) => item.idempotencyKey === body.idempotencyKey && item.source === 'mqtt',
    );
    if (hit) return hit;
    await sleep(400);
  }
  throw new Error(`MQTT 黄金报文未进入列表（${last}）`);
}

async function waitForMqttReject(body) {
  const { Client } = require(join(root, 'apps/api/node_modules/pg'));
  const topic = recognitionTopic(body.shedCode, body.cameraCode);
  const payload = JSON.stringify(body);
  const since = new Date(Date.now() - 2000);
  const deadline = Date.now() + 15_000;
  const connectionString =
    process.env.DATABASE_URL || 'postgres://mushroom:mushroom@127.0.0.1:5432/mushroom';
  while (Date.now() < deadline) {
    await publishMqtt(topic, payload);
    const db = new Client({ connectionString });
    await db.connect();
    try {
      const result = await db.query(
        `SELECT source, errors
         FROM ingest_rejects
         WHERE source = 'mqtt'
           AND payload->>'idempotencyKey' = $1
           AND created_at >= $2
         ORDER BY created_at DESC
         LIMIT 1`,
        [body.idempotencyKey, since],
      );
      const row = result.rows[0];
      if (row) {
        const text = JSON.stringify(row.errors);
        if (!text.includes('未知字段')) {
          throw new Error(`MQTT 未知字段未被拒绝 ${text}`);
        }
        return row;
      }
    } finally {
      await db.end();
    }
    await sleep(400);
  }
  throw new Error('MQTT 未知字段没有写入拒绝记录');
}

async function waitHealth(child) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API 提前退出，code=${child.exitCode}`);
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {
      // API 仍在启动
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('API 健康检查超时');
}

const child = spawn('npm', ['--prefix', join(root, 'apps/api'), 'run', 'start'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: '41821',
    TYPEORM_SYNC: 'false',
    MQTT_ENABLED: 'true',
    MQTT_URL: process.env.MQTT_URL || 'mqtt://127.0.0.1:1883',
    SEED_ON_START: 'true',
  },
  stdio: 'inherit',
});

try {
  await waitHealth(child);
  const golden = fixture('recognition.golden.json');
  const body = withRuntimeClock(golden.body);
  const ingested = await fetch(`${base}/ingest/recognition`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ingest-token': ingestToken },
    body: JSON.stringify(body),
  });
  const ingestedBody = await ingested.json();
  if (!ingested.ok || ingestedBody.accepted !== true) {
    throw new Error(`接入失败 ${ingested.status} ${JSON.stringify(ingestedBody)}`);
  }

  const unknown = fixture('recognition.unknown-field.json');
  const rejected = await fetch(`${base}/ingest/recognition`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ingest-token': ingestToken },
    body: JSON.stringify(withRuntimeClock(unknown.body)),
  });
  const rejectedBody = await rejected.json();
  if (rejected.status !== 400 || rejectedBody.code !== unknown.expect) {
    throw new Error(`未知字段未被拒绝 ${rejected.status} ${JSON.stringify(rejectedBody)}`);
  }

  const login = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Admin@123456' }),
  });
  const session = await login.json();
  if (!login.ok || !session.accessToken) throw new Error(`登录失败 ${JSON.stringify(session)}`);
  const auth = { authorization: `Bearer ${session.accessToken}`, 'content-type': 'application/json' };

  const listed = await fetch(
    `${base}/ingest/recognitions?cameraCode=${encodeURIComponent(golden.body.cameraCode)}`,
    { headers: auth },
  );
  const listBody = await listed.json();
  const found = (listBody.items || []).find(
    (item) => item.idempotencyKey === golden.body.idempotencyKey,
  );
  if (!listed.ok || !found || found.source !== 'http') {
    throw new Error(`列表未找到 HTTP 黄金报文 ${JSON.stringify(listBody)}`);
  }

  const mqttFixture = fixture('recognition.mqtt.json');
  const mqttBody = withRuntimeClock(mqttFixture.body);
  await clearIdempotency(mqttBody.idempotencyKey);
  const mqttRecord = await waitForMqttRecord(auth, mqttBody);
  if (mqttRecord.mushroomCount !== mqttFixture.body.mushroomCount) {
    throw new Error(`MQTT 报文内容不一致 ${JSON.stringify(mqttRecord)}`);
  }

  const beforeDuplicate = await listRecognitions(auth, body.cameraCode);
  await publishMqtt(recognitionTopic(body.shedCode, body.cameraCode), JSON.stringify(body));
  const duplicateDeadline = Date.now() + 4_000;
  while (Date.now() < duplicateDeadline) {
    await sleep(400);
    const afterDuplicate = await listRecognitions(auth, body.cameraCode);
    if (afterDuplicate.total !== beforeDuplicate.total) {
      throw new Error(`MQTT 与 HTTP 幂等未共享 ${JSON.stringify(afterDuplicate)}`);
    }
    const same = (afterDuplicate.items || []).filter(
      (item) => item.idempotencyKey === body.idempotencyKey,
    );
    if (same.length !== 1 || same[0].source !== 'http') {
      throw new Error(`HTTP 记录被 MQTT 重复报文改写 ${JSON.stringify(same)}`);
    }
  }

  const unknownMqtt = withRuntimeClock(fixture('recognition.unknown-field.json').body);
  await waitForMqttReject(unknownMqtt);
  const unknownListed = await listRecognitions(auth, unknownMqtt.cameraCode);
  if (
    (unknownListed.items || []).some((item) => item.idempotencyKey === unknownMqtt.idempotencyKey)
  ) {
    throw new Error(`MQTT 未知字段被写入识别列表 ${JSON.stringify(unknownListed)}`);
  }

  const createFixture = fixture('alert.create.json');
  const created = await fetch(`${base}/alerts`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify(createFixture.body),
  });
  const alert = await created.json();
  if (!created.ok || alert.status !== 'open') {
    throw new Error(`创建告警失败 ${created.status} ${JSON.stringify(alert)}`);
  }
  const ackFixture = fixture('alert.ack.json');
  const acked = await fetch(`${base}/alerts/${alert.id}/ack`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify(ackFixture.body),
  });
  const ackedBody = await acked.json();
  if (!acked.ok || ackedBody.status !== 'acked') {
    throw new Error(`确认告警失败 ${acked.status} ${JSON.stringify(ackedBody)}`);
  }
  console.log('smoke ok', { recognitionId: ingestedBody.id, alertId: alert.id });
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
}
