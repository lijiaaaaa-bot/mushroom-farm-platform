import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fixtureFile, readFixture, repoRoot } from './lib/ingest-wire.mjs';
import { REG_NAME, REG_NOTE, REG_SHED } from './demo-register-and-ingest.mjs';
import {
  HEARTBEAT_FIXTURE,
  assertListedOnline,
  buildHeartbeatPayload,
  formatHeartbeatProof,
  registerAndHeartbeat,
  validateHeartbeatPayload,
} from './demo-register-and-heartbeat.mjs';

const now = new Date('2026-10-14T01:02:03.004Z');

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
    id: 'dev-reg-02',
    code: 'CAM-REG-02',
    name: REG_NAME,
    type: 'camera',
    shedCode: REG_SHED,
    note: REG_NOTE,
    onlineStatus: 'offline',
    lastHeartbeatAt: null,
    ...overrides,
  };
}

test('heartbeat payload names CAM-REG-02 and leaves the fixture file alone', () => {
  const before = readFileSync(fixtureFile(HEARTBEAT_FIXTURE), 'utf8');
  const body = buildHeartbeatPayload(now);
  assert.equal(body.deviceCode, 'CAM-REG-02');
  assert.equal(body.shedCode, 'S01');
  assert.equal(body.deviceType, 'camera');
  assert.equal(body.online, true);
  assert.equal(body.reportedAt, now.toISOString());
  const canonical = validateHeartbeatPayload(body);
  assert.equal(canonical.deviceCode, 'CAM-REG-02');
  assert.equal(canonical.deviceType, 'camera');
  assert.equal(canonical.online, true);
  assert.equal(readFileSync(fixtureFile(HEARTBEAT_FIXTURE), 'utf8'), before);
  const fixture = readFixture(HEARTBEAT_FIXTURE);
  assert.equal(fixture.body.deviceCode, 'EDGE-SIM-BOX');
  assert.equal(fixture.body.deviceType, 'ai_box');
  assert.notEqual(body.deviceCode, fixture.body.deviceCode);
});

test('proof names the devices page and the duty shed for an online CAM-REG-02', () => {
  const proof = formatHeartbeatProof({
    created: true,
    device: deviceRow({
      onlineStatus: 'online',
      lastHeartbeatAt: now.toISOString(),
    }),
    beat: { duplicate: false, reportedAt: now.toISOString() },
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /登记: 新建/);
  assert.match(proof, /设备编号: CAM-REG-02/);
  assert.match(proof, /备注: 演示登记/);
  assert.match(proof, /心跳: 已写入/);
  assert.match(proof, /重复: 否/);
  assert.match(proof, /在线: 在线/);
  assert.match(proof, /最近心跳: 2026-10-14T01:02:03.004Z/);
  assert.match(proof, /设备页: http:\/\/127\.0\.0\.1:43123\/devices/);
  assert.match(proof, /值班看板: http:\/\/127\.0\.0\.1:43123\/duty-screen$/m);
  assert.match(proof, /值班棚: http:\/\/127\.0\.0\.1:43123\/duty-screen\/S01/);
  assert.doesNotMatch(proof, /CAM-DEMO-01/);
  assert.doesNotMatch(proof, /EDGE-SIM-BOX/);
});

test('http chain registers CAM-REG-02 then posts one heartbeat and reads it online', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push(`${init?.method || 'GET'} ${target}`);
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.endsWith('/devices') && init?.method === 'POST') {
      const body = JSON.parse(init.body);
      assert.deepEqual(body, {
        code: 'CAM-REG-02',
        name: '西侧过道',
        type: 'camera',
        shedCode: 'S01',
        note: '演示登记',
      });
      assert.equal(init.headers.authorization, 'Bearer tok');
      return jsonResponse(201, deviceRow());
    }
    if (target.includes('/devices?') && calls.filter((line) => line.includes('/devices?')).length === 1) {
      return jsonResponse(200, { items: [deviceRow()], total: 1 });
    }
    if (target.endsWith('/ingest/heartbeat')) {
      const body = JSON.parse(init.body);
      assert.equal(body.deviceCode, 'CAM-REG-02');
      assert.equal(body.shedCode, 'S01');
      assert.equal(body.deviceType, 'camera');
      assert.equal(body.online, true);
      assert.equal(body.reportedAt, now.toISOString());
      assert.equal(init.headers['x-ingest-token'], 'dev-ingest-token');
      return jsonResponse(201, {
        accepted: true,
        duplicate: false,
        code: 'CAM-REG-02',
        shedCode: 'S01',
        onlineStatus: 'online',
        lastHeartbeatAt: body.reportedAt,
      });
    }
    if (target.includes('/devices?')) {
      return jsonResponse(200, {
        items: [
          deviceRow({
            onlineStatus: 'online',
            lastHeartbeatAt: now.toISOString(),
          }),
        ],
        total: 1,
      });
    }
    throw new Error(`unexpected ${target}`);
  };
  try {
    const result = await registerAndHeartbeat({ now });
    assert.equal(result.created, true);
    assert.equal(result.device.onlineStatus, 'online');
    assert.equal(result.device.lastHeartbeatAt, now.toISOString());
    assert.equal(result.beat.duplicate, false);
    assert.equal(calls.filter((line) => line.startsWith('POST') && line.endsWith('/devices')).length, 1);
    assert.equal(
      calls.filter((line) => line.startsWith('POST') && line.endsWith('/ingest/heartbeat')).length,
      1,
    );
    assert.equal(calls.filter((line) => line.includes('/ingest/recognition')).length, 0);
    assert.equal(calls.filter((line) => line.startsWith('PATCH')).length, 0);
    const proof = formatHeartbeatProof(result);
    assert.match(proof, /在线: 在线/);
    assert.match(proof, /\/duty-screen\/S01/);
  } finally {
    globalThis.fetch = original;
  }
});

