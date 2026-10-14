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
  assertFreshCamera,
  assertOfflineDetail,
  assertOnlineDetail,
  buildOnlineHeartbeat,
  deviceBody,
  formatDeviceDetailProof,
  offlinePatchBody,
  showDeviceDetail,
  validateOnlineHeartbeat,
} from './demo-device-detail.mjs';

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
    id: code === OFFLINE_CAMERA ? 'dev-dtl-off' : 'dev-dtl-on',
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

test('register bodies and the offline patch stay on the two detail cameras', () => {
  assert.deepEqual(deviceBody('online'), {
    code: 'CAM-DTL-ON',
    name: '详情在线镜头',
    type: 'camera',
    shedCode: 'S01',
    note: '设备详情在线',
  });
  assert.deepEqual(deviceBody('offline'), {
    code: 'CAM-DTL-OFF',
    name: '详情离线镜头',
    type: 'camera',
    shedCode: 'S01',
    note: '设备详情离线',
  });
  assert.deepEqual(offlinePatchBody(), { onlineStatus: 'offline' });
  assert.equal(ONLINE_NAME, '详情在线镜头');
  assert.equal(OFFLINE_NOTE, '设备详情离线');
  assert.equal(Object.hasOwn(deviceBody('online'), 'onlineStatus'), false);
  assert.equal(Object.hasOwn(offlinePatchBody(), 'note'), false);
  assert.notEqual(ONLINE_CAMERA, 'CAM-ON-01');
  assert.notEqual(OFFLINE_CAMERA, 'CAM-OFF-01');
  assert.notEqual(ONLINE_CAMERA, 'CAM-ALERT-01');
});

test('the heartbeat request is CAM-DTL-ON and leaves the fixture device alone', () => {
  const now = new Date('2026-10-14T08:00:00.000Z');
  const body = buildOnlineHeartbeat(now);
  assert.equal(validateOnlineHeartbeat(body).deviceCode, ONLINE_CAMERA);
  assert.equal(body.deviceType, 'camera');
  assert.equal(body.online, true);
  assert.equal(body.shedCode, DEVICE_SHED);
  assert.equal(body.reportedAt, '2026-10-14T08:00:00.000Z');
  assert.notEqual(body.deviceCode, 'EDGE-SIM-BOX');
  assert.throws(() => validateOnlineHeartbeat({ ...body, deviceCode: 'CAM-ON-01' }), /CAM-DTL-ON/);
  assert.throws(() => validateOnlineHeartbeat({ ...body, deviceCode: 'CAM-ALERT-01' }), /CAM-DTL-ON/);
  assert.throws(() => validateOnlineHeartbeat({ ...body, deviceCode: OFFLINE_CAMERA }), /CAM-DTL-ON/);
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
  assert.throws(() => assertFreshCamera(null, { created: true, kind: 'online' }), /没有 CAM-DTL-ON/);
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
});

test('the online detail must be online with a real last heartbeat', () => {
  const beatAt = '2026-10-14T08:00:00.000Z';
  const detail = assertOnlineDetail(
    row(ONLINE_CAMERA, { onlineStatus: 'online', lastHeartbeatAt: beatAt, name: ONLINE_NAME, note: ONLINE_NOTE }),
    { reportedAt: beatAt, duplicate: false },
  );
  assert.equal(detail.onlineStatus, 'online');
  assert.equal(detail.lastHeartbeatAt, beatAt);
  assert.throws(
    () => assertOnlineDetail(row(ONLINE_CAMERA, { onlineStatus: 'offline', lastHeartbeatAt: beatAt }), {
      reportedAt: beatAt,
      duplicate: false,
    }),
    /在线/,
  );
  assert.throws(
    () => assertOnlineDetail(row(ONLINE_CAMERA, { onlineStatus: 'online', lastHeartbeatAt: null }), {
      reportedAt: beatAt,
      duplicate: false,
    }),
    /最近心跳/,
  );
  assert.throws(
    () => assertOnlineDetail(
      row(ONLINE_CAMERA, { onlineStatus: 'online', lastHeartbeatAt: '2026-10-14T07:00:00.000Z' }),
      { reportedAt: beatAt, duplicate: false },
    ),
    /不是这次/,
  );
});

