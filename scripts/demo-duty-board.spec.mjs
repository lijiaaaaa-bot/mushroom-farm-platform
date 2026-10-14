import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fixtureFile, readFixture, repoRoot } from './lib/ingest-wire.mjs';
import {
  ALERT_MESSAGE,
  ALERT_TITLE,
  HEARTBEAT_FIXTURE,
  OFFLINE_CAMERA,
  OFFLINE_NAME,
  OFFLINE_NOTE,
  ONLINE_CAMERA,
  ONLINE_NAME,
  ONLINE_NOTE,
  alertBody,
  assertDutySnapshot,
  buildOnlineHeartbeat,
  deviceBody,
  formatDutyProof,
  showDutyBoard,
  validateOnlineHeartbeat,
} from './demo-duty-board.mjs';

const now = new Date('2026-10-14T03:04:05.006Z');
const root = repoRoot();

function jsonResponse(status, body) {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return text;
    },
  };
}

function pageOf(items, target) {
  const page = Number(target.searchParams.get('page') || '1');
  const pageSize = Number(target.searchParams.get('pageSize') || '20');
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    total: items.length,
    page,
    pageSize,
  };
}

function installApi(seed = {}) {
  const devices = new Map(seed.devices ?? []);
  const alerts = [...(seed.alerts ?? [])];
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const target = input instanceof URL ? input : new URL(String(input.url ?? input));
    const path = target.pathname.replace(/^\/api\/v1/, '');
    const method = (init.method || 'GET').toUpperCase();
    calls.push(`${method} ${path}`);
    if (method === 'POST' && path === '/auth/login') {
      return jsonResponse(200, { accessToken: 'token' });
    }
    if (method === 'POST' && path === '/devices') {
      const body = JSON.parse(init.body);
      if (devices.has(body.code)) {
        return jsonResponse(409, { message: '设备编码已存在' });
      }
      const device = {
        id: `dev-${body.code}`,
        ...body,
        onlineStatus: 'offline',
        lastHeartbeatAt: null,
      };
      devices.set(body.code, device);
      return jsonResponse(201, device);
    }
    if (method === 'PATCH' && path.startsWith('/devices/')) {
      const id = decodeURIComponent(path.slice('/devices/'.length));
      const device = [...devices.values()].find((row) => row.id === id);
      if (!device) return jsonResponse(404, { message: '设备不存在' });
      const body = JSON.parse(init.body);
      if (body.onlineStatus) device.onlineStatus = body.onlineStatus;
      return jsonResponse(200, device);
    }
    if (method === 'POST' && path === '/ingest/heartbeat') {
      const body = JSON.parse(init.body);
      const device = devices.get(body.deviceCode);
      if (!device) return jsonResponse(404, { message: '设备不存在', accepted: false });
      device.onlineStatus = body.online ? 'online' : 'offline';
      device.lastHeartbeatAt = body.reportedAt;
      return jsonResponse(200, { accepted: true, onlineStatus: device.onlineStatus, code: device.code });
    }
    if (method === 'GET' && path === '/devices') {
      let items = [...devices.values()];
      const shed = target.searchParams.get('shedCode');
      const online = target.searchParams.get('online');
      const type = target.searchParams.get('type');
      if (shed) items = items.filter((row) => row.shedCode === shed);
      if (online) items = items.filter((row) => row.onlineStatus === online);
      if (type) items = items.filter((row) => row.type === type);
      items.sort((left, right) => left.code.localeCompare(right.code));
      return jsonResponse(200, pageOf(items, target));
    }
    if (method === 'POST' && path === '/alerts') {
      const body = JSON.parse(init.body);
      const alert = {
        id: `alert-duty-${alerts.length + 1}`,
        ...body,
        status: 'open',
      };
      alerts.push(alert);
      return jsonResponse(201, alert);
    }
    if (method === 'GET' && path === '/alerts') {
      let items = [...alerts];
      const status = target.searchParams.get('status');
      const camera = target.searchParams.get('cameraCode');
      if (status) items = items.filter((row) => row.status === status);
      if (camera) items = items.filter((row) => row.cameraCode === camera);
      return jsonResponse(200, pageOf(items, target));
    }
    if (method === 'GET' && path.startsWith('/alerts/')) {
      const id = decodeURIComponent(path.slice('/alerts/'.length));
      const alert = alerts.find((row) => row.id === id);
      if (!alert) return jsonResponse(404, { message: '告警不存在' });
      return jsonResponse(200, alert);
    }
    if (method === 'GET' && path === '/dashboard/overview') {
      const all = [...devices.values()];
      return jsonResponse(200, {
        deviceTotal: all.length,
        deviceOnline: all.filter((row) => row.onlineStatus === 'online').length,
      });
    }
    return jsonResponse(500, { message: `未模拟 ${method} ${path}` });
  };
  return { devices, alerts, calls };
}

