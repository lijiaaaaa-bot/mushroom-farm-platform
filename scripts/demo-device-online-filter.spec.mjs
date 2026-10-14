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
  assertStatusSlice,
  buildOnlineHeartbeat,
  deviceBody,
  formatDeviceOnlineFilterProof,
  listPath,
  offlinePatchBody,
  pagePath,
  showDeviceOnlineFilter,
  validateOnlineHeartbeat,
} from './demo-device-online-filter.mjs';

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
    id: code === OFFLINE_CAMERA ? 'dev-flst-off' : 'dev-flst-on',
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

test('register bodies and the offline patch stay on the two filter cameras', () => {
  assert.deepEqual(deviceBody('online'), {
    code: 'CAM-FLST-ON',
    name: '筛选在线镜头',
    type: 'camera',
    shedCode: 'S01',
    note: '列表筛选在线',
  });
  assert.deepEqual(deviceBody('offline'), {
    code: 'CAM-FLST-OFF',
    name: '筛选离线镜头',
    type: 'camera',
    shedCode: 'S01',
    note: '列表筛选离线',
  });
  assert.deepEqual(offlinePatchBody(), { onlineStatus: 'offline' });
  assert.equal(ONLINE_NAME, '筛选在线镜头');
  assert.equal(OFFLINE_NOTE, '列表筛选离线');
  assert.equal(listPath('online'), '/devices?pageSize=100&online=online');
  assert.equal(listPath('offline'), '/devices?pageSize=100&online=offline');
  assert.equal(pagePath('online'), '/devices?online=online');
  assert.equal(pagePath('offline'), '/devices?online=offline');
  assert.equal(Object.hasOwn(deviceBody('online'), 'onlineStatus'), false);
  assert.throws(() => listPath('asleep'), /online 或 offline/);
});

test('the heartbeat request is CAM-FLST-ON and leaves the fixture device alone', () => {
  const now = new Date('2026-10-14T08:00:00.000Z');
  const body = buildOnlineHeartbeat(now);
  assert.equal(validateOnlineHeartbeat(body).deviceCode, ONLINE_CAMERA);
  assert.equal(body.deviceType, 'camera');
  assert.equal(body.online, true);
  assert.equal(body.shedCode, DEVICE_SHED);
  assert.equal(body.reportedAt, '2026-10-14T08:00:00.000Z');
  assert.notEqual(body.deviceCode, 'EDGE-SIM-BOX');
  assert.throws(() => validateOnlineHeartbeat({ ...body, deviceCode: 'CAM-ON-01' }), /CAM-FLST-ON/);
  assert.throws(() => validateOnlineHeartbeat({ ...body, deviceCode: 'CAM-DTL-ON' }), /CAM-FLST-ON/);
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
  assert.throws(() => assertFreshCamera(null, { created: true, kind: 'online' }), /没有 CAM-FLST-ON/);
});

test('an existing row may already be online and keeps its own name', () => {
  const existing = row(OFFLINE_CAMERA, {
    name: '旧离线镜头',
    note: '旧备注',
    onlineStatus: 'online',
    lastHeartbeatAt: '2026-10-14T01:02:03.004Z',
  });
  assert.equal(assertFreshCamera(existing, { created: false, kind: 'offline' }).name, '旧离线镜头');
  assert.equal(OFFLINE_NAME, '筛选离线镜头');
  assert.throws(
    () => assertFreshCamera(row(ONLINE_CAMERA, { type: 'sensor' }), { created: false, kind: 'online' }),
    /类型/,
  );
});