test('the offline detail is offline, with a dash or a leftover heartbeat', () => {
  const fresh = assertOfflineDetail(row(OFFLINE_CAMERA));
  assert.equal(fresh.onlineStatus, 'offline');
  assert.equal(fresh.lastHeartbeatAt, null);
  const stale = assertOfflineDetail(
    row(OFFLINE_CAMERA, { lastHeartbeatAt: '2026-10-14T01:00:00.000Z' }),
  );
  assert.equal(stale.onlineStatus, 'offline');
  assert.equal(stale.lastHeartbeatAt, '2026-10-14T01:00:00.000Z');
  assert.throws(
    () => assertOfflineDetail(row(OFFLINE_CAMERA, { onlineStatus: 'online' })),
    /离线/,
  );
});

test('proof prints both detail urls and a real online heartbeat', () => {
  const beatAt = '2026-10-14T08:00:00.000Z';
  const proof = formatDeviceDetailProof({
    onlineCreated: true,
    offlineCreated: true,
    patchedOffline: false,
    duplicate: false,
    online: row(ONLINE_CAMERA, { onlineStatus: 'online', lastHeartbeatAt: beatAt }),
    offline: row(OFFLINE_CAMERA),
  }, 'http://127.0.0.1:43123');
  assert.match(proof, /登记 CAM-DTL-ON: 新建/);
  assert.match(proof, /心跳: 已写入/);
  assert.match(proof, /在线状态: 在线/);
  assert.match(proof, /在线最近心跳: 2026-10-14T08:00:00.000Z/);
  assert.match(proof, /离线状态: 离线/);
  assert.match(proof, /离线最近心跳: —/);
  assert.match(proof, /离线心跳: 无心跳，页面写「—」/);
  assert.match(proof, /在线详情: http:\/\/127\.0\.0\.1:43123\/devices\/dev-dtl-on/);
  assert.match(proof, /离线详情: http:\/\/127\.0\.0\.1:43123\/devices\/dev-dtl-off/);
  assert.doesNotMatch(proof, /\/devices$/m);
  assert.doesNotMatch(proof, /online=|CAM-ON-01|CAM-OFF-01|CAM-ALERT-01/);
});

test('a patched-offline detail keeps the previous heartbeat in the proof', () => {
  const proof = formatDeviceDetailProof({
    onlineCreated: false,
    offlineCreated: false,
    patchedOffline: true,
    duplicate: false,
    online: row(ONLINE_CAMERA, { onlineStatus: 'online', lastHeartbeatAt: '2026-10-14T08:00:00.000Z' }),
    offline: row(OFFLINE_CAMERA, { name: '旧离线镜头', lastHeartbeatAt: '2026-10-14T01:00:00.000Z' }),
  }, 'http://127.0.0.1:43123');
  assert.match(proof, /离线: 已改状态/);
  assert.match(proof, /离线最近心跳: 2026-10-14T01:00:00.000Z/);
  assert.match(proof, /最近心跳留着上次时间/);
  assert.match(proof, /离线详情: http:\/\/127\.0\.0\.1:43123\/devices\/dev-dtl-off/);
});