test('an existing CAM-REG-02 keeps its note and still receives one heartbeat', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push(`${init?.method || 'GET'} ${target}`);
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.endsWith('/devices') && init?.method === 'POST') {
      return jsonResponse(409, { message: '设备编码已存在', statusCode: 409 });
    }
    if (target.includes('/devices?') && calls.filter((line) => line.includes('/devices?')).length === 1) {
      return jsonResponse(200, {
        items: [deviceRow({ note: '靠门，已核对', onlineStatus: 'offline' })],
        total: 1,
      });
    }
    if (target.endsWith('/ingest/heartbeat')) {
      const body = JSON.parse(init.body);
      assert.equal(body.deviceCode, 'CAM-REG-02');
      return jsonResponse(201, {
        accepted: true,
        duplicate: false,
        code: 'CAM-REG-02',
        onlineStatus: 'online',
        lastHeartbeatAt: body.reportedAt,
      });
    }
    if (target.includes('/devices?')) {
      return jsonResponse(200, {
        items: [
          deviceRow({
            note: '靠门，已核对',
            onlineStatus: 'online',
            lastHeartbeatAt: now.toISOString(),
          }),
        ],
        total: 1,
      });
    }
    throw new Error(`unexpected ${target}`);
  };
  try {
    const result = await registerAndHeartbeat({ now });
    assert.equal(result.created, false);
    assert.equal(result.device.note, '靠门，已核对');
    assert.equal(result.device.onlineStatus, 'online');
    assert.equal(calls.filter((line) => line.startsWith('PATCH')).length, 0);
    assert.match(formatHeartbeatProof(result), /登记: 已有，未改档案/);
    assert.match(formatHeartbeatProof(result), /备注: 靠门，已核对/);
  } finally {
    globalThis.fetch = original;
  }
});

test('a duplicate heartbeat still counts when the list stays online with a newer beat', async () => {
  const original = globalThis.fetch;
  const newer = '2026-10-14T02:00:00.000Z';
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.endsWith('/devices') && init?.method === 'POST') {
      return jsonResponse(409, { message: '设备编码已存在', statusCode: 409 });
    }
    if (target.endsWith('/ingest/heartbeat')) {
      return jsonResponse(201, {
        accepted: true,
        duplicate: true,
        code: 'CAM-REG-02',
        onlineStatus: 'online',
        lastHeartbeatAt: newer,
      });
    }
    if (target.includes('/devices?')) {
      return jsonResponse(200, {
        items: [
          deviceRow({
            onlineStatus: 'online',
            lastHeartbeatAt: newer,
          }),
        ],
        total: 1,
      });
    }
    throw new Error(`unexpected ${target}`);
  };
  try {
    const result = await registerAndHeartbeat({ now });
    assert.equal(result.beat.duplicate, true);
    assert.equal(result.device.lastHeartbeatAt, newer);
    assert.match(formatHeartbeatProof(result), /重复: 是/);
    assert.match(formatHeartbeatProof(result), /在线: 在线/);
  } finally {
    globalThis.fetch = original;
  }
});

