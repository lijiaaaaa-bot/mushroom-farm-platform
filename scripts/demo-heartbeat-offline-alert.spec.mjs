import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fixtureFile, readFixture, repoRoot } from './lib/ingest-wire.mjs';
import {
  HB_CAMERA,
  HB_NAME,
  HB_NOTE,
  HB_SHED,
  HEARTBEAT_FIXTURE,
  assertOfflineAlert,
  assertOfflineDevice,
  buildOfflineHeartbeat,
  demoOfflineWaitMs,
  formatOfflineProof,
  heartbeatOfflineAlert,
  longTimeoutMessage,
  validateOfflineHeartbeat,
} from './demo-heartbeat-offline-alert.mjs';

const now = new Date('2026-10-14T03:04:05.006Z');

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

function deviceRow(overrides = {}) {
  return {
    id: 'dev-hb-off',
    code: HB_CAMERA,
    name: HB_NAME,
    type: 'camera',
    shedCode: HB_SHED,
    note: HB_NOTE,
    onlineStatus: 'offline',
    lastHeartbeatAt: null,
    ...overrides,
  };
}

function alertRow(overrides = {}) {
  return {
    id: 'alert-hb-off',
    title: '设备离线',
    message: '棚区 S01 设备 CAM-HB-OFF-01 超时未心跳（阈值 2 秒）',
    shedCode: HB_SHED,
    cameraCode: HB_CAMERA,
    metric: 'device_offline',
    level: 'warning',
    status: 'open',
    createdAt: '2026-10-14T03:04:08.000Z',
    ...overrides,
  };
}

function instantSleep(clock) {
  return async (ms) => {
    clock.now += ms;
  };
}

test('heartbeat payload names CAM-HB-OFF-01 and leaves the fixture file alone', () => {
  const before = readFileSync(fixtureFile(HEARTBEAT_FIXTURE), 'utf8');
  const body = buildOfflineHeartbeat(now);
  assert.equal(body.deviceCode, HB_CAMERA);
  assert.equal(body.shedCode, HB_SHED);
  assert.equal(body.deviceType, 'camera');
  assert.equal(body.online, true);
  assert.equal(body.reportedAt, now.toISOString());
  const canonical = validateOfflineHeartbeat(body);
  assert.equal(canonical.deviceCode, HB_CAMERA);
  assert.equal(readFileSync(fixtureFile(HEARTBEAT_FIXTURE), 'utf8'), before);
  const fixture = readFixture(HEARTBEAT_FIXTURE);
  assert.equal(fixture.body.deviceCode, 'EDGE-SIM-BOX');
  assert.notEqual(body.deviceCode, fixture.body.deviceCode);
});

test('a timeout of at least a minute is refused instead of waiting it out', () => {
  assert.equal(demoOfflineWaitMs({ DEVICE_OFFLINE_AFTER_MS: '2000' }), 2000 + 1000 * 2 + 1500);
  assert.equal(demoOfflineWaitMs({}), 2000 + 1000 * 2 + 1500);
  assert.equal(demoOfflineWaitMs({ DEVICE_OFFLINE_AFTER_MS: '300000' }), null);
  assert.match(longTimeoutMessage(300000), /不会空等/);
  assert.match(longTimeoutMessage(300000), /DEVICE_OFFLINE_AFTER_MS=2000/);
});