test('docs name the make target and leave the earlier demos alone', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_DEVICE_DETAIL.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  for (const text of [doc, caps, status, readme]) {
    assert.match(text, /make demo-device-detail/);
    assert.match(text, /CAM-DTL-ON/);
    assert.match(text, /CAM-DTL-OFF/);
    assert.match(text, /\/devices\//);
  }
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /在线/);
  assert.match(doc, /离线/);
  assert.match(doc, /最近心跳/);
  assert.match(doc, /make up && make migrate/);
  assert.match(doc, /make api/);
  assert.match(doc, /GET \/api\/v1\/devices\/:id/);
  assert.doesNotMatch(doc, /假定|假设/);
  assert.match(caps, /DEMO_DEVICE_DETAIL\.md/);
  assert.match(readme, /DEMO_DEVICE_DETAIL\.md/);
  assert.equal(
    readme.split('\n').filter((line) => line.includes('DEMO_DEVICE_DETAIL.md')).length,
    1,
  );
  assert.match(makefile, /^demo-device-detail:.*\n\tnode scripts\/demo-device-detail\.mjs\s*$/m);
  assert.match(makefile, /scripts\/demo-device-detail\.spec\.mjs/);
  assert.match(makefile, /^demo-device-online:.*\n\tnode scripts\/demo-device-online\.mjs\s*$/m);
  assert.match(makefile, /^demo-camera-detail:.*\n\tnode scripts\/demo-camera-detail\.mjs\s*$/m);
  assert.match(makefile, /^demo-register-and-heartbeat:.*\n\tnode scripts\/demo-register-and-heartbeat\.mjs\s*$/m);
  const untouched = [
    'scripts/demo-device-online.mjs',
    'scripts/demo-camera-detail.mjs',
    'scripts/demo-register-and-heartbeat.mjs',
    'scripts/demo-camera-list.mjs',
    'docs/DEMO_DEVICE_ONLINE.md',
    'docs/DEMO_CAMERA_DETAIL.md',
    'docs/DEMO_REGISTER_AND_HEARTBEAT.md',
  ];
  for (const relative of untouched) {
    const text = readFileSync(join(root, relative), 'utf8');
    assert.doesNotMatch(text, /CAM-DTL-ON|CAM-DTL-OFF|demo-device-detail/);
  }
});

