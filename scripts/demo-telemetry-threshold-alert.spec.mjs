import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  ALERT_TITLE,
  CLOSE_NOTE,
  DEMO_CO2,
  DEMO_FIXTURE,
  DEMO_HUMIDITY,
  DEMO_MOISTURE,
  DEMO_SENSOR,
  DEMO_SHED,
  DEMO_TEMPERATURE,
  SEED_RULE_NAME,
  SEED_THRESHOLD,
  alertDetailUrl,
  alertListUrl,
  assertAlertDetail,
  assertSeedRule,
  buildDemoPayload,
  formatDemoProof,
  resolveChannel,
  sendDemo,
  validateDemoPayload,
} from './demo-telemetry-threshold-alert.mjs';
import { readFixture, repoRoot } from './lib/ingest-wire.mjs';

const now = new Date('2026-10-14T01:02:03.004Z');

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

function detail(id = 'alert-telem-1') {
  return {
    id,
    ruleId: 'rule-temp',
    shedCode: DEMO_SHED,
    cameraCode: null,
    sensorCode: DEMO_SENSOR,
    level: 'severe',
    status: 'open',
    title: ALERT_TITLE,
    message: `棚区 ${DEMO_SHED} 传感器 ${DEMO_SENSOR} 温度过高 ${DEMO_TEMPERATURE}，阈值 ${SEED_THRESHOLD}`,
    metric: 'temperature_high',
    metricValue: DEMO_TEMPERATURE,
    threshold: SEED_THRESHOLD,
    createdAt: now.toISOString(),
  };
}

test('checked-in sample is over the temperature seed rule and make posts it', () => {
  const root = repoRoot();
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  assert.match(
    makefile,
    /^demo-telemetry-threshold-alert:.*\n\tnode scripts\/demo-telemetry-threshold-alert\.mjs\s*$/m,
  );
  assert.match(makefile, /^demo-telemetry-latest:/m);
  assert.match(makefile, /^demo-one-alert:/m);
  assert.match(makefile, /^demo-threshold-alert:/m);
  const fixture = readFixture(DEMO_FIXTURE);
  assert.equal(fixture.expect, 'ok');
  assert.equal(fixture.body.sensorCode, DEMO_SENSOR);
  assert.equal(fixture.body.temperature, DEMO_TEMPERATURE);
  assert.equal(fixture.body.humidity, DEMO_HUMIDITY);
  assert.equal(fixture.body.co2, DEMO_CO2);
  assert.equal(fixture.body.substrateMoisture, DEMO_MOISTURE);
  const golden = readFixture('environment.golden.json');
  const latest = readFixture('environment.demo-latest.json');
  assert.equal(golden.body.temperature, 22.5);
  assert.equal(golden.body.sensorCode, 'SENSOR-S01');
  assert.equal(latest.body.temperature, 24.6);
  assert.equal(latest.body.sensorCode, 'SENSOR-LATEST-01');
  const seed = readFileSync(join(root, 'apps/api/src/seed/seed.service.ts'), 'utf8');
  assert.match(seed, /name: '温度过高',\s*metric: 'temperature_high',\s*threshold: 28,/);
  const body = buildDemoPayload(now);
  assert.equal(body.observedAt, now.toISOString());
  assert.match(body.idempotencyKey, /^demo-telemetry-threshold-\d+$/);
  assert.notEqual(body.idempotencyKey, fixture.body.idempotencyKey);
  const value = validateDemoPayload(body, now);
  assert.equal(value.temperature, DEMO_TEMPERATURE);
  assert.doesNotThrow(() =>
    assertSeedRule({
      name: SEED_RULE_NAME,
      metric: 'temperature_high',
      threshold: SEED_THRESHOLD,
      enabled: true,
      shedCode: null,
    }),
  );
  assert.throws(() => assertSeedRule({ ...{ name: SEED_RULE_NAME, metric: 'temperature_high', threshold: 30, enabled: true } }), /不改它/);
  const proof = formatDemoProof({
    channel: 'http',
    readingId: 'env-1',
    detail: detail(),
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /发了 1 条环境遥测/);
  assert.match(proof, /读数 id: env-1/);
  assert.match(proof, /传感器: SENSOR-TELEM-01/);
  assert.match(proof, /温度: 32℃/);
  assert.match(proof, /标题: 温度过高告警/);
  assert.match(proof, /状态: 待确认/);
  assert.match(proof, /当前值: 32/);
  assert.match(proof, /登录: admin \/ Admin@123456/);
  assert.ok(proof.includes(alertListUrl('alert-telem-1')));
  assert.ok(proof.includes(alertDetailUrl('alert-telem-1')));
  assert.equal(resolveChannel(['node', 'script']), 'http');
  assert.equal(resolveChannel(['node', 'script', '--channel', 'mqtt']), 'mqtt');
  assert.throws(() => resolveChannel(['node', 'script', '--channel', 'tcp']), /http 或 mqtt/);
  assert.throws(() => validateDemoPayload({ ...body, temperature: 22.5 }, now), /应为 32/);
});

test('the written steps name this make target and leave the other demos alone', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_TELEMETRY_THRESHOLD_ALERT.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const script = readFileSync(join(root, 'scripts/demo-telemetry-threshold-alert.mjs'), 'utf8');
  assert.match(doc, /make demo-telemetry-threshold-alert/);
  assert.match(doc, /admin/);
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /SENSOR-TELEM-01/);
  assert.match(doc, /32/);
  assert.match(doc, /28/);
  assert.match(doc, /\/alerts/);
  assert.match(doc, /环境遥测/);
  assert.match(caps, /make demo-telemetry-threshold-alert/);
  assert.match(caps, /DEMO_TELEMETRY_THRESHOLD_ALERT\.md/);
  const added = readme.split('\n').filter((line) => line.includes('DEMO_TELEMETRY_THRESHOLD_ALERT.md'));
  assert.equal(added.length, 1);
  assert.doesNotMatch(script, /CAM-ALERT-01|CAM-THRESH-01|SENSOR-LATEST-01|demo-one-alert|demo-threshold-alert/);
  for (const name of [
    'docs/DEMO_ONE_ALERT.md',
    'docs/DEMO_THRESHOLD_ALERT.md',
    'docs/DEMO_TELEMETRY_LATEST.md',
    'docs/DEMO_ALERT_SNAPSHOT_MINIO.md',
    'docs/DEMO_ACK_CLOSE_ALERT.md',
    'scripts/demo-one-alert.mjs',
    'scripts/demo-threshold-alert.mjs',
    'scripts/demo-telemetry-latest.mjs',
  ]) {
    const text = readFileSync(join(root, name), 'utf8');
    assert.doesNotMatch(text, /SENSOR-TELEM-01|demo-telemetry-threshold-alert/);
  }
});