test('proof names the devices page and the alert detail', () => {
  const proof = formatOfflineProof({
    created: true,
    device: deviceRow({
      onlineStatus: 'offline',
      lastHeartbeatAt: now.toISOString(),
    }),
    alert: alertRow(),
    timeoutMs: 2000,
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /登记: 新建/);
  assert.match(proof, /设备编号: CAM-HB-OFF-01/);
  assert.match(proof, /心跳: 已写入/);
  assert.match(proof, /在线: 在线/);
  assert.match(proof, /超时: DEVICE_OFFLINE_AFTER_MS=2000/);
  assert.match(proof, /离线: 离线/);
  assert.match(proof, /告警: 设备离线/);
  assert.match(proof, /告警 id: alert-hb-off/);
  assert.match(proof, /状态: 待确认/);
  assert.match(proof, /设备页: http:\/\/127\.0\.0\.1:43123\/devices/);
  assert.match(proof, /告警详情: http:\/\/127\.0\.0\.1:43123\/alerts\/alert-hb-off/);
  assert.doesNotMatch(proof, /CAM-REG-02/);
  assert.doesNotMatch(proof, /status=/);
});

test('http chain registers, posts one online heartbeat, then reads offline and the alert', async () => {
  const original = globalThis.fetch;
  const calls = [];
  let deviceReads = 0;
  const clock = { now: 1_000 };
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push(`${init?.method || 'GET'} ${target}`);
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.endsWith('/devices') && init?.method === 'POST') {
      const body = JSON.parse(init.body);
      assert.deepEqual(body, {
        code: 'CAM-HB-OFF-01',
        name: '心跳超时镜头',
        type: 'camera',
        shedCode: 'S01',
        note: '心跳超时演示',
      });
      assert.equal(init.headers.authorization, 'Bearer tok');
      return jsonResponse(201, deviceRow());
    }
    if (target.endsWith('/ingest/heartbeat')) {
      const body = JSON.parse(init.body);
      assert.equal(body.deviceCode, 'CAM-HB-OFF-01');
      assert.equal(body.deviceType, 'camera');
      assert.equal(body.online, true);
      assert.equal(body.reportedAt, now.toISOString());
      assert.equal(init.headers['x-ingest-token'], 'dev-ingest-token');
      return jsonResponse(201, {
        accepted: true,
        duplicate: false,
        code: 'CAM-HB-OFF-01',
        shedCode: 'S01',
        onlineStatus: 'online',
        lastHeartbeatAt: body.reportedAt,
      });
    }
    if (target.includes('/devices?')) {
      deviceReads += 1;
      if (deviceReads === 1) return jsonResponse(200, { items: [deviceRow()], total: 1 });
      if (deviceReads === 2) {
        return jsonResponse(200, {
          items: [deviceRow({ onlineStatus: 'online', lastHeartbeatAt: now.toISOString() })],
          total: 1,
        });
      }
      return jsonResponse(200, {
        items: [deviceRow({ onlineStatus: 'offline', lastHeartbeatAt: now.toISOString() })],
        total: 1,
      });
    }
    if (target.includes('/alerts?')) {
      assert.match(target, /cameraCode=CAM-HB-OFF-01/);
      assert.doesNotMatch(target, /status=/);
      if (deviceReads < 3) return jsonResponse(200, { items: [], total: 0 });
      return jsonResponse(200, { items: [alertRow()], total: 1 });
    }
    if (target.endsWith('/alerts/alert-hb-off')) return jsonResponse(200, alertRow());
    throw new Error(`unexpected ${target}`);
  };
  try {
    const result = await heartbeatOfflineAlert({
      now,
      sleepFn: instantSleep(clock),
      clock: () => clock.now,
      waitMs: 5_500,
      timeoutMs: 2_000,
    });
    assert.equal(result.created, true);
    assert.equal(result.device.onlineStatus, 'offline');
    assert.equal(result.alert.id, 'alert-hb-off');
    assert.equal(result.alert.status, 'open');
    assert.equal(
      calls.filter((line) => line.startsWith('POST') && line.endsWith('/devices')).length,
      1,
    );
    assert.equal(
      calls.filter((line) => line.startsWith('POST') && line.endsWith('/ingest/heartbeat')).length,
      1,
    );
    assert.equal(calls.filter((line) => line.includes('/ingest/recognition')).length, 0);
    assert.equal(calls.filter((line) => line.startsWith('PATCH')).length, 0);
    const proof = formatOfflineProof(result);
    assert.match(proof, /离线: 离线/);
    assert.match(proof, /\/alerts\/alert-hb-off/);
  } finally {
    globalThis.fetch = original;
  }
});

test('an existing camera keeps its note and still times out into one open alert', async () => {
  const original = globalThis.fetch;
  let deviceReads = 0;
  const clock = { now: 0 };
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.endsWith('/devices') && init?.method === 'POST') {
      return jsonResponse(409, { message: '设备编码已存在', statusCode: 409 });
    }
    if (target.endsWith('/ingest/heartbeat')) {
      return jsonResponse(201, {
        accepted: true,
        duplicate: false,
        code: 'CAM-HB-OFF-01',
        onlineStatus: 'online',
        lastHeartbeatAt: now.toISOString(),
      });
    }
    if (target.includes('/devices?')) {
      deviceReads += 1;
      const note = '靠北墙';
      if (deviceReads === 1) {
        return jsonResponse(200, { items: [deviceRow({ note, onlineStatus: 'offline' })], total: 1 });
      }
      return jsonResponse(200, {
        items: [
          deviceRow({
            note,
            onlineStatus: 'offline',
            lastHeartbeatAt: now.toISOString(),
          }),
        ],
        total: 1,
      });
    }
    if (target.includes('/alerts?')) {
      return jsonResponse(200, { items: [alertRow({ status: 'acked' })], total: 1 });
    }
    if (target.endsWith('/alerts/alert-hb-off')) {
      return jsonResponse(200, alertRow({ status: 'acked' }));
    }
    throw new Error(`unexpected ${target}`);
  };
  try {
    const result = await heartbeatOfflineAlert({
      now,
      sleepFn: instantSleep(clock),
      clock: () => clock.now,
      waitMs: 5_500,
      timeoutMs: 2_000,
    });
    assert.equal(result.created, false);
    assert.equal(result.device.note, '靠北墙');
    assert.match(formatOfflineProof(result), /登记: 已有，未改档案/);
    assert.match(formatOfflineProof(result), /状态: 已确认/);
  } finally {
    globalThis.fetch = original;
  }
});

