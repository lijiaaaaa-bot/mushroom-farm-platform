import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { DEMO_CAMERA, DEMO_FIXTURE, buildDemoPayload } from './demo-one-http-recognition.mjs';
import { readFixture, repoRoot } from './lib/ingest-wire.mjs';
import {
  ALERT_CAMERA,
  ALERT_SHED,
  ALERT_TEMPERATURE,
  ALERT_THRESHOLD,
  ALERT_TITLE,
  assertAlertDetail,
  buildAlertRecognition,
  formatAlertProof,
  isTemperatureAlert,
  sendAlertDemo,
} from './demo-one-alert.mjs';

const now = new Date('2026-10-14T01:02:03.004Z');
const recognitionId = '55555555-5555-4555-8555-555555555555';
const alertId = '66666666-6666-4666-8666-666666666666';

function detailBody(id = alertId) {
  return {
    id,
    shedCode: ALERT_SHED,
    cameraCode: ALERT_CAMERA,
    level: 'severe',
    status: 'open',
    title: ALERT_TITLE,
    message: `棚区 ${ALERT_SHED} 摄像头 ${ALERT_CAMERA} 温度过高 ${ALERT_TEMPERATURE}，阈值 ${ALERT_THRESHOLD}`,
    metric: 'temperature_high',
    metricValue: ALERT_TEMPERATURE,
    threshold: ALERT_THRESHOLD,
    createdAt: now.toISOString(),
  };
}

test('alert recognition keeps the sample counts and leaves CAM-DEMO-01 on disk', () => {
  const fixture = readFixture(DEMO_FIXTURE);
  assert.equal(fixture.body.cameraCode, DEMO_CAMERA);
  assert.equal(fixture.body.temperature, 22.5);
  const body = buildAlertRecognition(now);
  assert.equal(body.cameraCode, ALERT_CAMERA);
  assert.equal(body.shedCode, ALERT_SHED);
  assert.equal(body.temperature, ALERT_TEMPERATURE);
  assert.equal(body.recognizedAt, now.toISOString());
  assert.match(body.idempotencyKey, /^demo-alert-\d+$/);
  assert.equal(body.mushroomCount, 12);
  assert.equal(body.matureCount, 5);
  assert.equal(body.diseaseCount, 1);
  assert.equal(body.snapshotBase64, fixture.body.snapshotBase64);
  assert.equal(readFixture(DEMO_FIXTURE).body.cameraCode, 'CAM-DEMO-01');
  assert.equal(buildDemoPayload(now).cameraCode, 'CAM-DEMO-01');
  assert.equal(buildDemoPayload(now).temperature, 22.5);
  assert.equal(isTemperatureAlert(detailBody()), true);
  assert.equal(isTemperatureAlert({ ...detailBody(), status: 'closed' }), false);
});

test('proof names the alert list and the detail page', () => {
  const proof = formatAlertProof({
    recognitionId,
    created: true,
    detail: detailBody(),
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /发了 1 条识别/);
  assert.match(proof, new RegExp(`识别 id: ${recognitionId}`));
  assert.match(proof, /摄像头编号: CAM-ALERT-01/);
  assert.match(proof, /环境温度: 30/);
  assert.match(proof, /告警: 新建/);
  assert.match(proof, /标题: 温度过高告警/);
  assert.match(proof, /说明: 棚区 S01 摄像头 CAM-ALERT-01 温度过高 30，阈值 28/);
  assert.match(proof, /级别: 严重/);
  assert.match(proof, /状态: 待确认/);
  assert.match(proof, /告警列表: http:\/\/127\.0\.0\.1:43123\/alerts$/m);
  assert.match(proof, new RegExp(`告警详情: http://127\\.0\\.0\\.1:43123/alerts/${alertId}`));
  assert.doesNotMatch(proof, /CAM-DEMO-01/);
  assertAlertDetail(detailBody(), { created: true });
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

test('one hot recognition creates a temperature alert and the detail matches the list', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push(`${init?.method || 'GET'} ${target}`);
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.includes('/alerts?') && target.includes('status=open')) {
      const seen = calls.filter((line) => line.includes('status=open')).length;
      if (seen === 1) return jsonResponse(200, { items: [], total: 0 });
      return jsonResponse(200, { items: [detailBody()], total: 1 });
    }
    if (target.includes('/alerts?') && target.includes('status=acked')) {
      return jsonResponse(200, { items: [], total: 0 });
    }
    if (target.endsWith('/ingest/recognition')) {
      const body = JSON.parse(init.body);
      assert.equal(body.cameraCode, ALERT_CAMERA);
      assert.equal(body.temperature, ALERT_TEMPERATURE);
      assert.equal(body.mushroomCount, 12);
      assert.equal(init.headers['x-ingest-token'], 'dev-ingest-token');
      return jsonResponse(200, { accepted: true, duplicate: false, id: recognitionId });
    }
    if (target.endsWith(`/alerts/${alertId}`)) {
      assert.equal(init.headers.authorization, 'Bearer tok');
      return jsonResponse(200, detailBody());
    }
    throw new Error(`unexpected ${target}`);
  };
  try {
    const result = await sendAlertDemo({ now });
    assert.equal(result.created, true);
    assert.equal(result.recognitionId, recognitionId);
    assert.equal(result.detail.id, alertId);
    assert.equal(result.body.cameraCode, ALERT_CAMERA);
    assert.equal(
      calls.filter((line) => line.startsWith('POST') && line.endsWith('/ingest/recognition')).length,
      1,
    );
    const proof = formatAlertProof(result);
    assert.match(proof, /告警: 新建/);
    assert.match(proof, /\/alerts\/66666666-6666-4666-8666-666666666666/);
  } finally {
    globalThis.fetch = original;
  }
});

