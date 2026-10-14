import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { repoRoot } from './lib/ingest-wire.mjs';
import {
  FILTER_CAMERA,
  FILTER_CAMERAS,
  FILTER_LEVEL,
  FILTER_SHED,
  OTHER_CAMERA,
  alertMessage,
  assertBothPresent,
  assertDetail,
  assertOnlyCamera,
  formatFilterProof,
  pickReusable,
  sendCameraFilterDemo,
} from './demo-alert-camera-filter.mjs';

const eastId = '11111111-1111-4111-8111-111111111111';
const westId = '22222222-2222-4222-8222-222222222222';
const keptId = '33333333-3333-4333-8333-333333333333';

function row(id, cameraCode, title, status = 'open') {
  const spec = FILTER_CAMERAS.find((item) => item.cameraCode === cameraCode);
  return {
    id,
    shedCode: FILTER_SHED,
    cameraCode,
    level: FILTER_LEVEL,
    status,
    title: title || spec.title,
    message: alertMessage(cameraCode),
    createdAt: '2026-10-14T01:02:03.004Z',
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

function installFetch(state) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const target = new URL(String(url));
    const method = init?.method || 'GET';
    calls.push(`${method} ${target.pathname}${target.search}`);
    if (target.pathname.endsWith('/auth/login')) {
      assert.deepEqual(JSON.parse(init.body), { username: 'admin', password: 'Admin@123456' });
      return jsonResponse(200, { accessToken: 'tok' });
    }
    if (method === 'POST' && target.pathname.endsWith('/alerts')) {
      const body = JSON.parse(init.body);
      assert.equal(body.shedCode, FILTER_SHED);
      assert.equal(body.level, FILTER_LEVEL);
      assert.equal(init.headers.authorization, 'Bearer tok');
      const created = row(
        body.cameraCode === FILTER_CAMERA ? westId : eastId,
        body.cameraCode,
        body.title,
      );
      created.message = body.message;
      state.alerts.push(created);
      state.created.push(body);
      return jsonResponse(201, created);
    }
    if (method === 'GET' && /\/alerts\/[^/]+$/.test(target.pathname)) {
      const id = decodeURIComponent(target.pathname.split('/').pop());
      const found = state.alerts.find((item) => item.id === id);
      if (!found) return jsonResponse(404, { message: '告警不存在' });
      return jsonResponse(200, found);
    }
    if (method === 'GET' && target.pathname.endsWith('/alerts')) {
      const camera = (target.searchParams.get('cameraCode') || '').trim();
      const shed = target.searchParams.get('shedCode');
      let items = state.alerts;
      if (shed) items = items.filter((item) => item.shedCode === shed);
      if (camera) items = items.filter((item) => item.cameraCode === camera);
      return jsonResponse(200, { items, total: items.length, page: 1, pageSize: 100 });
    }
    return jsonResponse(404, { message: `未模拟 ${method} ${target.pathname}` });
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

test('two cameras stay distinct when one camera code is selected', () => {
  const east = row(eastId, OTHER_CAMERA);
  const west = row(westId, FILTER_CAMERA);
  assert.equal(pickReusable([east, { ...west, status: 'closed' }], FILTER_CAMERA), null);
  assert.equal(pickReusable([east, west], FILTER_CAMERA)?.id, westId);
  assert.equal(pickReusable([east], OTHER_CAMERA)?.id, eastId);
  assert.doesNotThrow(() => assertOnlyCamera([west], FILTER_CAMERA, westId));
  assert.throws(() => assertOnlyCamera([west, east], FILTER_CAMERA, westId), /其他摄像头/);
  assert.throws(() => assertOnlyCamera([east], FILTER_CAMERA, westId), /没有告警/);
  assert.doesNotThrow(() => assertBothPresent([east, west, row(keptId, 'CAM-ALERT-01', '温度过高告警')], [eastId, westId]));
  assert.throws(() => assertBothPresent([west], [eastId, westId]), /缺少/);
  assertDetail(west, { id: westId, cameraCode: FILTER_CAMERA, title: '西侧过道告警' });
});

test('proof names both cameras and the filtered list', () => {
  const proof = formatFilterProof({
    seeded: [
      { cameraCode: OTHER_CAMERA, title: '东侧过道告警', id: eastId, created: true },
      { cameraCode: FILTER_CAMERA, title: '西侧过道告警', id: westId, created: false },
    ],
    filteredCount: 1,
    detail: row(westId, FILTER_CAMERA),
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /留下 2 条告警/);
  assert.match(proof, new RegExp(`CAM-FILTER-01: 新建 ${eastId}`));
  assert.match(proof, new RegExp(`CAM-FILTER-02: 沿用 ${westId}`));
  assert.match(proof, /筛选摄像头: CAM-FILTER-02/);
  assert.match(proof, /筛选后条数: 1/);
  assert.match(proof, /筛选后其他摄像头: 无/);
  assert.match(proof, /详情可打开: 是/);
  assert.match(proof, /详情摄像头: CAM-FILTER-02/);
  assert.match(proof, /未筛选仍含这两台: 是/);
  assert.match(proof, /告警列表: http:\/\/127\.0\.0\.1:43123\/alerts$/m);
  assert.match(
    proof,
    /按摄像头筛选: http:\/\/127\.0\.0\.1:43123\/alerts\?cameraCode=CAM-FILTER-02/,
  );
  assert.match(
    proof,
    new RegExp(`告警详情: http://127\\.0\\.0\\.1:43123/alerts/${westId}\\?cameraCode=CAM-FILTER-02`),
  );
});

test('the command leaves two cameras and the filter hides the other one', async () => {
  const state = {
    alerts: [
      row(keptId, 'CAM-ALERT-01', '温度过高告警', 'open'),
    ],
    created: [],
  };
  state.alerts[0].level = 'severe';
  state.alerts[0].title = '温度过高告警';
  const installed = installFetch(state);
  try {
    const result = await sendCameraFilterDemo();
    assert.deepEqual(
      result.seeded.map((item) => item.cameraCode),
      [OTHER_CAMERA, FILTER_CAMERA],
    );
    assert.equal(result.seeded.every((item) => item.created), true);
    assert.equal(result.detail.id, westId);
    assert.equal(result.detail.cameraCode, FILTER_CAMERA);
    assert.equal(result.filteredCount, 1);
    assert.equal(state.created.length, 2);
    assert.deepEqual(
      state.created.map((body) => body.cameraCode),
      [OTHER_CAMERA, FILTER_CAMERA],
    );
    assert.equal(state.alerts.find((item) => item.id === keptId).status, 'open');
    assert.equal(
      installed.calls.filter((line) => line.includes('/close') || line.includes('/ack')).length,
      0,
    );
    assert.match(formatFilterProof(result), /筛选后其他摄像头: 无/);
  } finally {
    installed.restore();
  }
});

test('an existing open alert for the same camera and title is reused', async () => {
  const state = {
    alerts: [
      row(eastId, OTHER_CAMERA),
      { ...row(westId, FILTER_CAMERA), status: 'acked' },
      row(keptId, 'CAM-THRESH-01', 'CO₂过高告警'),
    ],
    created: [],
  };
  const installed = installFetch(state);
  try {
    const result = await sendCameraFilterDemo();
    assert.equal(result.seeded.every((item) => item.created), false);
    assert.deepEqual(
      result.seeded.map((item) => item.id),
      [eastId, westId],
    );
    assert.equal(state.created.length, 0);
    assert.equal(result.filteredCount, 1);
    assert.equal(state.alerts.find((item) => item.id === keptId).cameraCode, 'CAM-THRESH-01');
    assert.equal(installed.calls.filter((line) => line.startsWith('POST ') && line.includes('/alerts')).length, 0);
  } finally {
    installed.restore();
  }
});

test('the written steps name the make target and leave the earlier demos alone', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_ALERT_CAMERA_FILTER.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  const one = readFileSync(join(root, 'docs/DEMO_ONE_INGEST.md'), 'utf8');
  const registerDoc = readFileSync(join(root, 'docs/DEMO_REGISTER_AND_INGEST.md'), 'utf8');
  const heartbeatDoc = readFileSync(join(root, 'docs/DEMO_REGISTER_AND_HEARTBEAT.md'), 'utf8');
  const alertDoc = readFileSync(join(root, 'docs/DEMO_ONE_ALERT.md'), 'utf8');
  const ackDoc = readFileSync(join(root, 'docs/DEMO_ACK_CLOSE_ALERT.md'), 'utf8');
  const thresholdDoc = readFileSync(join(root, 'docs/DEMO_THRESHOLD_ALERT.md'), 'utf8');
  const alertScript = readFileSync(join(root, 'scripts/demo-one-alert.mjs'), 'utf8');
  const ackScript = readFileSync(join(root, 'scripts/demo-ack-close-alert.mjs'), 'utf8');
  const thresholdScript = readFileSync(join(root, 'scripts/demo-threshold-alert.mjs'), 'utf8');
  assert.match(doc, /make demo-alert-camera-filter/);
  assert.match(doc, /admin/);
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /CAM-FILTER-01/);
  assert.match(doc, /CAM-FILTER-02/);
  assert.match(doc, /筛选/);
  assert.match(doc, /清除/);
  assert.match(doc, /\/alerts/);
  assert.match(caps, /make demo-alert-camera-filter/);
  assert.match(caps, /DEMO_ALERT_CAMERA_FILTER\.md/);
  assert.match(caps, /cameraCode/);
  assert.match(status, /make demo-alert-camera-filter/);
  assert.match(readme, /DEMO_ALERT_CAMERA_FILTER\.md/);
  assert.doesNotMatch(one, /demo-alert-camera-filter|CAM-FILTER-0/);
  assert.doesNotMatch(registerDoc, /demo-alert-camera-filter|CAM-FILTER-0/);
  assert.doesNotMatch(heartbeatDoc, /demo-alert-camera-filter|CAM-FILTER-0/);
  assert.doesNotMatch(alertDoc, /demo-alert-camera-filter|CAM-FILTER-0/);
  assert.doesNotMatch(ackDoc, /demo-alert-camera-filter|CAM-FILTER-0/);
  assert.doesNotMatch(thresholdDoc, /demo-alert-camera-filter|CAM-FILTER-0/);
  assert.doesNotMatch(alertScript, /CAM-FILTER-0/);
  assert.doesNotMatch(ackScript, /CAM-FILTER-0/);
  assert.doesNotMatch(thresholdScript, /CAM-FILTER-0/);
  assert.match(alertScript, /export const ALERT_CAMERA = 'CAM-ALERT-01'/);
  assert.match(makefile, /^demo-one-alert:.*\n\tnode scripts\/demo-one-alert\.mjs\s*$/m);
  assert.match(
    makefile,
    /^demo-alert-camera-filter:.*\n\tnode scripts\/demo-alert-camera-filter\.mjs\s*$/m,
  );
  assert.match(makefile, /scripts\/demo-alert-camera-filter\.spec\.mjs/);
  const added = readme.split('\n').filter((line) => line.includes('DEMO_ALERT_CAMERA_FILTER.md'));
  assert.equal(added.length, 1);
});