test('the two filtered lists show different rows', () => {
  const onlineItems = [
    row(ONLINE_CAMERA, { onlineStatus: 'online', lastHeartbeatAt: '2026-10-14T08:00:00.000Z' }),
    row('CAM-DUTY-ON', { id: 'duty-on', onlineStatus: 'online', lastHeartbeatAt: '2026-10-14T08:00:00.000Z' }),
  ];
  const offlineItems = [row(OFFLINE_CAMERA), row('CAM-DUTY-OFF', { id: 'duty-off' })];
  const online = assertStatusSlice(onlineItems, 'online', ONLINE_CAMERA, OFFLINE_CAMERA);
  const offline = assertStatusSlice(offlineItems, 'offline', OFFLINE_CAMERA, ONLINE_CAMERA);
  assert.equal(online.code, ONLINE_CAMERA);
  assert.equal(offline.code, OFFLINE_CAMERA);
  assert.notEqual(online.code, offline.code);
  assert.throws(() => assertStatusSlice(offlineItems, 'online', ONLINE_CAMERA, OFFLINE_CAMERA), /没有 CAM-FLST-ON|onlineStatus/);
  assert.throws(() => assertStatusSlice(onlineItems, 'offline', OFFLINE_CAMERA, ONLINE_CAMERA), /没有 CAM-FLST-OFF|onlineStatus/);
  assert.throws(
    () => assertStatusSlice(
      [...onlineItems, row(OFFLINE_CAMERA)],
      'online',
      ONLINE_CAMERA,
      OFFLINE_CAMERA,
    ),
    /CAM-FLST-OFF|onlineStatus/,
  );
  assert.throws(
    () => assertStatusSlice(
      [row(ONLINE_CAMERA, { onlineStatus: 'online', lastHeartbeatAt: null })],
      'online',
      ONLINE_CAMERA,
      OFFLINE_CAMERA,
    ),
    /心跳/,
  );
  assert.throws(() => assertStatusSlice([], 'offline', OFFLINE_CAMERA, ONLINE_CAMERA), /没有行/);
});

test('proof prints the online-only and offline-only list urls', () => {
  const proof = formatDeviceOnlineFilterProof({
    onlineCreated: true,
    offlineCreated: false,
    patchedOffline: true,
    online: row(ONLINE_CAMERA, { onlineStatus: 'online', lastHeartbeatAt: '2026-10-14T08:00:00.000Z' }),
    offline: row(OFFLINE_CAMERA),
  }, 'http://127.0.0.1:43123');
  assert.match(proof, /登记 CAM-FLST-ON: 新建/);
  assert.match(proof, /心跳: 已写入/);
  assert.match(proof, /登记 CAM-FLST-OFF: 已有，未改档案/);
  assert.match(proof, /离线: 已改状态/);
  assert.match(proof, /在线筛选: CAM-FLST-ON 在线/);
  assert.match(proof, /离线筛选: CAM-FLST-OFF 离线/);
  assert.match(proof, /在线列表不含: CAM-FLST-OFF/);
  assert.match(proof, /离线列表不含: CAM-FLST-ON/);
  assert.match(proof, /在线列表: http:\/\/127\.0\.0\.1:43123\/devices\?online=online/);
  assert.match(proof, /离线列表: http:\/\/127\.0\.0\.1:43123\/devices\?online=offline/);
  assert.doesNotMatch(proof, /CAM-ON-01|CAM-OFF-01|CAM-DTL-ON|alerts/);
});

