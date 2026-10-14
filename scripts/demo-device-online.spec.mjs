import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { repoRoot } from './lib/ingest-wire.mjs';
import {
  DEVICE_SHED,
  OFFLINE_CAMERA,
  OFFLINE_NAME,
  OFFLINE_NOTE,
  ONLINE_CAMERA,
  ONLINE_NAME,
  ONLINE_NOTE,
  assertDeviceOnlinePair,
  assertFreshCamera,
  buildOnlineHeartbeat,
  deviceBody,
  formatDeviceOnlineProof,
  offlinePatchBody,
  showDeviceOnline,
  validateOnlineHeartbeat,
} from './demo-device-online.mjs';

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

function row(code, overrides = {}) {
  const kind = code === OFFLINE_CAMERA ? 'offline' : 'online';
  const body = deviceBody(kind);
  return {
    id: code === OFFLINE_CAMERA ? 'dev-off-01' : 'dev-on-01',
    code,
    name: body.name,
    type: 'camera',
    shedCode: DEVICE_SHED,
    note: body.note,
    onlineStatus: 'offline',
    lastHeartbeatAt: null,
    lastSeenAt: null,
    ...overrides,
  };
}

test('register bodies and the offline patch stay on the two list cameras', () => {
  assert.deepEqual(deviceBody('online'), {
    code: 'CAM-ON-01',
    name: '列表在线镜头',
    type: 'camera',
    shedCode: 'S01',
    note: '设备列表在线',
  });
  assert.deepEqual(deviceBody('offline'), {
    code: 'CAM-OFF-01',
    name: '列表离线镜头',
    type: 'camera',
    shedCode: 'S01',
    note: '设备列表离线',
  });
  assert.deepEqual(offlinePatchBody(), { onlineStatus: 'offline' });
  assert.equal(ONLINE_NAME, '列表在线镜头');
  assert.equal(OFFLINE_NOTE, '设备列表离线');
  assert.equal(Object.hasOwn(deviceBody('online'), 'onlineStatus'), false);
  assert.equal(Object.hasOwn(offlinePatchBody(), 'note'), false);
});

test('the heartbeat request is CAM-ON-01 and leaves the fixture device alone', () => {
  const now = new Date('2026-10-14T08:00:00.000Z');
  const body = buildOnlineHeartbeat(now);
  assert.equal(validateOnlineHeartbeat(body).deviceCode, ONLINE_CAMERA);
  assert.equal(body.deviceType, 'camera');
  assert.equal(body.online, true);
  assert.equal(body.shedCode, DEVICE_SHED);
  assert.equal(body.reportedAt, '2026-10-14T08:00:00.000Z');
  assert.notEqual(body.deviceCode, 'EDGE-SIM-BOX');
  assert.throws(() => validateOnlineHeartbeat({ ...body, deviceCode: 'CAM-DUTY-ON' }), /CAM-ON-01/);
  assert.throws(() => validateOnlineHeartbeat({ ...body, online: false }), /online/);
  assert.throws(() => validateOnlineHeartbeat({ ...body, deviceType: 'ai_box' }), /摄像头|EDGE-SIM-BOX/);
});

test('a new camera stays offline until the later heartbeat or patch', () => {
  assert.equal(assertFreshCamera(row(ONLINE_CAMERA), { created: true, kind: 'online' }).code, ONLINE_CAMERA);
  assert.equal(assertFreshCamera(row(OFFLINE_CAMERA), { created: true, kind: 'offline' }).note, OFFLINE_NOTE);
  assert.throws(
    () => assertFreshCamera(row(ONLINE_CAMERA, { onlineStatus: 'online' }), { created: true, kind: 'online' }),
    /离线/,
  );
  assert.throws(
    () => assertFreshCamera(row(OFFLINE_CAMERA, { name: '别的名字' }), { created: true, kind: 'offline' }),
    /名称或备注/,
  );
  assert.throws(() => assertFreshCamera(null, { created: true, kind: 'online' }), /没有 CAM-ON-01/);
});