test('staying online fails without claiming an offline alert', async () => {
  const original = globalThis.fetch;
  const clock = { now: 0 };
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.endsWith('/devices') && init?.method === 'POST') return jsonResponse(201, deviceRow());
    if (target.endsWith('/ingest/heartbeat')) {
      return jsonResponse(201, {
        accepted: true,
        duplicate: false,
        code: 'CAM-HB-OFF-01',
        onlineStatus: 'online',
        lastHeartbeatAt: now.toISOString(),
      });
    }
    if (target.includes('/devices?')) {
      return jsonResponse(200, {
        items: [deviceRow({ onlineStatus: 'online', lastHeartbeatAt: now.toISOString() })],
        total: 1,
      });
    }
    if (target.includes('/alerts?')) return jsonResponse(200, { items: [], total: 0 });
    throw new Error(`unexpected ${target}`);
  };
  try {
    await assert.rejects(
      () =>
        heartbeatOfflineAlert({
          now,
          sleepFn: instantSleep(clock),
          clock: () => clock.now,
          waitMs: 400,
          timeoutMs: 2_000,
        }),
      /仍是在线/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('a duplicate heartbeat does not count as going online again', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.endsWith('/devices') && init?.method === 'POST') return jsonResponse(201, deviceRow());
    if (target.includes('/devices?')) return jsonResponse(200, { items: [deviceRow()], total: 1 });
    if (target.endsWith('/ingest/heartbeat')) {
      return jsonResponse(201, {
        accepted: true,
        duplicate: true,
        code: 'CAM-HB-OFF-01',
        onlineStatus: 'offline',
        lastHeartbeatAt: now.toISOString(),
      });
    }
    throw new Error(`unexpected ${target}`);
  };
  try {
    await assert.rejects(
      () => heartbeatOfflineAlert({ now, waitMs: 100, timeoutMs: 2_000 }),
      /不新于已有心跳/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('offline without a timeout alert fails', () => {
  assert.throws(
    () => assertOfflineAlert({ ...alertRow(), message: '棚区 S01 设备 CAM-HB-OFF-01 上报离线（阈值 2 秒）' }),
    /超时/,
  );
  assert.throws(
    () => assertOfflineDevice(deviceRow({ onlineStatus: 'offline', lastHeartbeatAt: null })),
    /没有最近心跳/,
  );
});

test('the written steps name the make target, the short timeout, and the two pages', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_HEARTBEAT_OFFLINE_ALERT.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  const heartbeatDoc = readFileSync(join(root, 'docs/DEMO_REGISTER_AND_HEARTBEAT.md'), 'utf8');
  assert.match(doc, /make demo-heartbeat-offline-alert/);
  assert.match(doc, /admin/);
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /CAM-HB-OFF-01/);
  assert.match(doc, /S01/);
  assert.match(doc, /心跳超时镜头/);
  assert.match(doc, /心跳超时演示/);
  assert.match(doc, /DEVICE_OFFLINE_AFTER_MS=2000/);
  assert.match(doc, /\/devices/);
  assert.match(doc, /\/alerts\//);
  assert.match(doc, /设备离线/);
  assert.match(doc, /POST \/api\/v1\/ingest\/heartbeat/);
  assert.match(doc, /X-Ingest-Token/);
  assert.match(doc, /heartbeat\.http\.json/);
  assert.match(doc, /不会空等/);
  assert.doesNotMatch(doc, /状态筛选/);
  assert.match(caps, /make demo-heartbeat-offline-alert/);
  assert.match(caps, /DEMO_HEARTBEAT_OFFLINE_ALERT\.md/);
  assert.match(caps, /CAM-HB-OFF-01/);
  assert.match(status, /make demo-heartbeat-offline-alert/);
  assert.match(status, /CAM-HB-OFF-01/);
  assert.match(readme, /DEMO_HEARTBEAT_OFFLINE_ALERT\.md/);
  assert.match(heartbeatDoc, /make demo-register-and-heartbeat/);
  assert.doesNotMatch(heartbeatDoc, /CAM-HB-OFF-01/);
  assert.match(
    makefile,
    /^demo-heartbeat-offline-alert:.*\n\tnode scripts\/demo-heartbeat-offline-alert\.mjs\s*$/m,
  );
  assert.match(makefile, /scripts\/demo-heartbeat-offline-alert\.spec\.mjs/);
  assert.match(
    makefile,
    /^demo-register-and-heartbeat:.*\n\tnode scripts\/demo-register-and-heartbeat\.mjs\s*$/m,
  );
  const added = readme.split('\n').filter((line) => line.includes('DEMO_HEARTBEAT_OFFLINE_ALERT.md'));
  assert.equal(added.length, 1);
});
