import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { DEMO_CAMERA, DEMO_FIXTURE, buildDemoPayload } from './demo-one-http-recognition.mjs';
import { readFixture, repoRoot } from './lib/ingest-wire.mjs';
import {
  CLOSE_NOTE,
  CO2_SAMPLE,
  RULE_METRIC,
  RULE_NAME,
  SEED_CO2_RULE_NAME,
  SEED_CO2_THRESHOLD,
  THRESHOLD_AFTER,
  THRESHOLD_BEFORE,
  THRESHOLD_CAMERA,
  THRESHOLD_SHED,
  THRESHOLD_TITLE,
  assertThresholdListRow,
  buildThresholdRecognition,
  formatThresholdProof,
  isOwnCo2Alert,
  sameNumber,
  sendThresholdAlertDemo,
} from './demo-threshold-alert.mjs';

const now = new Date('2026-10-14T01:02:03.004Z');
const recognitionId = '77777777-7777-4777-8777-777777777777';
const ruleId = '88888888-8888-4888-8888-888888888888';
const alertId = '99999999-9999-4999-8999-999999999999';
const oldAlertId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function ruleBody(threshold = THRESHOLD_BEFORE, id = ruleId) {
  return {
    id,
    name: RULE_NAME,
    metric: RULE_METRIC,
    threshold,
    level: 'warning',
    enabled: true,
    shedCode: THRESHOLD_SHED,
    windowMinutes: 720,
  };
}

function alertBody(id = alertId, threshold = THRESHOLD_AFTER) {
  return {
    id,
    ruleId,
    shedCode: THRESHOLD_SHED,
    cameraCode: THRESHOLD_CAMERA,
    level: 'warning',
    status: 'open',
    title: THRESHOLD_TITLE,
    message: `棚区 ${THRESHOLD_SHED} 摄像头 ${THRESHOLD_CAMERA} CO₂过高 ${CO2_SAMPLE}，阈值 ${threshold}`,
    metric: RULE_METRIC,
    metricValue: CO2_SAMPLE,
    threshold,
    createdAt: now.toISOString(),
  };
}

test('threshold recognition keeps the sample climate except CO₂ and camera', () => {
  const fixture = readFixture(DEMO_FIXTURE);
  const golden = readFixture('recognition.golden.json');
  assert.equal(fixture.body.cameraCode, DEMO_CAMERA);
  assert.equal(fixture.body.co2, 900);
  assert.equal(fixture.body.temperature, 22.5);
  assert.equal(golden.body.co2, 900);
  assert.ok(fixture.body.co2 <= THRESHOLD_AFTER);
  assert.ok(golden.body.co2 <= THRESHOLD_AFTER);
  assert.ok(CO2_SAMPLE > THRESHOLD_AFTER);
  assert.ok(CO2_SAMPLE < THRESHOLD_BEFORE);
  assert.ok(CO2_SAMPLE < SEED_CO2_THRESHOLD);
  const body = buildThresholdRecognition(now);
  assert.equal(body.cameraCode, THRESHOLD_CAMERA);
  assert.equal(body.shedCode, THRESHOLD_SHED);
  assert.equal(body.co2, CO2_SAMPLE);
  assert.equal(body.temperature, 22.5);
  assert.equal(body.diseaseCount, 1);
  assert.equal(body.recognizedAt, now.toISOString());
  assert.match(body.idempotencyKey, /^demo-thresh-\d+$/);
  assert.equal(body.snapshotBase64, fixture.body.snapshotBase64);
  assert.equal(readFixture(DEMO_FIXTURE).body.cameraCode, 'CAM-DEMO-01');
  assert.equal(readFixture(DEMO_FIXTURE).body.co2, 900);
  assert.equal(buildDemoPayload(now).cameraCode, 'CAM-DEMO-01');
  assert.equal(buildDemoPayload(now).co2, 900);
  assert.equal(isOwnCo2Alert(alertBody(), ruleId), true);
  assert.equal(isOwnCo2Alert({ ...alertBody(), status: 'closed' }, ruleId), false);
  assert.equal(isOwnCo2Alert({ ...alertBody(), cameraCode: 'CAM-ALERT-01' }, ruleId), false);
  assert.equal(sameNumber('1000', 1000), true);
});