test('online heartbeat names CAM-DUTY-ON and leaves the fixture file alone', () => {
  const before = readFileSync(fixtureFile(HEARTBEAT_FIXTURE), 'utf8');
  const body = buildOnlineHeartbeat(now);
  assert.equal(body.deviceCode, ONLINE_CAMERA);
  assert.equal(body.deviceType, 'camera');
  assert.equal(body.online, true);
  assert.equal(body.reportedAt, now.toISOString());
  assert.equal(body.shedCode, 'S01');
  const canonical = validateOnlineHeartbeat(body);
  assert.equal(canonical.deviceCode, ONLINE_CAMERA);
  assert.equal(readFileSync(fixtureFile(HEARTBEAT_FIXTURE), 'utf8'), before);
  const fixture = readFixture(HEARTBEAT_FIXTURE);
  assert.equal(fixture.body.deviceCode, 'EDGE-SIM-BOX');
  assert.equal(fixture.body.deviceType, 'ai_box');
  assert.notEqual(body.deviceCode, fixture.body.deviceCode);
  assert.equal(deviceBody('online').note, ONLINE_NOTE);
  assert.equal(deviceBody('offline').code, OFFLINE_CAMERA);
  assert.equal(alertBody().title, ALERT_TITLE);
  assert.equal(alertBody().message, ALERT_MESSAGE);
});

test('snapshot requires both device lists and one open alert to match overview', () => {
  const alert = {
    id: 'alert-1',
    title: ALERT_TITLE,
    status: 'open',
    cameraCode: OFFLINE_CAMERA,
    shedCode: 'S01',
  };
  assertDutySnapshot({
    onlineTotal: 2,
    offlineTotal: 3,
    openTotal: 1,
    overview: { deviceOnline: 2, deviceTotal: 5 },
    onlineDevice: { code: ONLINE_CAMERA, onlineStatus: 'online' },
    offlineDevice: { code: OFFLINE_CAMERA, onlineStatus: 'offline' },
    alert,
  });
  assert.throws(
    () =>
      assertDutySnapshot({
        onlineTotal: 2,
        offlineTotal: 1,
        openTotal: 1,
        overview: { deviceOnline: 2, deviceTotal: 5 },
        onlineDevice: { code: ONLINE_CAMERA, onlineStatus: 'online' },
        offlineDevice: { code: OFFLINE_CAMERA, onlineStatus: 'offline' },
        alert,
      }),
    /总览离线/,
  );
});

test('proof names the duty board and the three lists', () => {
  const proof = formatDutyProof(
    {
      onlineCreated: true,
      offlineCreated: false,
      patchedOffline: true,
      alertCreated: false,
      alert: { id: 'alert-9' },
      onlineTotal: 4,
      offlineTotal: 6,
      openTotal: 1,
    },
    'http://127.0.0.1:43123/',
  );
  assert.match(proof, new RegExp(`登记 ${ONLINE_CAMERA}: 新建`));
  assert.match(proof, new RegExp(`登记 ${OFFLINE_CAMERA}: 已有，未改档案`));
  assert.match(proof, /离线: 已改状态/);
  assert.match(proof, /告警: 沿用待确认/);
  assert.match(proof, /在线设备: 4/);
  assert.match(proof, /离线设备: 6/);
  assert.match(proof, /待确认: 1/);
  assert.match(proof, /值班看板: http:\/\/127\.0\.0\.1:43123\/duty-screen/);
  assert.match(proof, /在线列表: http:\/\/127\.0\.0\.1:43123\/devices\?online=online/);
  assert.match(proof, /离线列表: http:\/\/127\.0\.0\.1:43123\/devices\?online=offline/);
  assert.match(proof, /告警列表: http:\/\/127\.0\.0\.1:43123\/alerts\?status=open/);
  assert.match(proof, /告警详情: http:\/\/127\.0\.0\.1:43123\/alerts\/alert-9/);
});