test('an existing row may already be online and keeps its own name', () => {
  const existing = row(OFFLINE_CAMERA, {
    name: '旧离线镜头',
    note: '旧备注',
    onlineStatus: 'online',
    lastHeartbeatAt: '2026-10-14T01:02:03.004Z',
  });
  assert.equal(assertFreshCamera(existing, { created: false, kind: 'offline' }).name, '旧离线镜头');
  assert.throws(
    () => assertFreshCamera(row(ONLINE_CAMERA, { type: 'sensor' }), { created: false, kind: 'online' }),
    /类型/,
  );
  assert.throws(
    () => assertFreshCamera(row(ONLINE_CAMERA, { shedCode: 'S02' }), { created: false, kind: 'online' }),
    /棚区/,
  );
});

test('the unfiltered list must show one online row and one offline row', () => {
  const items = [
    row(ONLINE_CAMERA, { onlineStatus: 'online', lastHeartbeatAt: '2026-10-14T08:00:00.000Z' }),
    row('CAM-DUTY-ON', { id: 'duty-on', onlineStatus: 'online', lastHeartbeatAt: '2026-10-14T08:00:00.000Z' }),
    row(OFFLINE_CAMERA),
  ];
  const pair = assertDeviceOnlinePair(items);
  assert.equal(pair.online.code, ONLINE_CAMERA);
  assert.equal(pair.online.onlineStatus, 'online');
  assert.equal(pair.offline.code, OFFLINE_CAMERA);
  assert.equal(pair.offline.onlineStatus, 'offline');
  assert.throws(() => assertDeviceOnlinePair([items[2]]), /CAM-ON-01/);
  assert.throws(() => assertDeviceOnlinePair([items[0]]), /CAM-OFF-01/);
  assert.throws(
    () => assertDeviceOnlinePair([
      row(ONLINE_CAMERA, { onlineStatus: 'offline' }),
      row(OFFLINE_CAMERA),
    ]),
    /online/,
  );
  assert.throws(
    () => assertDeviceOnlinePair([
      row(ONLINE_CAMERA, { onlineStatus: 'online', lastHeartbeatAt: null }),
      row(OFFLINE_CAMERA),
    ]),
    /心跳/,
  );
  assert.throws(
    () => assertDeviceOnlinePair([
      row(ONLINE_CAMERA, { onlineStatus: 'online', lastHeartbeatAt: '2026-10-14T08:00:00.000Z' }),
      row(OFFLINE_CAMERA, { onlineStatus: 'online' }),
    ]),
    /offline/,
  );
});

test('proof names both rows and the devices page without an online filter', () => {
  const proof = formatDeviceOnlineProof({
    onlineCreated: true,
    offlineCreated: false,
    patchedOffline: true,
    online: row(ONLINE_CAMERA, { onlineStatus: 'online', lastHeartbeatAt: '2026-10-14T08:00:00.000Z' }),
    offline: row(OFFLINE_CAMERA),
  }, 'http://127.0.0.1:43123');
  assert.match(proof, /登记 CAM-ON-01: 新建/);
  assert.match(proof, /心跳: 已写入/);
  assert.match(proof, /登记 CAM-OFF-01: 已有，未改档案/);
  assert.match(proof, /离线: 已改状态/);
  assert.match(proof, /在线行: CAM-ON-01 在线/);
  assert.match(proof, /离线行: CAM-OFF-01 离线/);
  assert.match(proof, /在线 onlineStatus: online/);
  assert.match(proof, /离线 onlineStatus: offline/);
  assert.match(proof, /设备页: http:\/\/127\.0\.0\.1:43123\/devices$/m);
  assert.doesNotMatch(proof, /online=|duty-screen|CAM-DUTY/);
});