test('proof names the edited threshold and the highlighted alert list', () => {
  const proof = formatThresholdProof({
    recognitionId,
    closedCount: 0,
    detail: alertBody(),
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, new RegExp(`规则: ${RULE_NAME}`));
  assert.match(proof, /指标: CO₂过高/);
  assert.match(proof, /阈值: 1500 → 1000/);
  assert.match(proof, /关闭旧告警: 0 条/);
  assert.match(proof, /发了 1 条识别/);
  assert.match(proof, new RegExp(`识别 id: ${recognitionId}`));
  assert.match(proof, /摄像头编号: CAM-THRESH-01/);
  assert.match(proof, /CO₂: 1200/);
  assert.match(proof, /告警: 新建/);
  assert.match(proof, /标题: CO₂过高告警/);
  assert.match(proof, /说明: 棚区 S01 摄像头 CAM-THRESH-01 CO₂过高 1200，阈值 1000/);
  assert.match(proof, /级别: 一般/);
  assert.match(proof, /状态: 待确认/);
  assert.match(proof, /列表里有这一条: 是/);
  assert.match(
    proof,
    new RegExp(
      `告警列表: http://127\\.0\\.0\\.1:43123/alerts\\?shedCode=S01&alertId=${alertId}`,
    ),
  );
  assert.match(proof, /阈值规则: http:\/\/127\.0\.0\.1:43123\/alert-rules/);
  assert.doesNotMatch(proof, /CAM-DEMO-01/);
  assert.doesNotMatch(proof, /CAM-ALERT-01/);
  assertThresholdListRow(alertBody(), ruleId);
});

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

function installFetch(state) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    const method = init?.method || 'GET';
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
      assert.equal(body.threshold, THRESHOLD_BEFORE);
      assert.equal(body.level, 'warning');
      assert.equal(body.shedCode, THRESHOLD_SHED);
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
      state.patches.push(body);
      return jsonResponse(200, { ...rule });
    }
    if (method === 'GET' && target.includes('/alerts?')) {
      const status = new URL(target).searchParams.get('status');
      const items = state.alerts.filter(
        (row) => row.shedCode === THRESHOLD_SHED && row.status === status,
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
    if (target.endsWith('/ingest/recognition')) {
      const body = JSON.parse(init.body);
      assert.equal(body.cameraCode, THRESHOLD_CAMERA);
      assert.equal(body.co2, CO2_SAMPLE);
      assert.equal(body.temperature, 22.5);
      assert.equal(init.headers['x-ingest-token'], 'dev-ingest-token');
      const rule = state.rules.find((item) => item.id === ruleId);
      const blocking = state.alerts.some(
        (row) =>
          row.ruleId === ruleId &&
          row.cameraCode === THRESHOLD_CAMERA &&
          (row.status === 'open' || row.status === 'acked'),
      );
      if (rule?.enabled && body.co2 > rule.threshold && !blocking) {
        state.alerts.unshift(alertBody());
      }
      return jsonResponse(200, { accepted: true, duplicate: false, id: recognitionId });
    }
    if (method === 'GET' && target.endsWith(`/alerts/${alertId}`)) {
      const row = state.alerts.find((item) => item.id === alertId);
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

test('editing the demo rule then ingesting CO₂ 1200 puts a matching row on the alert list', async () => {
  const state = {
    rules: [
      {
        id: 'seed-co2',
        name: SEED_CO2_RULE_NAME,
        metric: RULE_METRIC,
        threshold: SEED_CO2_THRESHOLD,
        level: 'severe',
        enabled: true,
        shedCode: null,
      },
    ],
    alerts: [],
    patches: [],
  };
  const installed = installFetch(state);
  try {
    const result = await sendThresholdAlertDemo({ now });
    assert.equal(result.recognitionId, recognitionId);
    assert.equal(result.closedCount, 0);
    assert.equal(result.detail.id, alertId);
    assert.equal(result.detail.title, THRESHOLD_TITLE);
    assert.equal(result.detail.threshold, THRESHOLD_AFTER);
    assert.equal(result.detail.metricValue, CO2_SAMPLE);
    assert.deepEqual(
      state.patches.map((body) => body.threshold),
      [THRESHOLD_BEFORE, THRESHOLD_AFTER],
    );
    assert.equal(state.patches[1].enabled, true);
    assert.equal(state.rules.find((rule) => rule.id === 'seed-co2').threshold, SEED_CO2_THRESHOLD);
    assert.equal(
      installed.calls.filter((line) => line.startsWith('PATCH ') && line.includes('seed-co2')).length,
      0,
    );
    assert.equal(
      installed.calls.filter((line) => line.endsWith('/ingest/recognition')).length,
      1,
    );
    assert.match(formatThresholdProof(result), /列表里有这一条: 是/);
  } finally {
    installed.restore();
  }
});

test('an open alert on the demo camera is closed before the new threshold creates another', async () => {
  const state = {
    rules: [ruleBody(800)],
    alerts: [
      { ...alertBody(oldAlertId, 800), threshold: 800, message: '旧告警' },
      {
        id: 'temp-alert',
        ruleId: 'seed-temp',
        shedCode: THRESHOLD_SHED,
        cameraCode: 'CAM-ALERT-01',
        metric: 'temperature_high',
        status: 'open',
        title: '温度过高告警',
        message: '棚区 S01 摄像头 CAM-ALERT-01 温度过高 30，阈值 28',
      },
    ],
    patches: [],
  };
  const installed = installFetch(state);
  try {
    const result = await sendThresholdAlertDemo({ now });
    assert.equal(result.closedCount, 1);
    assert.equal(result.detail.id, alertId);
    assert.equal(result.detail.threshold, THRESHOLD_AFTER);
    assert.equal(state.alerts.find((row) => row.id === oldAlertId).status, 'closed');
    assert.equal(state.alerts.find((row) => row.id === 'temp-alert').status, 'open');
    assert.equal(
      installed.calls.filter((line) => line.includes(`/alerts/${oldAlertId}/close`)).length,
      1,
    );
    assert.equal(installed.calls.filter((line) => line.includes('/alerts/temp-alert/close')).length, 0);
    assert.equal(state.rules.find((rule) => rule.name === SEED_CO2_RULE_NAME), undefined);
    assert.equal(state.rules.find((rule) => rule.id === ruleId).threshold, THRESHOLD_AFTER);
  } finally {
    installed.restore();
  }
});

test('the written steps name the make target and leave the earlier demos alone', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_THRESHOLD_ALERT.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const one = readFileSync(join(root, 'docs/DEMO_ONE_INGEST.md'), 'utf8');
  const registerDoc = readFileSync(join(root, 'docs/DEMO_REGISTER_AND_INGEST.md'), 'utf8');
  const heartbeatDoc = readFileSync(join(root, 'docs/DEMO_REGISTER_AND_HEARTBEAT.md'), 'utf8');
  const alertDoc = readFileSync(join(root, 'docs/DEMO_ONE_ALERT.md'), 'utf8');
  const ackDoc = readFileSync(join(root, 'docs/DEMO_ACK_CLOSE_ALERT.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  const alertScript = readFileSync(join(root, 'scripts/demo-one-alert.mjs'), 'utf8');
  const ackScript = readFileSync(join(root, 'scripts/demo-ack-close-alert.mjs'), 'utf8');
  assert.match(doc, /make demo-threshold-alert/);
  assert.match(doc, /admin/);
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /CAM-THRESH-01/);
  assert.match(doc, /1500/);
  assert.match(doc, /1000/);
  assert.match(doc, /1200/);
  assert.match(doc, /\/alerts/);
  assert.match(doc, /\/alert-rules/);
  assert.match(doc, /二氧化碳过高/);
  assert.match(caps, /make demo-threshold-alert/);
  assert.match(caps, /DEMO_THRESHOLD_ALERT\.md/);
  assert.match(status, /make demo-threshold-alert/);
  assert.match(readme, /DEMO_THRESHOLD_ALERT\.md/);
  assert.doesNotMatch(one, /demo-threshold-alert/);
  assert.doesNotMatch(registerDoc, /demo-threshold-alert/);
  assert.doesNotMatch(heartbeatDoc, /demo-threshold-alert/);
  assert.doesNotMatch(alertDoc, /demo-threshold-alert/);
  assert.doesNotMatch(ackDoc, /demo-threshold-alert/);
  assert.doesNotMatch(alertScript, /demo-threshold-alert/);
  assert.doesNotMatch(ackScript, /CAM-THRESH-01/);
  assert.match(alertScript, /export const ALERT_THRESHOLD = 28/);
  assert.match(alertScript, /export const ALERT_CAMERA = 'CAM-ALERT-01'/);
  assert.match(makefile, /^demo-one-alert:.*\n\tnode scripts\/demo-one-alert\.mjs\s*$/m);
  assert.match(makefile, /^demo-ack-one-alert:.*\n\tnode scripts\/demo-ack-close-alert\.mjs ack\s*$/m);
  assert.match(
    makefile,
    /^demo-close-one-alert:.*\n\tnode scripts\/demo-ack-close-alert\.mjs close\s*$/m,
  );
  assert.match(
    makefile,
    /^demo-threshold-alert:.*\n\tnode scripts\/demo-threshold-alert\.mjs\s*$/m,
  );
  assert.match(makefile, /scripts\/demo-threshold-alert\.spec\.mjs/);
  const added = readme.split('\n').filter((line) => line.includes('DEMO_THRESHOLD_ALERT.md'));
  assert.equal(added.length, 1);
});
