import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  STOP_CAMERA,
  STOP_NAME,
  STOP_NOTE,
  STOP_SHED,
  assertStopSource,
  assertStoppedCamera,
  assertStoppedDetail,
  enabledLabel,
  formatStopProof,
  showStoppedCamera,
  stopCameraCreateBody,
  stopCameraPatchBody,
  stopListedCamera,
} from './demo-camera-stop.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

function deviceRow(overrides = {}) {
  return {
    id: 'dev-stop-01',
    code: STOP_CAMERA,
    name: STOP_NAME,
    type: 'camera',
    shedCode: STOP_SHED,
    note: STOP_NOTE,
    onlineStatus: 'offline',
    enabled: true,
    lastHeartbeatAt: null,
    lastSeenAt: null,
    ...overrides,
  };
}

function stoppedRow(overrides = {}) {
  return deviceRow({ enabled: false, ...overrides });
}

test('create and patch bodies pin CAM-STOP-01 and only clear enabled', () => {
  assert.deepEqual(stopCameraCreateBody(), {
    code: 'CAM-STOP-01',
    name: '可停用镜头',
    type: 'camera',
    shedCode: 'S01',
    note: '停用前',
  });
  assert.deepEqual(stopCameraPatchBody(), { enabled: false });
  assert.equal(Object.hasOwn(stopCameraPatchBody(), 'note'), false);
  assert.equal(Object.hasOwn(stopCameraPatchBody(), 'onlineStatus'), false);
  assert.equal(Object.hasOwn(stopCameraCreateBody(), 'idempotencyKey'), false);
  assert.equal(enabledLabel(false), '停用');
  assert.equal(enabledLabel(true), '启用');
});

test('a new row must stay enabled and offline until the patch', () => {
  assert.equal(assertStopSource(deviceRow(), { created: true }).code, STOP_CAMERA);
  assert.throws(
    () => assertStopSource(deviceRow({ name: 'CAM-STOP-01', note: null }), { created: true }),
    /名称或备注/,
  );
  assert.throws(
    () => assertStopSource(deviceRow({ onlineStatus: 'online' }), { created: true }),
    /离线/,
  );
  assert.throws(
    () => assertStopSource(deviceRow({ enabled: false }), { created: true }),
    /启用/,
  );
  assert.throws(() => assertStopSource(null, { created: true }), /没有 CAM-STOP-01/);
  assert.throws(() => assertStopSource(deviceRow({ id: '' }), { created: true }), /没有 id/);
});

test('an existing row keeps its name and may already be stopped', () => {
  const existing = deviceRow({
    name: 'CAM-STOP-01',
    note: '旧备注',
    onlineStatus: 'online',
    enabled: false,
    lastHeartbeatAt: '2026-10-14T01:02:03.004Z',
  });
  assert.equal(assertStopSource(existing, { created: false }).note, '旧备注');
  assert.throws(
    () => assertStopSource(deviceRow({ type: 'sensor' }), { created: false }),
    /类型/,
  );
  assert.throws(
    () => assertStopSource(deviceRow({ shedCode: 'S02' }), { created: false }),
    /棚区/,
  );
});

test('the list and the detail stay reachable and show 停用', () => {
  const before = deviceRow();
  const listed = stoppedRow();
  assert.equal(assertStoppedCamera(listed, before).enabled, false);
  assert.equal(assertStoppedDetail(listed, listed).note, STOP_NOTE);
  assert.throws(() => assertStoppedCamera(stoppedRow({ note: '另一句' }), before), /备注/);
  assert.throws(
    () => assertStoppedCamera(stoppedRow({ onlineStatus: 'online' }), before),
    /在线状态/,
  );
  assert.throws(() => assertStoppedCamera(stoppedRow({ enabled: true }), before), /停用/);
  assert.throws(
    () => assertStoppedCamera(stoppedRow({ name: '另一台' }), before),
    /名称或棚区/,
  );
  assert.throws(
    () => assertStoppedCamera(stoppedRow({ lastHeartbeatAt: '2026-10-14T01:02:03.004Z' }), before),
    /心跳/,
  );
  assert.throws(() => assertStoppedCamera(null, before), /没有 CAM-STOP-01/);
  assert.throws(
    () => assertStoppedDetail(stoppedRow({ note: '另一句' }), listed),
    /备注/,
  );
  assert.throws(
    () => assertStoppedDetail(stoppedRow({ enabled: true }), listed),
    /停用/,
  );
  assert.throws(() => assertStoppedDetail(stoppedRow({ id: 'other' }), listed), /id/);
});