test('docs name the make target, the two list urls, and the Mac screenshots', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_DEVICE_ONLINE_FILTER.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  for (const text of [doc, caps, status, readme]) {
    assert.match(text, /make demo-device-online-filter/);
    assert.match(text, /CAM-FLST-ON/);
    assert.match(text, /CAM-FLST-OFF/);
    assert.match(text, /\/devices\?online=online/);
    assert.match(text, /\/devices\?online=offline/);
  }
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /在线/);
  assert.match(doc, /离线/);
  assert.match(doc, /截图/);
  assert.match(doc, /Mac/);
  assert.match(doc, /没有符合条件的设备/);
  assert.match(doc, /make up && make migrate/);
  assert.match(doc, /make api/);
  assert.match(doc, /pageSize=100&online=online/);
  assert.match(doc, /pageSize=100&online=offline/);
  assert.doesNotMatch(doc, /假定|假设/);
  assert.match(caps, /DEMO_DEVICE_ONLINE_FILTER\.md/);
  assert.match(readme, /DEMO_DEVICE_ONLINE_FILTER\.md/);
  assert.equal(
    readme.split('\n').filter((line) => line.includes('DEMO_DEVICE_ONLINE_FILTER.md')).length,
    1,
  );
  assert.match(makefile, /^demo-device-online-filter:.*\n\tnode scripts\/demo-device-online-filter\.mjs\s*$/m);
  assert.match(makefile, /scripts\/demo-device-online-filter\.spec\.mjs/);
  assert.match(makefile, /^demo-device-online:.*\n\tnode scripts\/demo-device-online\.mjs\s*$/m);
  assert.match(makefile, /^demo-device-detail:.*\n\tnode scripts\/demo-device-detail\.mjs\s*$/m);
  assert.match(makefile, /^demo-duty-board:.*\n\tnode scripts\/demo-duty-board\.mjs\s*$/m);
  assert.match(makefile, /^demo-alert-status-filter:.*\n\tnode scripts\/demo-alert-status-filter\.mjs\s*$/m);
  const untouched = [
    'scripts/demo-device-online.mjs',
    'scripts/demo-device-detail.mjs',
    'scripts/demo-duty-board.mjs',
    'scripts/demo-alert-status-filter.mjs',
    'scripts/demo-alert-time-range.mjs',
    'docs/DEMO_DEVICE_ONLINE.md',
    'docs/DEMO_DEVICE_DETAIL.md',
    'docs/DEMO_DUTY_BOARD.md',
    'docs/DEMO_ALERT_STATUS_FILTER.md',
    'docs/DEMO_ALERT_TIME_RANGE.md',
  ];
  for (const relative of untouched) {
    const text = readFileSync(join(root, relative), 'utf8');
    assert.doesNotMatch(text, /CAM-FLST-ON|CAM-FLST-OFF|demo-device-online-filter/);
  }
});

