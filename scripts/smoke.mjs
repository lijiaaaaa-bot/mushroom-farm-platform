import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openEvidence } from './lib/evidence.mjs';
import {
  apiBase,
  clearIdempotency,
  ingestToken,
  mqttUrl,
  readFixture,
  repoRoot,
  withPg,
} from './lib/ingest-wire.mjs';

const root = repoRoot();
const base = apiBase();
const token = ingestToken();
const evidenceDir = process.env.EVIDENCE_DIR || join(root, 'evidence/ingest-last-run');
const evidence = openEvidence(evidenceDir);
const startedAt = new Date().toISOString();
const replayDir = mkdtempSync(join(tmpdir(), 'edge-replay-'));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compact(step) {
  return Object.fromEntries(Object.entries(step).filter(([, value]) => value !== undefined));
}

function record(step) {
  const saved = evidence.addStep(compact(step));
  const where = saved.topic || saved.path;
  console.log(
    `evidence-step ${saved.id} ${saved.pass ? 'pass' : 'fail'} ${saved.channel} ${where} fixture=${saved.fixture}`,
  );
  return saved;
}

function sendViaEdge(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, 'scripts/edge-simulator.mjs'), ...args], {
      cwd: root,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`edge-simulator 退出 ${code}: ${stderr.trim()}`));
        return;
      }
      const line = stdout.trim().split('\n').filter(Boolean).at(-1);
      try {
        resolve(JSON.parse(line));
      } catch {
        reject(new Error(`edge-simulator stdout 不是 JSON: ${stdout}`));
      }
    });
  });
}

