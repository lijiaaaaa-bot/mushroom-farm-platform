import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LIST_CAMERA,
  LIST_NAME,
  LIST_NOTE,
  LIST_SHED,
  assertListedCamera,
  cameraBody,
  ensureListedCamera,
  formatListProof,
  heartbeatLabel,
  lensCodeOf,
  showCameraList,
  statusLabel,
} from './demo-camera-list.mjs';

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
    id: 'dev-alert-01',
    code: LIST_CAMERA,
    name: LIST_NAME,
    type: 'camera',
    shedCode: LIST_SHED,
    note: LIST_NOTE,
    onlineStatus: 'offline',
    lastHeartbeatAt: null,
    lastSeenAt: null,
    ...overrides,
  };
}

test('camera body pins CAM-ALERT-01 on S01 and does not send ingest fields', () => {
  assert.deepEqual(cameraBody(), {
    code: 'CAM-ALERT-01',
    name: '温度告警镜头',
    type: 'camera',
    shedCode: 'S01',
    note: '镜头码对照告警',
  });
  assert.equal(lensCodeOf(deviceRow()), 'CAM-ALERT-01');
  assert.equal(lensCodeOf({ type: 'sensor', code: 'SENSOR-TELEM-01' }), '—');
  assert.equal(statusLabel('online'), '在线');
  assert.equal(statusLabel('offline'), '离线');
  assert.equal(heartbeatLabel(deviceRow()), '—');
  assert.equal(
    heartbeatLabel(deviceRow({ lastSeenAt: '2026-10-14T01:02:03.004Z' })),
    '2026-10-14T01:02:03.004Z',
  );
});

test('a new row must stay offline with the requested name and note', () => {
  assert.equal(assertListedCamera(deviceRow(), { created: true }).code, LIST_CAMERA);
  assert.throws(
    () => assertListedCamera(deviceRow({ name: 'CAM-ALERT-01', note: null }), { created: true }),
    /名称或备注/,
  );
  assert.throws(
    () => assertListedCamera(deviceRow({ onlineStatus: 'online' }), { created: true }),
    /离线/,
  );
  assert.throws(
    () => assertListedCamera(null, { created: true }),
    /没有 CAM-ALERT-01/,
  );
});

test('an existing row keeps its name and may already be online', () => {
  const existing = deviceRow({
    name: 'CAM-ALERT-01',
    note: null,
    onlineStatus: 'online',
    lastSeenAt: '2026-10-14T01:02:03.004Z',
  });
  assert.equal(assertListedCamera(existing, { created: false }).name, 'CAM-ALERT-01');
  assert.throws(
    () => assertListedCamera(deviceRow({ type: 'sensor' }), { created: false }),
    /类型/,
  );
  assert.throws(
    () => assertListedCamera(deviceRow({ shedCode: 'S02' }), { created: false }),
    /棚区 S02/,
  );
});

test('proof names the devices page and the alert and recognition filters', () => {
  const proof = formatListProof({
    created: true,
    device: deviceRow(),
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /登记: 新建/);
  assert.match(proof, /镜头码: CAM-ALERT-01/);
  assert.match(proof, /编号: CAM-ALERT-01/);
  assert.match(proof, /名称: 温度告警镜头/);
  assert.match(proof, /类型: 摄像头/);
  assert.match(proof, /棚区: S01/);
  assert.match(proof, /状态: 离线/);
  assert.match(proof, /备注: 镜头码对照告警/);
  assert.match(proof, /最近心跳: —/);
  assert.match(proof, /设备页: http:\/\/127\.0\.0\.1:43123\/devices$/m);
  assert.match(proof, /告警筛选: http:\/\/127\.0\.0\.1:43123\/alerts\?cameraCode=CAM-ALERT-01/);
  assert.match(proof, /识别记录: http:\/\/127\.0\.0\.1:43123\/recognitions\?cameraCode=CAM-ALERT-01/);
  assert.doesNotMatch(proof, /CAM-REG-02/);
  assert.doesNotMatch(proof, /SENSOR-TELEM-01/);
});

test('an existing archive is printed without rewriting the name', () => {
  const proof = formatListProof({
    created: false,
    device: deviceRow({
      name: 'CAM-ALERT-01',
      note: null,
      onlineStatus: 'online',
      lastSeenAt: '2026-10-14T01:02:03.004Z',
    }),
    webOrigin: 'http://127.0.0.1:43123/',
  });
  assert.match(proof, /登记: 已有，未改档案/);
  assert.match(proof, /名称: CAM-ALERT-01/);
  assert.match(proof, /状态: 在线/);
  assert.match(proof, /备注: —/);
  assert.match(proof, /最近心跳: 2026-10-14T01:02:03.004Z/);
  assert.match(proof, /设备页: http:\/\/127\.0\.0\.1:43123\/devices/);
});

test('http chain registers CAM-ALERT-01 and reads the same list the page uses', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push(`${init?.method || 'GET'} ${target}`);
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.endsWith('/devices') && init?.method === 'POST') {
      assert.deepEqual(JSON.parse(init.body), cameraBody());
      assert.equal(init.headers.authorization, 'Bearer tok');
      return jsonResponse(201, deviceRow());
    }
    if (target.endsWith('/devices?pageSize=100')) {
      return jsonResponse(200, { items: [deviceRow(), { code: 'BOX-S02', type: 'ai_box' }], total: 2 });
    }
    return jsonResponse(500, { message: `未预期的请求 ${target}` });
  };
  try {
    const result = await showCameraList();
    assert.equal(result.created, true);
    assert.equal(result.device.code, LIST_CAMERA);
    assert.deepEqual(
      calls.map((line) => line.split(' ')[0] + ' ' + line.split('?')[0].split('/').slice(-1)[0]),
      ['POST login', 'POST devices', 'GET devices'],
    );
    assert.equal(calls.some((line) => line.includes('/ingest')), false);
    assert.equal(calls.some((line) => line.includes('/alerts')), false);
    assert.equal(calls.some((line) => line.includes('/heartbeat')), false);
  } finally {
    globalThis.fetch = original;
  }
});

test('http chain leaves an existing CAM-ALERT-01 unchanged', async () => {
  const original = globalThis.fetch;
  const calls = [];
  const existing = deviceRow({
    name: 'CAM-ALERT-01',
    note: null,
    onlineStatus: 'online',
    lastSeenAt: '2026-10-14T01:02:03.004Z',
  });
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push(`${init?.method || 'GET'} ${target}`);
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.endsWith('/devices') && init?.method === 'POST') {
      return jsonResponse(409, { message: '设备编码已存在' });
    }
    if (target.endsWith('/devices?pageSize=100')) {
      return jsonResponse(200, { items: [existing], total: 1 });
    }
    return jsonResponse(500, { message: `未预期的请求 ${target}` });
  };
  try {
    const result = await ensureListedCamera('tok');
    assert.equal(result.created, false);
    assert.equal(result.device.name, 'CAM-ALERT-01');
    assert.equal(result.device.note, null);
    assert.equal(calls.some((line) => line.startsWith('PATCH')), false);
    assert.equal(calls.some((line) => line.includes('/ingest')), false);
  } finally {
    globalThis.fetch = original;
  }
});