test('http chain logs in, heartbeats the online row, and reads both filtered lists', async () => {
  const original = globalThis.fetch;
  const calls = [];
  const beatAt = '2026-10-14T08:00:00.000Z';
  let plainLists = 0;
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
        return jsonResponse(201, { id: 'dev-flst-on', ...body });
      }
      assert.deepEqual(body, deviceBody('offline'));
      return jsonResponse(201, { id: 'dev-flst-off', ...body });
    }
    if (target.endsWith('/ingest/heartbeat') && method === 'POST') {
      const body = JSON.parse(init.body);
      assert.equal(init.headers['x-ingest-token'], 'dev-ingest-token');
      assert.equal(body.deviceCode, ONLINE_CAMERA);
      assert.equal(body.online, true);
      return jsonResponse(201, { accepted: true, code: ONLINE_CAMERA, onlineStatus: 'online' });
    }
    if (target.endsWith('/devices?pageSize=100') && method === 'GET') {
      plainLists += 1;
      if (plainLists === 1) return jsonResponse(200, { items: [row(ONLINE_CAMERA)], total: 1 });
      return jsonResponse(200, {
        items: [
          row(ONLINE_CAMERA, { onlineStatus: 'online', lastHeartbeatAt: beatAt }),
          row(OFFLINE_CAMERA),
        ],
        total: 2,
      });
    }
    if (target.endsWith('/devices?pageSize=100&online=online') && method === 'GET') {
      return jsonResponse(200, {
        items: [
          row(ONLINE_CAMERA, { onlineStatus: 'online', lastHeartbeatAt: beatAt }),
          row('CAM-DUTY-ON', { id: 'duty-on', onlineStatus: 'online', lastHeartbeatAt: beatAt }),
        ],
        total: 2,
      });
    }
    if (target.endsWith('/devices?pageSize=100&online=offline') && method === 'GET') {
      return jsonResponse(200, {
        items: [row(OFFLINE_CAMERA)],
        total: 1,
      });
    }
    return jsonResponse(500, { message: `未预期的请求 ${method} ${target}` });
  };
  try {
    const result = await showDeviceOnlineFilter({ now: new Date(beatAt) });
    assert.equal(result.onlineCreated, true);
    assert.equal(result.offlineCreated, true);
    assert.equal(result.patchedOffline, false);
    assert.equal(result.online.code, ONLINE_CAMERA);
    assert.equal(result.offline.code, OFFLINE_CAMERA);
    assert.equal(result.online.onlineStatus, 'online');
    assert.equal(result.offline.onlineStatus, 'offline');
    assert.equal(calls.filter((line) => line.startsWith('POST') && line.endsWith('/ingest/heartbeat')).length, 1);
    assert.equal(calls.filter((line) => line.startsWith('PATCH')).length, 0);
    assert.equal(calls.filter((line) => line.includes('online=online')).length, 1);
    assert.equal(calls.filter((line) => line.includes('online=offline')).length, 1);
    assert.equal(calls.some((line) => /\/alerts|\/ingest\/recognition|CAM-ON-01|CAM-DTL/.test(line)), false);
    assert.equal(plainLists, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test('an existing online CAM-FLST-OFF is patched offline before the two lists are read', async () => {
  const original = globalThis.fetch;
  const calls = [];
  const beatAt = '2026-10-14T08:05:00.000Z';
  let plainLists = 0;
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
    if (target.endsWith('/devices/dev-flst-off') && method === 'PATCH') {
      assert.deepEqual(JSON.parse(init.body), offlinePatchBody());
      return jsonResponse(200, row(OFFLINE_CAMERA));
    }
    if (target.endsWith('/devices?pageSize=100') && method === 'GET') {
      plainLists += 1;
      const online = row(ONLINE_CAMERA, {
        name: '已有筛选在线',
        note: '旧在线备注',
        onlineStatus: plainLists === 1 ? 'offline' : 'online',
        lastHeartbeatAt: plainLists === 1 ? null : beatAt,
      });
      const offline = row(OFFLINE_CAMERA, {
        name: '已有筛选离线',
        note: '旧离线备注',
        onlineStatus: 'online',
        lastHeartbeatAt: '2026-10-14T01:00:00.000Z',
      });
      return jsonResponse(200, { items: [online, offline], total: 2 });
    }
    if (target.endsWith('/devices?pageSize=100&online=online') && method === 'GET') {
      return jsonResponse(200, {
        items: [row(ONLINE_CAMERA, {
          name: '已有筛选在线',
          note: '旧在线备注',
          onlineStatus: 'online',
          lastHeartbeatAt: beatAt,
        })],
        total: 1,
      });
    }
    if (target.endsWith('/devices?pageSize=100&online=offline') && method === 'GET') {
      return jsonResponse(200, {
        items: [row(OFFLINE_CAMERA, {
          name: '已有筛选离线',
          note: '旧离线备注',
          onlineStatus: 'offline',
          lastHeartbeatAt: '2026-10-14T01:00:00.000Z',
        })],
        total: 1,
      });
    }
    return jsonResponse(500, { message: `未预期的请求 ${method} ${target}` });
  };
  try {
    const result = await showDeviceOnlineFilter({ now: new Date(beatAt) });
    assert.equal(result.onlineCreated, false);
    assert.equal(result.offlineCreated, false);
    assert.equal(result.patchedOffline, true);
    assert.equal(result.online.name, '已有筛选在线');
    assert.equal(result.offline.name, '已有筛选离线');
    assert.equal(result.offline.onlineStatus, 'offline');
    assert.equal(calls.filter((line) => line.startsWith('PATCH')).length, 1);
    assert.equal(calls.some((line) => line.includes('CAM-ON-01') || line.includes('/alerts')), false);
  } finally {
    globalThis.fetch = original;
  }
});