test('proof names the devices page and the detail page', () => {
  const proof = formatStopProof({
    created: true,
    before: deviceRow(),
    device: stoppedRow(),
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /登记: 新建/);
  assert.match(proof, /停用前: 启用/);
  assert.match(proof, /停用后: 停用/);
  assert.match(proof, /在线状态: 离线/);
  assert.match(proof, /备注: 停用前/);
  assert.match(proof, /镜头码: CAM-STOP-01/);
  assert.match(proof, /编号: CAM-STOP-01/);
  assert.match(proof, /名称: 可停用镜头/);
  assert.match(proof, /类型: 摄像头/);
  assert.match(proof, /棚区: S01/);
  assert.match(proof, /最近心跳: —/);
  assert.match(proof, /设备页: http:\/\/127\.0\.0\.1:43123\/devices$/m);
  assert.match(proof, /镜头详情: http:\/\/127\.0\.0\.1:43123\/devices\/dev-stop-01/);
  assert.doesNotMatch(proof, /CAM-NEW-01|CAM-EDIT-01|CAM-ALERT-01|CAM-REG-02/);
  assert.doesNotMatch(proof, /ingest/);
});

test('an existing archive keeps its heartbeat in the proof', () => {
  const before = deviceRow({
    name: '东侧可停用',
    note: '旧备注',
    onlineStatus: 'online',
    enabled: true,
    lastHeartbeatAt: '2026-10-14T01:02:03.004Z',
  });
  const proof = formatStopProof({
    created: false,
    before,
    device: stoppedRow({
      name: '东侧可停用',
      note: '旧备注',
      onlineStatus: 'online',
      lastHeartbeatAt: '2026-10-14T01:02:03.004Z',
    }),
    webOrigin: 'http://127.0.0.1:43123/',
  });
  assert.match(proof, /登记: 已有，未改名称和心跳/);
  assert.match(proof, /停用前: 启用/);
  assert.match(proof, /停用后: 停用/);
  assert.match(proof, /名称: 东侧可停用/);
  assert.match(proof, /在线状态: 在线/);
  assert.match(proof, /备注: 旧备注/);
  assert.match(proof, /最近心跳: 2026-10-14T01:02:03.004Z/);
});

test('http chain creates the camera, stops it, then reads the list and the detail', async () => {
  const original = globalThis.fetch;
  const calls = [];
  let lists = 0;
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push(`${init?.method || 'GET'} ${target}`);
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.endsWith('/devices') && init?.method === 'POST') {
      assert.deepEqual(JSON.parse(init.body), stopCameraCreateBody());
      assert.equal(init.headers.authorization, 'Bearer tok');
      return jsonResponse(201, deviceRow());
    }
    if (target.endsWith('/devices/dev-stop-01') && init?.method === 'PATCH') {
      assert.deepEqual(JSON.parse(init.body), stopCameraPatchBody());
      assert.equal(init.headers.authorization, 'Bearer tok');
      return jsonResponse(200, stoppedRow());
    }
    if (target.endsWith('/devices?pageSize=100')) {
      lists += 1;
      return jsonResponse(200, {
        items: [lists === 1 ? deviceRow() : stoppedRow()],
        total: 1,
      });
    }
    if (target.endsWith('/devices/dev-stop-01') && (!init?.method || init.method === 'GET')) {
      return jsonResponse(200, stoppedRow());
    }
    return jsonResponse(500, { message: `未预期的请求 ${target}` });
  };
  try {
    const result = await showStoppedCamera();
    assert.equal(result.created, true);
    assert.equal(result.before.enabled, true);
    assert.equal(result.before.onlineStatus, 'offline');
    assert.equal(result.device.enabled, false);
    assert.equal(result.device.note, STOP_NOTE);
    assert.equal(result.device.onlineStatus, 'offline');
    assert.equal(result.device.id, 'dev-stop-01');
    assert.deepEqual(
      calls.map((line) => `${line.split(' ')[0]} ${line.split('?')[0].split('/').slice(-1)[0]}`),
      ['POST login', 'POST devices', 'GET devices', 'PATCH dev-stop-01', 'GET devices', 'GET dev-stop-01'],
    );
    assert.equal(calls.some((line) => line.includes('/ingest')), false);
    assert.equal(calls.some((line) => line.includes('/alerts')), false);
    assert.equal(calls.some((line) => line.includes('/heartbeat')), false);
  } finally {
    globalThis.fetch = original;
  }
});