test('showDutyBoard leaves one online device, one offline device, and one open alert', async () => {
  const original = globalThis.fetch;
  const api = installApi();
  try {
    const result = await showDutyBoard({ now });
    assert.equal(result.onlineCreated, true);
    assert.equal(result.offlineCreated, true);
    assert.equal(result.patchedOffline, false);
    assert.equal(result.alertCreated, true);
    assert.equal(result.onlineTotal, 1);
    assert.equal(result.offlineTotal, 1);
    assert.equal(result.openTotal, 1);
    assert.equal(api.devices.get(ONLINE_CAMERA).onlineStatus, 'online');
    assert.equal(api.devices.get(ONLINE_CAMERA).name, ONLINE_NAME);
    assert.equal(api.devices.get(OFFLINE_CAMERA).onlineStatus, 'offline');
    assert.equal(api.devices.get(OFFLINE_CAMERA).name, OFFLINE_NAME);
    assert.equal(api.devices.get(OFFLINE_CAMERA).note, OFFLINE_NOTE);
    assert.equal(result.alert.title, ALERT_TITLE);
    assert.equal(result.alert.status, 'open');
    assert.equal(api.calls.filter((line) => line.startsWith('POST /ingest/heartbeat')).length, 1);
    assert.equal(api.calls.some((line) => line.includes('recognition')), false);
    const proof = formatDutyProof(result, 'http://127.0.0.1:43123');
    assert.match(proof, /在线设备: 1/);
    assert.match(proof, /离线设备: 1/);
    assert.match(proof, /待确认: 1/);
  } finally {
    globalThis.fetch = original;
  }
});

test('showDutyBoard keeps an existing offline camera and reuses an open alert', async () => {
  const original = globalThis.fetch;
  const offline = {
    id: 'dev-CAM-DUTY-OFF',
    code: OFFLINE_CAMERA,
    name: '原来的名字',
    type: 'camera',
    shedCode: 'S01',
    note: '原来的备注',
    onlineStatus: 'online',
    lastHeartbeatAt: '2026-10-13T00:00:00.000Z',
  };
  const api = installApi({
    devices: [[OFFLINE_CAMERA, offline]],
    alerts: [
      {
        id: 'alert-kept',
        title: ALERT_TITLE,
        status: 'open',
        cameraCode: OFFLINE_CAMERA,
        shedCode: 'S01',
        level: 'warning',
        message: ALERT_MESSAGE,
      },
    ],
  });
  try {
    const result = await showDutyBoard({ now });
    assert.equal(result.offlineCreated, false);
    assert.equal(result.patchedOffline, true);
    assert.equal(result.alertCreated, false);
    assert.equal(result.alert.id, 'alert-kept');
    assert.equal(api.devices.get(OFFLINE_CAMERA).name, '原来的名字');
    assert.equal(api.devices.get(OFFLINE_CAMERA).note, '原来的备注');
    assert.equal(api.devices.get(OFFLINE_CAMERA).onlineStatus, 'offline');
    assert.equal(api.alerts.length, 1);
    assert.equal(result.onlineTotal, 1);
    assert.equal(result.offlineTotal, 1);
    assert.equal(result.openTotal, 1);
    assert.equal(api.calls.filter((line) => line.startsWith('PATCH ')).length, 1);
    assert.equal(api.calls.filter((line) => line === 'POST /alerts').length, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test('the written steps name the make target and leave the other demos alone', () => {
  const doc = readFileSync(join(root, 'docs/DEMO_DUTY_BOARD.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  assert.match(doc, /make demo-duty-board/);
  assert.match(doc, /admin/);
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /CAM-DUTY-ON/);
  assert.match(doc, /CAM-DUTY-OFF/);
  assert.match(doc, /值班看板告警/);
  assert.match(doc, /\/duty-screen/);
  assert.match(doc, /\/devices\?online=online/);
  assert.match(doc, /\/devices\?online=offline/);
  assert.match(doc, /\/alerts\?status=open/);
  assert.match(caps, /make demo-duty-board/);
  assert.match(caps, /DEMO_DUTY_BOARD\.md/);
  assert.match(status, /make demo-duty-board/);
  assert.equal(readme.split('\n').filter((line) => line.includes('DEMO_DUTY_BOARD.md')).length, 1);
  assert.match(makefile, /^demo-duty-board:.*\n\tnode scripts\/demo-duty-board\.mjs\s*$/m);
  assert.match(makefile, /scripts\/demo-duty-board\.spec\.mjs/);
  assert.match(makefile, /^demo-register-and-heartbeat:.*\n\tnode scripts\/demo-register-and-heartbeat\.mjs\s*$/m);
  assert.match(makefile, /^demo-heartbeat-offline-alert:.*\n\tnode scripts\/demo-heartbeat-offline-alert\.mjs\s*$/m);
  assert.match(makefile, /^demo-one-alert:.*\n\tnode scripts\/demo-one-alert\.mjs\s*$/m);
  const heartbeat = readFileSync(fixtureFile(HEARTBEAT_FIXTURE), 'utf8');
  assert.match(heartbeat, /EDGE-SIM-BOX/);
  assert.doesNotMatch(heartbeat, /CAM-DUTY-ON/);
});
