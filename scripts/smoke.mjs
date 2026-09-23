import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { withRuntimeClock } = require(join(root, 'packages/contracts/dist/index.js'));

const base = process.env.API_BASE || 'http://127.0.0.1:41821/api/v1';
const ingestToken = process.env.INGEST_TOKEN || 'dev-ingest-token';

function fixture(name) {
  return JSON.parse(readFileSync(join(root, 'packages/contracts/fixtures', name), 'utf8'));
}

async function waitHealth(child) {
  const deadline = Date.now() + 60_000;
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
    MQTT_ENABLED: 'false',
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
  const found = (listBody.items || []).some(
    (item) => item.idempotencyKey === golden.body.idempotencyKey,
  );
  if (!listed.ok || !found) throw new Error(`列表未找到黄金报文 ${JSON.stringify(listBody)}`);

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