test('docs name the make target and leave the earlier demos alone', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_DEVICE_ONLINE.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  for (const text of [doc, caps, status, readme]) {
    assert.match(text, /make demo-device-online/);
    assert.match(text, /CAM-ON-01/);
    assert.match(text, /CAM-OFF-01/);
    assert.match(text, /\/devices/);
  }
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /在线/);
  assert.match(doc, /离线/);
  assert.match(doc, /make up && make migrate/);
  assert.match(doc, /make api/);
  assert.match(doc, /pageSize=100/);
  assert.match(doc, /不带 `online`|不要带 `online`/);
  assert.doesNotMatch(doc, /假定|假设/);
  assert.match(caps, /DEMO_DEVICE_ONLINE\.md/);
  assert.match(readme, /DEMO_DEVICE_ONLINE\.md/);
  assert.equal(
    readme.split('\n').filter((line) => line.includes('DEMO_DEVICE_ONLINE.md')).length,
    1,
  );
  assert.match(makefile, /^demo-device-online:.*\n\tnode scripts\/demo-device-online\.mjs\s*$/m);
  assert.match(makefile, /scripts\/demo-device-online\.spec\.mjs/);
  assert.match(makefile, /^demo-duty-board:.*\n\tnode scripts\/demo-duty-board\.mjs\s*$/m);
  assert.match(makefile, /^demo-register-and-heartbeat:.*\n\tnode scripts\/demo-register-and-heartbeat\.mjs\s*$/m);
  assert.match(makefile, /^demo-heartbeat-offline-alert:.*\n\tnode scripts\/demo-heartbeat-offline-alert\.mjs\s*$/m);
  assert.match(makefile, /^demo-camera-list:.*\n\tnode scripts\/demo-camera-list\.mjs\s*$/m);
  assert.match(makefile, /^demo-user-mgmt:.*\n\tnode scripts\/demo-user-mgmt\.mjs\s*$/m);
  const untouched = [
    'scripts/demo-duty-board.mjs',
    'scripts/demo-register-and-heartbeat.mjs',
    'scripts/demo-heartbeat-offline-alert.mjs',
    'scripts/demo-camera-list.mjs',
    'scripts/demo-camera-edit.mjs',
    'scripts/demo-user-mgmt.mjs',
    'scripts/demo-audit-log.mjs',
    'docs/DEMO_DUTY_BOARD.md',
    'docs/DEMO_REGISTER_AND_HEARTBEAT.md',
    'docs/DEMO_HEARTBEAT_OFFLINE_ALERT.md',
    'docs/DEMO_CAMERA_LIST.md',
    'docs/DEMO_USER_MGMT.md',
    'docs/DEMO_AUDIT_LOG.md',
  ];
  for (const relative of untouched) {
    const text = readFileSync(join(root, relative), 'utf8');
    assert.doesNotMatch(text, /CAM-ON-01|CAM-OFF-01|demo-device-online/);
  }
});