test('http chain heartbeats the online camera and reads both detail pages', async () => {
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
        return jsonResponse(201, { id: 'dev-dtl-on', ...body });
      }
      assert.deepEqual(body, deviceBody('offline'));
      return jsonResponse(201, { id: 'dev-dtl-off', ...body });
    }
    if (target.endsWith('/ingest/heartbeat') && method === 'POST') {
      const body = JSON.parse(init.body);
      assert.equal(init.headers['x-ingest-token'], 'dev-ingest-token');
      assert.equal(body.deviceCode, ONLINE_CAMERA);
      assert.equal(body.online, true);
      assert.equal(body.deviceType, 'camera');
      return jsonResponse(201, { accepted: true, code: ONLINE_CAMERA, onlineStatus: 'online' });
    }
    if (target.endsWith('/devices?pageSize=100') && method === 'GET') {
      lists += 1;
      if (lists === 1) return jsonResponse(200, { items: [row(ONLINE_CAMERA)], total: 1 });
      return jsonResponse(200, {
        items: [
          row(ONLINE_CAMERA, { onlineStatus: 'online', lastHeartbeatAt: beatAt }),
          row(OFFLINE_CAMERA),
        ],
        total: 2,
      });
    }
    if (target.endsWith('/devices/dev-dtl-on') && method === 'GET') {
      return jsonResponse(200, row(ONLINE_CAMERA, {
        onlineStatus: 'online',
        lastHeartbeatAt: beatAt,
        name: ONLINE_NAME,
        note: ONLINE_NOTE,
      }));
    }
    if (target.endsWith('/devices/dev-dtl-off') && method === 'GET') {
      return jsonResponse(200, row(OFFLINE_CAMERA, { name: OFFLINE_NAME, note: OFFLINE_NOTE }));
    }
    return jsonResponse(500, { message: `未预期的请求 ${method} ${target}` });
  };
  try {
    const result = await showDeviceDetail({ now: new Date(beatAt) });
    assert.equal(result.onlineCreated, true);
    assert.equal(result.offlineCreated, true);
    assert.equal(result.patchedOffline, false);
    assert.equal(result.duplicate, false);
    assert.equal(result.online.onlineStatus, 'online');
    assert.equal(result.online.lastHeartbeatAt, beatAt);
    assert.equal(result.offline.onlineStatus, 'offline');
    assert.equal(result.offline.lastHeartbeatAt, null);
    assert.equal(calls.filter((line) => line.startsWith('POST') && line.endsWith('/ingest/heartbeat')).length, 1);
    assert.equal(calls.filter((line) => line.startsWith('GET') && line.includes('/devices/dev-dtl-on')).length, 1);
    assert.equal(calls.filter((line) => line.startsWith('GET') && line.includes('/devices/dev-dtl-off')).length, 1);
    assert.equal(calls.filter((line) => line.startsWith('PATCH')).length, 0);
    assert.equal(calls.some((line) => /\/alerts|\/ingest\/recognition/.test(line)), false);
    assert.equal(lists, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test('an existing online CAM-DTL-OFF is patched offline and the detail is read again', async () => {
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
      return jsonResponse(201, { accepted: true, duplicate: true, code: ONLINE_CAMERA });
    }
    if (target.endsWith('/devices/dev-dtl-off') && method === 'PATCH') {
      assert.deepEqual(JSON.parse(init.body), offlinePatchBody());
      return jsonResponse(200, row(OFFLINE_CAMERA, { onlineStatus: 'offline' }));
    }
    if (target.endsWith('/devices?pageSize=100') && method === 'GET') {
      lists += 1;
      const online = row(ONLINE_CAMERA, {
        name: '已有在线镜头',
        note: '旧在线备注',
        onlineStatus: 'online',
        lastHeartbeatAt: beatAt,
      });
      const offline = row(OFFLINE_CAMERA, {
        name: '已有离线镜头',
        note: '旧离线备注',
        onlineStatus: 'online',
        lastHeartbeatAt: '2026-10-14T01:00:00.000Z',
      });
      return jsonResponse(200, { items: [online, offline], total: 2 });
    }
    if (target.endsWith('/devices/dev-dtl-on') && method === 'GET') {
      return jsonResponse(200, row(ONLINE_CAMERA, {
        name: '已有在线镜头',
        onlineStatus: 'online',
        lastHeartbeatAt: beatAt,
      }));
    }
    if (target.endsWith('/devices/dev-dtl-off') && method === 'GET') {
      return jsonResponse(200, row(OFFLINE_CAMERA, {
        name: '已有离线镜头',
        onlineStatus: 'offline',
        lastHeartbeatAt: '2026-10-14T01:00:00.000Z',
      }));
    }
    return jsonResponse(500, { message: `未预期的请求 ${method} ${target}` });
  };
  try {
    const result = await showDeviceDetail({ now: new Date(beatAt) });
    assert.equal(result.onlineCreated, false);
    assert.equal(result.offlineCreated, false);
    assert.equal(result.patchedOffline, true);
    assert.equal(result.duplicate, true);
    assert.equal(result.online.name, '已有在线镜头');
    assert.equal(result.online.onlineStatus, 'online');
    assert.equal(result.online.lastHeartbeatAt, beatAt);
    assert.equal(result.offline.name, '已有离线镜头');
    assert.equal(result.offline.onlineStatus, 'offline');
    assert.equal(result.offline.lastHeartbeatAt, '2026-10-14T01:00:00.000Z');
    assert.equal(calls.filter((line) => line.startsWith('PATCH')).length, 1);
    assert.equal(calls.filter((line) => line.startsWith('GET') && line.includes('/devices/dev-dtl-')).length, 2);
    assert.equal(calls.some((line) => line.includes('/alerts') || line.includes('CAM-ON-01')), false);
    assert.equal(lists, 2);
  } finally {
    globalThis.fetch = original;
  }
});
