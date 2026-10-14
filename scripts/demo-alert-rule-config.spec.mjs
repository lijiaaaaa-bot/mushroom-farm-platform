import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  ALERT_TITLE,
  CLOSE_NOTE,
  DEMO_SENSOR,
  DEMO_SHED,
  RULE_METRIC,
  RULE_NAME,
  SAMPLE_CO2,
  SAMPLE_HUMIDITY,
  SAMPLE_MOISTURE,
  SAMPLE_TEMPERATURE,
  SEED_RULE_NAME,
  SEED_THRESHOLD,
  THRESHOLD_FIRE,
  THRESHOLD_QUIET,
  alertDetailUrl,
  alertListUrl,
  assertFireRow,
  assertSeedRule,
  buildSample,
  formatRuleConfigProof,
  rulesUrl,
  sendAlertRuleConfigDemo,
  validateSample,
} from './demo-alert-rule-config.mjs';
import { readFixture, repoRoot } from './lib/ingest-wire.mjs';

const now = new Date('2026-10-14T01:02:03.004Z');
const ruleId = '88888888-8888-4888-8888-888888888888';
const seedId = 'seed-temp';
const finalAlertId = 'alert-again';

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

function seedRule() {
  return {
    id: seedId,
    name: SEED_RULE_NAME,
    metric: RULE_METRIC,
    threshold: SEED_THRESHOLD,
    enabled: true,
    shedCode: null,
    level: 'severe',
  };
}

function ruleBody(threshold = THRESHOLD_QUIET, id = ruleId) {
  return {
    id,
    name: RULE_NAME,
    metric: RULE_METRIC,
    threshold,
    level: 'warning',
    enabled: true,
    shedCode: DEMO_SHED,
    windowMinutes: 720,
  };
}

function alertBody(id, threshold = THRESHOLD_FIRE) {
  return {
    id,
    ruleId,
    shedCode: DEMO_SHED,
    cameraCode: null,
    sensorCode: DEMO_SENSOR,
    level: 'warning',
    status: 'open',
    title: ALERT_TITLE,
    message: `棚区 ${DEMO_SHED} 传感器 ${DEMO_SENSOR} 温度过高 ${SAMPLE_TEMPERATURE}，阈值 ${threshold}`,
    metric: RULE_METRIC,
    metricValue: SAMPLE_TEMPERATURE,
    threshold,
    createdAt: now.toISOString(),
  };
}