test('http chain logs in, heartbeats the online row, and reads the unfiltered list', async () => {
  const original = globalThis.fetch;
  const calls = [];
  const beatAt = '2026-10-14T08:00:00.000Z';
  let lists = 0;
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    const method = init?.method || 'GET';
    calls.push(`${method} ${target}`);
    if (target.endsWith('/auth/login')) {
      assert.deepEqual(JSON.parse(init.body), { username: 'admin', password: 'Admin@123456' });
      return jsonResponse(201, { accessToken: 'tok-admin' });
    }
    if (target.endsWith('/devices') && method === 'POST') {
      const body = JSON.parse(init.body);
      assert.equal(init.headers.authorization, 'Bearer tok-admin');
      if (body.code === ONLINE_CAMERA) {
        assert.deepEqual(body, deviceBody('online'));
        return jsonResponse(201, { id: 'dev-on-01', ...body });
      }
      assert.deepEqual(body, deviceBody('offline'));
      return jsonResponse(201, { id: 'dev-off-01', ...body });
    }
    if (target.endsWith('/ingest/heartbeat') && method === 'POST') {
      const body = JSON.parse(init.body);
      assert.equal(init.headers['x-ingest-token'], 'dev-ingest-token');
      assert.equal(body.deviceCode, ONLINE_CAMERA);
      assert.equal(body.online, true);
      return jsonResponse(201, { accepted: true, code: ONLINE_CAMERA, onlineStatus: 'online' });
    }
    if (target.endsWith('/devices?pageSize=100') && method === 'GET') {
      lists += 1;
      if (lists === 1) return jsonResponse(200, { items: [row(ONLINE_CAMERA)], total: 1 });
      const online = row(ONLINE_CAMERA, { onlineStatus: 'online', lastHeartbeatAt: beatAt });
      const offline = row(OFFLINE_CAMERA);
      return jsonResponse(200, { items: [online, offline], total: 2 });
    }
    return jsonResponse(500, { message: `未预期的请求 ${method} ${target}` });
  };
  try {
    const result = await showDeviceOnline({ now: new Date(beatAt) });
    assert.equal(result.onlineCreated, true);
    assert.equal(result.offlineCreated, true);
    assert.equal(result.patchedOffline, false);
    assert.equal(result.online.onlineStatus, 'online');
    assert.equal(result.offline.onlineStatus, 'offline');
    assert.equal(result.online.lastHeartbeatAt, beatAt);
    assert.equal(calls.filter((line) => line.startsWith('POST') && line.endsWith('/ingest/heartbeat')).length, 1);
    assert.equal(calls.filter((line) => line.startsWith('PATCH')).length, 0);
    assert.equal(calls.some((line) => /\/alerts|\/ingest\/recognition/.test(line)), false);
    assert.equal(lists, 3);
  } finally {
    globalThis.fetch = original;
  }
});

test('an existing online CAM-OFF-01 is patched offline and the list is read again', async () => {
  const original = globalThis.fetch;
  const calls = [];
  const beatAt = '2026-10-14T08:05:00.000Z';
  let lists = 0;
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    const method = init?.method || 'GET';
    calls.push(`${method} ${target}`);
    if (target.endsWith('/auth/login')) {
      return jsonResponse(201, { accessToken: 'tok-admin' });
    }
    if (target.endsWith('/devices') && method === 'POST') {
      const body = JSON.parse(init.body);
      assert.equal(body.code === ONLINE_CAMERA || body.code === OFFLINE_CAMERA, true);
      return jsonResponse(409, { message: '设备编码已存在' });
    }
    if (target.endsWith('/ingest/heartbeat') && method === 'POST') {
      return jsonResponse(201, { accepted: true, code: ONLINE_CAMERA });
    }
    if (target.endsWith('/devices/dev-off-01') && method === 'PATCH') {
      assert.deepEqual(JSON.parse(init.body), offlinePatchBody());
      return jsonResponse(200, row(OFFLINE_CAMERA));
    }
    if (target.endsWith('/devices?pageSize=100') && method === 'GET') {
      lists += 1;
      const online = row(ONLINE_CAMERA, {
        name: '已有在线镜头',
        note: '旧在线备注',
        onlineStatus: lists === 1 ? 'offline' : 'online',
        lastHeartbeatAt: lists === 1 ? null : beatAt,
      });
      const offline = row(OFFLINE_CAMERA, {
        name: '已有离线镜头',
        note: '旧离线备注',
        onlineStatus: lists < 3 ? 'online' : 'offline',
        lastHeartbeatAt: '2026-10-14T01:00:00.000Z',
      });
      return jsonResponse(200, { items: [online, offline], total: 2 });
    }
    return jsonResponse(500, { message: `未预期的请求 ${method} ${target}` });
  };
  try {
    const result = await showDeviceOnline({ now: new Date(beatAt) });
    assert.equal(result.onlineCreated, false);
    assert.equal(result.offlineCreated, false);
    assert.equal(result.patchedOffline, true);
    assert.equal(result.online.name, '已有在线镜头');
    assert.equal(result.offline.name, '已有离线镜头');
    assert.equal(result.offline.onlineStatus, 'offline');
    assert.equal(calls.filter((line) => line.startsWith('PATCH')).length, 1);
    assert.equal(calls.some((line) => line.includes('CAM-DUTY') || line.includes('/alerts')), false);
  } finally {
    globalThis.fetch = original;
  }
});