test('register failure stops before any heartbeat post', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push(target);
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.endsWith('/devices')) return jsonResponse(403, { message: 'Forbidden' });
    throw new Error(`unexpected ${target}`);
  };
  try {
    await assert.rejects(() => registerAndHeartbeat({ now }), /登记失败 403/);
    assert.equal(calls.filter((url) => url.endsWith('/ingest/heartbeat')).length, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test('a rejected heartbeat does not claim the camera is online', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.endsWith('/devices') && init?.method === 'POST') return jsonResponse(201, deviceRow());
    if (target.includes('/devices?')) return jsonResponse(200, { items: [deviceRow()], total: 1 });
    if (target.endsWith('/ingest/heartbeat')) {
      return jsonResponse(400, {
        accepted: false,
        code: 'UNKNOWN_FIELD',
        message: '心跳报文被拒绝',
        errors: ['未声明字段 firmware'],
      });
    }
    throw new Error(`unexpected ${target}`);
  };
  try {
    await assert.rejects(() => registerAndHeartbeat({ now }), /心跳被拒绝 400/);
  } finally {
    globalThis.fetch = original;
  }
});

test('an accepted heartbeat still fails when the device list stays offline', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.endsWith('/devices') && init?.method === 'POST') return jsonResponse(201, deviceRow());
    if (target.endsWith('/ingest/heartbeat')) {
      return jsonResponse(201, {
        accepted: true,
        duplicate: false,
        code: 'CAM-REG-02',
        onlineStatus: 'online',
        lastHeartbeatAt: now.toISOString(),
      });
    }
    if (target.includes('/devices?')) return jsonResponse(200, { items: [deviceRow()], total: 1 });
    throw new Error(`unexpected ${target}`);
  };
  try {
    await assert.rejects(() => registerAndHeartbeat({ now }), /不是在线/);
  } finally {
    globalThis.fetch = original;
  }
});

test('online without lastHeartbeatAt is not enough for the duty shed', () => {
  assert.throws(
    () =>
      assertListedOnline(deviceRow({ onlineStatus: 'online', lastHeartbeatAt: null }), {
        reportedAt: now.toISOString(),
        duplicate: false,
      }),
    /没有最近心跳/,
  );
});

test('the written steps name the make target, the devices page, and the duty shed', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_REGISTER_AND_HEARTBEAT.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const registerDoc = readFileSync(join(root, 'docs/DEMO_REGISTER_AND_INGEST.md'), 'utf8');
  const one = readFileSync(join(root, 'docs/DEMO_ONE_INGEST.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  assert.match(doc, /make demo-register-and-heartbeat/);
  assert.match(doc, /admin/);
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /\/devices/);
  assert.match(doc, /CAM-REG-02/);
  assert.match(doc, /S01/);
  assert.match(doc, /西侧过道/);
  assert.match(doc, /演示登记/);
  assert.match(doc, /在线/);
  assert.match(doc, /\/duty-screen\/S01/);
  assert.match(doc, /\/duty-screen/);
  assert.match(doc, /POST \/api\/v1\/ingest\/heartbeat/);
  assert.match(doc, /X-Ingest-Token/);
  assert.match(doc, /heartbeat\.http\.json/);
  assert.match(caps, /make demo-register-and-heartbeat/);
  assert.match(caps, /DEMO_REGISTER_AND_HEARTBEAT\.md/);
  assert.match(caps, /lastHeartbeatAt/);
  assert.match(status, /make demo-register-and-heartbeat/);
  assert.match(status, /CAM-REG-02/);
  assert.match(readme, /DEMO_REGISTER_AND_HEARTBEAT\.md/);
  assert.match(registerDoc, /make demo-register-and-ingest/);
  assert.doesNotMatch(registerDoc, /demo-register-and-heartbeat/);
  assert.doesNotMatch(one, /CAM-REG-02/);
  assert.match(
    makefile,
    /^demo-register-and-heartbeat:.*\n\tnode scripts\/demo-register-and-heartbeat\.mjs\s*$/m,
  );
  assert.match(
    makefile,
    /^demo-register-and-ingest:.*\n\tnode scripts\/demo-register-and-ingest\.mjs\s*$/m,
  );
  assert.match(makefile, /scripts\/demo-register-and-heartbeat\.spec\.mjs/);
  const added = readme.split('\n').filter((line) => line.includes('DEMO_REGISTER_AND_HEARTBEAT.md'));
  assert.equal(added.length, 1);
});