function replayPath(name, rawUtf8) {
  const path = join(replayDir, name);
  writeFileSync(path, rawUtf8);
  return path;
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

async function publishUntil(id, firstArgs, prove, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  let sent = null;
  let attempts = 0;
  let lastError = '尚未发布';
  while (Date.now() < deadline) {
    try {
      if (!sent) sent = await sendViaEdge(firstArgs);
      else {
        const file = replayPath(`${id}.json`, sent.rawUtf8);
        const again = await sendViaEdge([
          '--channel',
          'mqtt',
          '--fixture',
          sent.fixture,
          '--raw-utf8-file',
          file,
          '--topic',
          sent.topic,
        ]);
        sent = { ...sent, puback: again.puback, clientId: again.clientId, timestamp: sent.timestamp };
      }
      attempts += 1;
      const proof = await prove(sent);
      if (proof) return { sent, attempts, proof };
    } catch (error) {
      lastError = error.message;
      attempts += 1;
    }
    await sleep(400);
  }
  const failed = {
    id,
    timestamp: sent?.timestamp || new Date().toISOString(),
    channel: 'mqtt',
    topic: sent?.topic || '(未发出)',
    fixture: sent?.fixture || firstArgs[firstArgs.indexOf('--fixture') + 1] || null,
    fixtureLabel: sent?.fixtureLabel,
    rawBody: sent?.rawBody ?? null,
    rawUtf8: sent?.rawUtf8,
    byteLength: sent?.byteLength,
    qos: sent?.qos,
    puback: sent?.puback,
    clientId: sent?.clientId,
    mqttUrl: sent?.mqttUrl,
    actor: 'edge-simulator',
    attempts,
    pass: false,
    error: lastError,
  };
  record(failed);
  throw new Error(lastError);
}

async function waitHealth(child) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API 提前退出，code=${child.exitCode}`);
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {
      // API 仍在启动
    }
    await sleep(500);
  }
  throw new Error('API 健康检查超时');
}

async function login() {
  const response = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Admin@123456' }),
  });
  const session = await response.json();
  if (!response.ok || !session.accessToken) throw new Error(`登录失败 ${JSON.stringify(session)}`);
  return { authorization: `Bearer ${session.accessToken}`, 'content-type': 'application/json' };
}

function wire(sent, extra) {
  return {
    timestamp: sent.timestamp,
    channel: sent.channel,
    topic: sent.topic,
    path: sent.path,
    method: sent.method,
    url: sent.url,
    fixture: sent.fixture,
    fixtureLabel: sent.fixtureLabel,
    rawBody: sent.rawBody,
    rawUtf8: sent.rawUtf8,
    byteLength: sent.byteLength,
    qos: sent.qos,
    puback: sent.puback,
    clientId: sent.clientId,
    mqttUrl: sent.mqttUrl,
    requestHeaders: sent.requestHeaders,
    responseStatus: sent.responseStatus,
    responseBody: sent.responseBody,
    actor: sent.actor || 'edge-simulator',
    ...extra,
  };
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

let failed = null;
try {
  await waitHealth(child);
  const auth = await login();

  const httpSent = await sendViaEdge(['--channel', 'http', '--fixture', 'recognition.golden.json']);
  if (httpSent.responseBody?.accepted !== true) {
    record(wire(httpSent, { id: 'http-golden', pass: false, error: 'HTTP 黄金报文未被接受' }));
    throw new Error(`接入失败 ${httpSent.responseStatus} ${JSON.stringify(httpSent.responseBody)}`);
  }
  const httpList = await listRecognitions(auth, httpSent.rawBody.cameraCode);
  const httpHit = (httpList.items || []).find(
    (item) => item.idempotencyKey === httpSent.rawBody.idempotencyKey && item.source === 'http',
  );
  if (!httpHit) {
    record(wire(httpSent, { id: 'http-golden', pass: false, error: '列表没有 HTTP 黄金报文' }));
    throw new Error(`列表未找到 HTTP 黄金报文 ${JSON.stringify(httpList)}`);
  }
  record(
    wire(httpSent, {
      id: 'http-golden',
      pass: true,
      proof: {
        recognitionId: httpHit.id,
        source: httpHit.source,
        idempotencyKey: httpHit.idempotencyKey,
        mushroomCount: httpHit.mushroomCount,
        cameraCode: httpHit.cameraCode,
      },
    }),
  );

  const unknownSent = await sendViaEdge([
    '--channel',
    'http',
    '--fixture',
    'recognition.unknown-field.json',
  ]);
  const unknownExpect = readFixture('recognition.unknown-field.json').expect;
  const unknownOk =
    unknownSent.responseStatus === 400 && unknownSent.responseBody?.code === unknownExpect;
  record(
    wire(unknownSent, {
      id: 'http-unknown',
      pass: unknownOk,
      error: unknownOk ? undefined : '未知字段未被拒绝',
      proof: unknownOk
        ? { code: unknownSent.responseBody.code, errors: unknownSent.responseBody.errors }
        : undefined,
    }),
  );
  if (!unknownOk) {
    throw new Error(
      `未知字段未被拒绝 ${unknownSent.responseStatus} ${JSON.stringify(unknownSent.responseBody)}`,
    );
  }

  const mqttFixture = readFixture('recognition.mqtt.json');
  await clearIdempotency(mqttFixture.body.idempotencyKey);
  const mqtt = await publishUntil(
    'mqtt-golden',
    ['--channel', 'mqtt', '--fixture', 'recognition.mqtt.json'],
    async (sent) => {
      const listBody = await listRecognitions(auth, sent.rawBody.cameraCode);
      const hit = (listBody.items || []).find(
        (item) => item.idempotencyKey === sent.rawBody.idempotencyKey && item.source === 'mqtt',
      );
      if (!hit) return null;
      if (hit.mushroomCount !== mqttFixture.body.mushroomCount) {
        throw new Error(`MQTT 报文内容不一致 ${JSON.stringify(hit)}`);
      }
      return {
        recognitionId: hit.id,
        source: hit.source,
        idempotencyKey: hit.idempotencyKey,
        mushroomCount: hit.mushroomCount,
        cameraCode: hit.cameraCode,
      };
    },
    25_000,
  );
  record(wire(mqtt.sent, { id: 'mqtt-golden', attempts: mqtt.attempts, proof: mqtt.proof, pass: true }));

  const beforeDuplicate = await listRecognitions(auth, httpSent.rawBody.cameraCode);
  const duplicateFile = replayPath('http-golden.json', httpSent.rawUtf8);
  const duplicateSent = await sendViaEdge([
    '--channel',
    'mqtt',
    '--fixture',
    'recognition.golden.json',
    '--raw-utf8-file',
    duplicateFile,
  ]);
  const duplicateDeadline = Date.now() + 4_000;
  let duplicateProof = null;
  while (Date.now() < duplicateDeadline) {
    await sleep(400);
    const afterDuplicate = await listRecognitions(auth, httpSent.rawBody.cameraCode);
    if (afterDuplicate.total !== beforeDuplicate.total) {
      record(
        wire(duplicateSent, {
          id: 'mqtt-duplicate',
          pass: false,
          error: 'MQTT 与 HTTP 幂等未共享',
          proof: { totalBefore: beforeDuplicate.total, totalAfter: afterDuplicate.total },
        }),
      );
      throw new Error(`MQTT 与 HTTP 幂等未共享 ${JSON.stringify(afterDuplicate)}`);
    }
    const same = (afterDuplicate.items || []).filter(
      (item) => item.idempotencyKey === httpSent.rawBody.idempotencyKey,
    );
    if (same.length !== 1 || same[0].source !== 'http') {
      record(
        wire(duplicateSent, {
          id: 'mqtt-duplicate',
          pass: false,
          error: 'HTTP 记录被 MQTT 重复报文改写',
          proof: { sources: same.map((item) => item.source) },
        }),
      );
      throw new Error(`HTTP 记录被 MQTT 重复报文改写 ${JSON.stringify(same)}`);
    }
    duplicateProof = {
      totalBefore: beforeDuplicate.total,
      totalAfter: afterDuplicate.total,
      idempotencyKey: httpSent.rawBody.idempotencyKey,
      source: same[0].source,
      recognitionId: same[0].id,
    };
  }
  record(wire(duplicateSent, { id: 'mqtt-duplicate', pass: true, proof: duplicateProof }));

  const unknownMqttFixture = readFixture('recognition.unknown-field.json');
  const since = new Date(Date.now() - 2000).toISOString();
  const rejected = await publishUntil(
    'mqtt-unknown',
    ['--channel', 'mqtt', '--fixture', 'recognition.unknown-field.json'],
    async (sent) => {
      const row = await withPg(async (db) => {
        const result = await db.query(
          `SELECT source, errors
           FROM ingest_rejects
           WHERE source = 'mqtt'
             AND payload->>'idempotencyKey' = $1
             AND created_at >= $2
           ORDER BY created_at DESC
           LIMIT 1`,
          [sent.rawBody.idempotencyKey, since],
        );
        return result.rows[0] || null;
      });
      if (!row) return null;
      const text = JSON.stringify(row.errors);
      if (!text.includes('未知字段')) throw new Error(`MQTT 未知字段未被拒绝 ${text}`);
      const listed = await listRecognitions(auth, sent.rawBody.cameraCode);
      if ((listed.items || []).some((item) => item.idempotencyKey === sent.rawBody.idempotencyKey)) {
        throw new Error(`MQTT 未知字段被写入识别列表 ${JSON.stringify(listed)}`);
      }
      return {
        table: 'ingest_rejects',
        source: row.source,
        errors: row.errors,
        idempotencyKey: sent.rawBody.idempotencyKey,
        absentFromRecognitionList: true,
      };
    },
    15_000,
  );
  if (rejected.sent.rawBody.idempotencyKey !== unknownMqttFixture.body.idempotencyKey) {
    throw new Error('MQTT 未知字段夹具键不一致');
  }
  record(
    wire(rejected.sent, {
      id: 'mqtt-unknown',
      attempts: rejected.attempts,
      proof: rejected.proof,
      pass: true,
    }),
  );

  const heartbeat = await publishUntil(
    'mqtt-heartbeat',
    ['--channel', 'mqtt', '--heartbeat', '--fixture', 'heartbeat.mqtt.json'],
    async (sent) => {
      const deviceCode = sent.rawBody.deviceCode;
      const row = await withPg(async (db) => {
        const result = await db.query(
          `SELECT code, type, shed_code, online_status, last_seen_at
           FROM devices
           WHERE code = $1`,
          [deviceCode],
        );
        return result.rows[0] || null;
      });
      if (!row || row.online_status !== 'online') return null;
      if (row.type !== sent.rawBody.deviceType) {
        throw new Error(`心跳设备类型不符 ${JSON.stringify(row)}`);
      }
      return {
        table: 'devices',
        code: row.code,
        type: row.type,
        shedCode: row.shed_code,
        onlineStatus: row.online_status,
        lastSeenAt: row.last_seen_at,
      };
    },
    15_000,
  );
  record(
    wire(heartbeat.sent, {
      id: 'mqtt-heartbeat',
      attempts: heartbeat.attempts,
      proof: heartbeat.proof,
      pass: true,
    }),
  );

  const createFixture = readFixture('alert.create.json');
  const createUtf8 = JSON.stringify(createFixture.body);
  const created = await fetch(`${base}/alerts`, {
    method: 'POST',
    headers: auth,
    body: createUtf8,
  });
  const alert = await created.json();
  const alertCreatedOk = created.ok && alert.status === 'open';
  record({
    id: 'alert-create',
    timestamp: new Date().toISOString(),
    channel: 'http',
    method: 'POST',
    path: '/api/v1/alerts',
    url: `${base}/alerts`,
    fixture: 'alert.create.json',
    fixtureLabel: '契约黄金报文',
    rawBody: createFixture.body,
    rawUtf8: createUtf8,
    byteLength: Buffer.byteLength(createUtf8),
    responseStatus: created.status,
    responseBody: alert,
    actor: 'smoke',
    pass: alertCreatedOk,
    error: alertCreatedOk ? undefined : '创建告警失败',
    proof: alertCreatedOk ? { alertId: alert.id, status: alert.status } : undefined,
  });
  if (!alertCreatedOk) throw new Error(`创建告警失败 ${created.status} ${JSON.stringify(alert)}`);

  const ackFixture = readFixture('alert.ack.json');
  const ackUtf8 = JSON.stringify(ackFixture.body);
  const acked = await fetch(`${base}/alerts/${alert.id}/ack`, {
    method: 'POST',
    headers: auth,
    body: ackUtf8,
  });
  const ackedBody = await acked.json();
  const ackedOk = acked.ok && ackedBody.status === 'acked';
  record({
    id: 'alert-ack',
    timestamp: new Date().toISOString(),
    channel: 'http',
    method: 'POST',
    path: `/api/v1/alerts/${alert.id}/ack`,
    url: `${base}/alerts/${alert.id}/ack`,
    fixture: 'alert.ack.json',
    fixtureLabel: '契约黄金报文',
    rawBody: ackFixture.body,
    rawUtf8: ackUtf8,
    byteLength: Buffer.byteLength(ackUtf8),
    responseStatus: acked.status,
    responseBody: ackedBody,
    actor: 'smoke',
    pass: ackedOk,
    error: ackedOk ? undefined : '确认告警失败',
    proof: ackedOk ? { alertId: ackedBody.id, status: ackedBody.status } : undefined,
  });
  if (!ackedOk) throw new Error(`确认告警失败 ${acked.status} ${JSON.stringify(ackedBody)}`);

  console.log('smoke ok', {
    recognitionId: httpHit.id,
    mqttRecognitionId: mqtt.proof.recognitionId,
    alertId: alert.id,
    evidence: join(evidenceDir, 'summary.json'),
  });
} catch (error) {
  failed = error;
  console.error(error);
} finally {
  try {
    evidence.finish({
      pass: !failed,
      error: failed ? failed.message : null,
      startedAt,
      mqttUrl: mqttUrl(),
      apiBase: base,
    });
    console.log(`evidence ${join(evidenceDir, 'summary.json')}`);
  } catch (error) {
    console.error(error);
    failed = failed || error;
  }
  const exited = new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once('exit', resolve);
  });
  child.kill('SIGTERM');
  await Promise.race([
    exited,
    sleep(5000).then(() => {
      child.kill('SIGKILL');
    }),
  ]);
  await exited;
}

if (failed) process.exit(1);