test('an open temperature alert is reused and still printed', async () => {
  const original = globalThis.fetch;
  let recognitionPosts = 0;
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.includes('/alerts?')) return jsonResponse(200, { items: [detailBody()], total: 1 });
    if (target.endsWith('/ingest/recognition')) {
      recognitionPosts += 1;
      return jsonResponse(200, { accepted: true, duplicate: false, id: recognitionId });
    }
    if (target.endsWith(`/alerts/${alertId}`)) return jsonResponse(200, detailBody());
    throw new Error(`unexpected ${target}`);
  };
  try {
    const result = await sendAlertDemo({ now });
    assert.equal(result.created, false);
    assert.equal(recognitionPosts, 1);
    assert.match(formatAlertProof(result), /告警: 沿用未闭合/);
    assert.equal(result.detail.title, ALERT_TITLE);
  } finally {
    globalThis.fetch = original;
  }
});

test('the written steps name the make target, the list, and the detail', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_ONE_ALERT.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const one = readFileSync(join(root, 'docs/DEMO_ONE_INGEST.md'), 'utf8');
  const registerDoc = readFileSync(join(root, 'docs/DEMO_REGISTER_AND_INGEST.md'), 'utf8');
  const heartbeatDoc = readFileSync(join(root, 'docs/DEMO_REGISTER_AND_HEARTBEAT.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  assert.match(doc, /make demo-one-alert/);
  assert.match(doc, /admin/);
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /CAM-ALERT-01/);
  assert.match(doc, /温度过高/);
  assert.match(doc, /\/alerts/);
  assert.match(doc, /30/);
  assert.match(doc, /28/);
  assert.match(caps, /make demo-one-alert/);
  assert.match(caps, /DEMO_ONE_ALERT\.md/);
  assert.match(caps, /GET \/api\/v1\/alerts\/:id/);
  assert.match(status, /make demo-one-alert/);
  assert.match(readme, /DEMO_ONE_ALERT\.md/);
  assert.doesNotMatch(one, /CAM-ALERT-01/);
  assert.doesNotMatch(one, /demo-one-alert/);
  assert.doesNotMatch(registerDoc, /demo-one-alert/);
  assert.doesNotMatch(heartbeatDoc, /demo-one-alert/);
  assert.match(makefile, /^demo-one-alert:.*\n\tnode scripts\/demo-one-alert\.mjs\s*$/m);
  assert.match(makefile, /^demo-one-ingest:.*\n\tnode scripts\/demo-one-http-recognition\.mjs\s*$/m);
  assert.match(
    makefile,
    /^demo-register-and-ingest:.*\n\tnode scripts\/demo-register-and-ingest\.mjs\s*$/m,
  );
  assert.match(
    makefile,
    /^demo-register-and-heartbeat:.*\n\tnode scripts\/demo-register-and-heartbeat\.mjs\s*$/m,
  );
  assert.match(makefile, /scripts\/demo-one-alert\.spec\.mjs/);
  const added = readme.split('\n').filter((line) => line.includes('DEMO_ONE_ALERT.md'));
  assert.equal(added.length, 1);
});