function installFetch(state) {
  const calls = [];
  const original = globalThis.fetch;
  let alertSeq = 0;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    const method = init.method || 'GET';
    calls.push(`${method} ${target}`);
    if (target.endsWith('/auth/login')) {
      assert.deepEqual(JSON.parse(init.body), { username: 'admin', password: 'Admin@123456' });
      return jsonResponse(200, { accessToken: 'tok' });
    }
    if (target.endsWith('/alert-rules') && method === 'GET') {
      return jsonResponse(200, state.rules);
    }
    if (target.endsWith('/alert-rules') && method === 'POST') {
      const body = JSON.parse(init.body);
      assert.equal(body.name, RULE_NAME);
      assert.equal(body.metric, RULE_METRIC);
      assert.equal(body.threshold, THRESHOLD_QUIET);
      assert.equal(body.level, 'warning');
      assert.equal(body.shedCode, DEMO_SHED);
      const created = ruleBody(body.threshold);
      state.rules.push(created);
      return jsonResponse(201, created);
    }
    if (method === 'PATCH' && target.includes('/alert-rules/')) {
      const id = target.split('/alert-rules/')[1];
      assert.equal(id, ruleId);
      assert.equal(init.headers.authorization, 'Bearer tok');
      const body = JSON.parse(init.body);
      const rule = state.rules.find((item) => item.id === id);
      assert.ok(rule);
      rule.threshold = body.threshold;
      if (body.enabled !== undefined) rule.enabled = body.enabled;
      if (body.level !== undefined) rule.level = body.level;
      state.patches.push(body.threshold);
      return jsonResponse(200, { ...rule });
    }
    if (method === 'GET' && target.includes('/alerts?')) {
      const status = new URL(target).searchParams.get('status');
      const shedCode = new URL(target).searchParams.get('shedCode');
      const items = state.alerts.filter(
        (row) => row.shedCode === shedCode && row.status === status,
      );
      return jsonResponse(200, { items, total: items.length });
    }
    if (method === 'POST' && target.includes('/alerts/') && target.endsWith('/close')) {
      const id = target.split('/alerts/')[1].replace(/\/close$/, '');
      assert.equal(JSON.parse(init.body).note, CLOSE_NOTE);
      const row = state.alerts.find((item) => item.id === id);
      assert.ok(row);
      row.status = 'closed';
      row.closeNote = CLOSE_NOTE;
      return jsonResponse(201, row);
    }
    if (target.endsWith('/ingest/environment')) {
      const body = JSON.parse(init.body);
      assert.equal(body.sensorCode, DEMO_SENSOR);
      assert.equal(body.shedCode, DEMO_SHED);
      assert.equal(body.temperature, SAMPLE_TEMPERATURE);
      assert.equal(init.headers['x-ingest-token'], 'dev-ingest-token');
      state.ingests.push(body.idempotencyKey);
      if (!state.forceAlert) {
        for (const candidate of state.rules) {
          if (candidate.enabled !== true || candidate.metric !== RULE_METRIC) continue;
          if (candidate.shedCode && candidate.shedCode !== body.shedCode) continue;
          if (!(body.temperature > candidate.threshold)) continue;
          const blocking = state.alerts.some(
            (row) =>
              row.ruleId === candidate.id &&
              row.sensorCode === body.sensorCode &&
              (row.status === 'open' || row.status === 'acked'),
          );
          if (blocking) continue;
          alertSeq += 1;
          const id = state.nextAlertId || (alertSeq === 1 ? 'alert-fire' : finalAlertId);
          state.nextAlertId = undefined;
          state.alerts.unshift(alertBody(id, candidate.threshold));
        }
      } else {
        alertSeq += 1;
        state.alerts.unshift(alertBody(`forced-${alertSeq}`, THRESHOLD_QUIET));
      }
      return jsonResponse(200, {
        accepted: true,
        duplicate: false,
        id: `reading-${state.ingests.length}`,
      });
    }
    if (method === 'GET' && /\/alerts\/[^/]+$/.test(target)) {
      const id = target.split('/alerts/')[1];
      const row = state.alerts.find((item) => item.id === id);
      if (!row) return jsonResponse(404, { message: '没有这条告警' });
      return jsonResponse(200, row);
    }
    return jsonResponse(404, { message: `未模拟 ${method} ${target}` });
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

test('the sample sits between the edited thresholds and under the seed rule', () => {
  const root = repoRoot();
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  assert.match(
    makefile,
    /^demo-alert-rule-config:.*\n\tnode scripts\/demo-alert-rule-config\.mjs\s*$/m,
  );
  assert.match(makefile, /scripts\/demo-alert-rule-config\.spec\.mjs/);
  const quiet = buildSample(now, 'quiet');
  const fire = buildSample(now, 'fire');
  const raised = buildSample(now, 'raised');
  const again = buildSample(now, 'again');
  assert.equal(quiet.temperature, SAMPLE_TEMPERATURE);
  assert.equal(quiet.humidity, SAMPLE_HUMIDITY);
  assert.equal(quiet.co2, SAMPLE_CO2);
  assert.equal(quiet.substrateMoisture, SAMPLE_MOISTURE);
  assert.equal(quiet.shedCode, DEMO_SHED);
  assert.equal(quiet.sensorCode, DEMO_SENSOR);
  assert.ok(SAMPLE_TEMPERATURE > THRESHOLD_FIRE);
  assert.ok(SAMPLE_TEMPERATURE < SEED_THRESHOLD);
  assert.ok(SAMPLE_TEMPERATURE < THRESHOLD_QUIET);
  assert.notEqual(quiet.idempotencyKey, fire.idempotencyKey);
  assert.notEqual(fire.idempotencyKey, raised.idempotencyKey);
  assert.notEqual(raised.idempotencyKey, again.idempotencyKey);
  assert.equal(validateSample(quiet, now).temperature, SAMPLE_TEMPERATURE);
  assert.throws(() => validateSample({ ...quiet, temperature: 32 }, now), /应为 26/);
  assert.doesNotThrow(() => assertSeedRule(seedRule()));
  assert.throws(
    () => assertSeedRule({ ...seedRule(), threshold: THRESHOLD_FIRE }),
    /不改它/,
  );
  const telem = readFixture('environment.demo-telemetry-threshold.json');
  const latest = readFixture('environment.demo-latest.json');
  const golden = readFixture('environment.golden.json');
  assert.equal(telem.body.sensorCode, 'SENSOR-TELEM-01');
  assert.equal(telem.body.temperature, 32);
  assert.equal(latest.body.sensorCode, 'SENSOR-LATEST-01');
  assert.equal(latest.body.temperature, 24.6);
  assert.equal(golden.body.temperature, 22.5);
  const seed = readFileSync(join(root, 'apps/api/src/seed/seed.service.ts'), 'utf8');
  assert.match(seed, /name: '温度过高',\s*metric: 'temperature_high',\s*threshold: 28,/);
  const row = assertFireRow(alertBody(finalAlertId), ruleId);
  assert.equal(row.threshold, THRESHOLD_FIRE);
  const proof = formatRuleConfigProof({
    closedBefore: 0,
    closedBeforeRaise: 1,
    quietReadingId: 'reading-1',
    raisedReadingId: 'reading-3',
    detail: row,
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /阈值 30 时未告警: 是/);
  assert.match(proof, /阈值: 30 → 24/);
  assert.match(proof, /把阈值改回 30 后未告警: 是/);
  assert.match(proof, /最终阈值: 24/);
  assert.match(proof, /当前值: 26/);
  assert.match(proof, /级别: 一般/);
  assert.match(proof, /状态: 待确认/);
  assert.match(proof, /登录: admin \/ Admin@123456/);
  assert.ok(proof.includes(rulesUrl('http://127.0.0.1:43123')));
  assert.ok(proof.includes(alertListUrl(finalAlertId, 'http://127.0.0.1:43123')));
  assert.ok(proof.includes(alertDetailUrl(finalAlertId, 'http://127.0.0.1:43123')));
});

test('lowering then raising the rule decides whether the same temperature opens an alert', async () => {
  const state = {
    rules: [seedRule()],
    alerts: [],
    patches: [],
    ingests: [],
    forceAlert: false,
  };
  const installed = installFetch(state);
  try {
    const result = await sendAlertRuleConfigDemo({ now });
    assert.equal(result.closedBefore, 0);
    assert.equal(result.closedBeforeRaise, 1);
    assert.equal(result.quietReadingId, 'reading-1');
    assert.equal(result.raisedReadingId, 'reading-3');
    assert.equal(result.againReadingId, 'reading-4');
    assert.equal(result.detail.id, finalAlertId);
    assert.equal(result.detail.threshold, THRESHOLD_FIRE);
    assert.equal(result.detail.metricValue, SAMPLE_TEMPERATURE);
    assert.equal(result.detail.level, 'warning');
    assert.equal(result.detail.sensorCode, DEMO_SENSOR);
    assert.equal(result.detail.cameraCode, null);
    assert.deepEqual(state.patches, [
      THRESHOLD_QUIET,
      THRESHOLD_FIRE,
      THRESHOLD_QUIET,
      THRESHOLD_FIRE,
    ]);
    assert.equal(state.ingests.length, 4);
    assert.equal(state.rules.find((rule) => rule.id === seedId).threshold, SEED_THRESHOLD);
    assert.equal(state.rules.find((rule) => rule.id === ruleId).threshold, THRESHOLD_FIRE);
    assert.equal(state.rules.find((rule) => rule.id === ruleId).enabled, true);
    assert.equal(
      installed.calls.filter((line) => line.includes(`/alert-rules/${seedId}`)).length,
      0,
    );
    const open = state.alerts.filter((row) => row.status === 'open');
    assert.equal(open.length, 1);
    assert.equal(open[0].id, finalAlertId);
    assert.equal(open[0].threshold, THRESHOLD_FIRE);
    assert.match(formatRuleConfigProof(result), /列表里有这一条: 是/);
  } finally {
    installed.restore();
  }
});

test('an open alert on this sensor is closed, and other sensors stay open', async () => {
  const state = {
    rules: [seedRule(), ruleBody(20)],
    alerts: [
      alertBody('old-rule', 20),
      {
        id: 'telem-alert',
        ruleId: seedId,
        shedCode: 'S01',
        cameraCode: null,
        sensorCode: 'SENSOR-TELEM-01',
        metric: RULE_METRIC,
        status: 'open',
        title: ALERT_TITLE,
        level: 'severe',
        message: '棚区 S01 传感器 SENSOR-TELEM-01 温度过高 32，阈值 28',
        metricValue: 32,
        threshold: SEED_THRESHOLD,
      },
    ],
    patches: [],
    ingests: [],
    forceAlert: false,
  };
  const installed = installFetch(state);
  try {
    const result = await sendAlertRuleConfigDemo({ now });
    assert.equal(result.closedBefore, 1);
    assert.equal(state.alerts.find((row) => row.id === 'old-rule').status, 'closed');
    assert.equal(state.alerts.find((row) => row.id === 'telem-alert').status, 'open');
    assert.equal(
      installed.calls.filter((line) => line.includes('/alerts/telem-alert/close')).length,
      0,
    );
    assert.equal(result.detail.shedCode, DEMO_SHED);
    assert.equal(state.rules.find((rule) => rule.id === seedId).threshold, SEED_THRESHOLD);
  } finally {
    installed.restore();
  }
});

test('a reading that still alerts at the quiet threshold fails the demo', async () => {
  const state = {
    rules: [seedRule(), ruleBody(THRESHOLD_QUIET)],
    alerts: [],
    patches: [],
    ingests: [],
    forceAlert: true,
  };
  const installed = installFetch(state);
  try {
    await assert.rejects(() => sendAlertRuleConfigDemo({ now }), /阈值 30 时温度 26 仍产生了告警/);
  } finally {
    installed.restore();
  }
});

test('the written steps name this make target and leave the earlier demos alone', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_ALERT_RULE_CONFIG.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  assert.match(doc, /make demo-alert-rule-config/);
  assert.match(doc, /admin/);
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /SENSOR-RULE-01/);
  assert.match(doc, /S03/);
  assert.match(doc, /30/);
  assert.match(doc, /24/);
  assert.match(doc, /26/);
  assert.match(doc, /28/);
  assert.match(doc, /\/alerts/);
  assert.match(doc, /\/alert-rules/);
  assert.match(doc, /阈值 30 时/);
  assert.match(doc, /改回 30/);
  assert.match(caps, /make demo-alert-rule-config/);
  assert.match(caps, /DEMO_ALERT_RULE_CONFIG\.md/);
  assert.match(status, /make demo-alert-rule-config/);
  assert.doesNotMatch(readme, /demo-alert-rule-config|DEMO_ALERT_RULE_CONFIG/);
  const untouched = [
    'docs/DEMO_ONE_ALERT.md',
    'docs/DEMO_THRESHOLD_ALERT.md',
    'docs/DEMO_TELEMETRY_THRESHOLD_ALERT.md',
    'docs/DEMO_TELEMETRY_LATEST.md',
    'docs/DEMO_ALERT_SNAPSHOT_MINIO.md',
    'docs/DEMO_ACK_CLOSE_ALERT.md',
    'scripts/demo-one-alert.mjs',
    'scripts/demo-threshold-alert.mjs',
    'scripts/demo-telemetry-threshold-alert.mjs',
    'scripts/demo-telemetry-latest.mjs',
    'scripts/demo-alert-snapshot-minio.mjs',
  ];
  for (const name of untouched) {
    const text = readFileSync(join(root, name), 'utf8');
    assert.doesNotMatch(text, /SENSOR-RULE-01|demo-alert-rule-config/);
  }
  assert.match(makefile, /^demo-telemetry-threshold-alert:.*\n\tnode scripts\/demo-telemetry-threshold-alert\.mjs\s*$/m);
  assert.match(makefile, /^demo-threshold-alert:.*\n\tnode scripts\/demo-threshold-alert\.mjs\s*$/m);
  assert.match(makefile, /^demo-one-alert:.*\n\tnode scripts\/demo-one-alert\.mjs\s*$/m);
  assert.match(makefile, /^demo-telemetry-latest:.*\n\tnode scripts\/demo-telemetry-latest\.mjs\s*$/m);
  assert.match(makefile, /^demo-alert-snapshot-minio:.*\n\tnode scripts\/demo-alert-snapshot-minio\.mjs\s*$/m);
});