test('http send closes an old sensor alert, posts the sample, and reads the new alert', async () => {
  const original = globalThis.fetch;
  const calls = [];
  const payloads = buildDemoPayload(now);
  let phase = 'open-old';
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    calls.push({ target, method: init.method || 'GET', body: init.body });
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.endsWith('/alert-rules')) {
      return jsonResponse(200, [
        {
          id: 'rule-temp',
          name: SEED_RULE_NAME,
          metric: 'temperature_high',
          threshold: SEED_THRESHOLD,
          enabled: true,
          shedCode: null,
          level: 'severe',
        },
      ]);
    }
    if (target.endsWith('/alerts/alert-old/close')) {
      const body = JSON.parse(init.body);
      assert.equal(body.note, CLOSE_NOTE);
      phase = 'closed';
      return jsonResponse(200, { id: 'alert-old', status: 'closed' });
    }
    if (target.endsWith('/ingest/environment')) {
      const body = JSON.parse(init.body);
      assert.equal(init.headers['x-ingest-token'], 'dev-ingest-token');
      assert.equal(body.temperature, DEMO_TEMPERATURE);
      assert.equal(body.sensorCode, DEMO_SENSOR);
      assert.equal(body.idempotencyKey, payloads.idempotencyKey);
      phase = 'ingested';
      return jsonResponse(201, { accepted: true, duplicate: false, id: 'env-new' });
    }
    if (target.includes('/alerts?') && target.includes('status=open')) {
      if (phase === 'open-old') {
        return jsonResponse(200, { items: [{ ...detail('alert-old'), status: 'open' }], total: 1 });
      }
      if (phase === 'ingested') return jsonResponse(200, { items: [detail()], total: 1 });
      return jsonResponse(200, { items: [], total: 0 });
    }
    if (target.includes('/alerts?') && target.includes('status=acked')) {
      return jsonResponse(200, { items: [], total: 0 });
    }
    if (target.endsWith('/alerts/alert-telem-1')) return jsonResponse(200, detail());
    throw new Error(`unexpected ${init.method || 'GET'} ${target}`);
  };
  try {
    const sent = await sendDemo({ channel: 'http', now });
    assert.equal(sent.readingId, 'env-new');
    assertAlertDetail(sent.detail);
    assert.equal(calls.some((call) => call.target.endsWith('/alerts/alert-old/close')), true);
    assert.equal(calls.filter((call) => String(call.target).endsWith('/ingest/environment')).length, 1);
  } finally {
    globalThis.fetch = original;
  }
});