test('http chain stops an existing CAM-STOP-01 without rewriting its heartbeat', async () => {
  const original = globalThis.fetch;
  const calls = [];
  let lists = 0;
  const before = deviceRow({
    name: '东侧可停用',
    note: '旧备注',
    onlineStatus: 'online',
    enabled: true,
    lastHeartbeatAt: '2026-10-14T01:02:03.004Z',
  });
  const after = stoppedRow({
    name: '东侧可停用',
    note: '旧备注',
    onlineStatus: 'online',
    lastHeartbeatAt: '2026-10-14T01:02:03.004Z',
  });
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push(`${init?.method || 'GET'} ${target}`);
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.endsWith('/devices') && init?.method === 'POST') {
      return jsonResponse(409, { message: '设备编码已存在' });
    }
    if (target.endsWith('/devices/dev-stop-01') && init?.method === 'PATCH') {
      assert.deepEqual(JSON.parse(init.body), stopCameraPatchBody());
      return jsonResponse(200, after);
    }
    if (target.endsWith('/devices?pageSize=100')) {
      lists += 1;
      return jsonResponse(200, { items: [lists === 1 ? before : after], total: 1 });
    }
    if (target.endsWith('/devices/dev-stop-01')) return jsonResponse(200, after);
    return jsonResponse(500, { message: `未预期的请求 ${target}` });
  };
  try {
    const result = await stopListedCamera('tok');
    assert.equal(result.created, false);
    assert.equal(result.before.name, '东侧可停用');
    assert.equal(result.before.lastHeartbeatAt, '2026-10-14T01:02:03.004Z');
    assert.equal(result.device.enabled, false);
    assert.equal(result.device.note, '旧备注');
    assert.equal(result.device.onlineStatus, 'online');
    assert.equal(result.device.lastHeartbeatAt, '2026-10-14T01:02:03.004Z');
    assert.equal(result.device.name, '东侧可停用');
    assert.equal(calls.some((line) => line.includes('/ingest')), false);
    assert.equal(calls.filter((line) => line.startsWith('POST')).length, 1);
    assert.equal(calls.filter((line) => line.startsWith('PATCH')).length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('the written steps name the make target and leave the other demos alone', () => {
  const doc = readFileSync(join(root, 'docs/DEMO_CAMERA_STOP.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  assert.match(doc, /make demo-camera-stop/);
  assert.match(doc, /admin/);
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /CAM-STOP-01/);
  assert.match(doc, /停用/);
  assert.match(doc, /\/devices/);
  assert.match(caps, /make demo-camera-stop/);
  assert.match(caps, /DEMO_CAMERA_STOP\.md/);
  assert.match(status, /make demo-camera-stop/);
  assert.equal(
    readme.split('\n').filter((line) => line.includes('DEMO_CAMERA_STOP.md')).length,
    1,
  );
  assert.match(
    makefile,
    /^demo-camera-stop:.*\n\tnode scripts\/demo-camera-stop\.mjs\s*$/m,
  );
  assert.match(makefile, /scripts\/demo-camera-stop\.spec\.mjs/);
  assert.match(makefile, /^demo-camera-create:.*\n\tnode scripts\/demo-camera-create\.mjs\s*$/m);
  assert.match(makefile, /^demo-camera-edit:.*\n\tnode scripts\/demo-camera-edit\.mjs\s*$/m);
  assert.match(makefile, /^demo-camera-list:.*\n\tnode scripts\/demo-camera-list\.mjs\s*$/m);
  assert.match(makefile, /^demo-camera-detail:.*\n\tnode scripts\/demo-camera-detail\.mjs\s*$/m);
  const untouched = [
    'scripts/demo-camera-list.mjs',
    'scripts/demo-camera-detail.mjs',
    'scripts/demo-camera-create.mjs',
    'scripts/demo-camera-edit.mjs',
    'scripts/demo-register-and-ingest.mjs',
    'scripts/demo-register-and-heartbeat.mjs',
    'scripts/demo-one-alert.mjs',
    'scripts/demo-telemetry-latest.mjs',
    'scripts/demo-telemetry-threshold-alert.mjs',
    'scripts/demo-alert-rule-config.mjs',
    'docs/DEMO_CAMERA_LIST.md',
    'docs/DEMO_CAMERA_DETAIL.md',
    'docs/DEMO_CAMERA_CREATE.md',
    'docs/DEMO_CAMERA_EDIT.md',
  ];
  for (const relative of untouched) {
    const text = readFileSync(join(root, relative), 'utf8');
    assert.doesNotMatch(text, /CAM-STOP-01|demo-camera-stop/);
  }
});
