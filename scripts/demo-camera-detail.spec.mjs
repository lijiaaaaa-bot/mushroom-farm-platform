import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DETAIL_MESSAGE,
  DETAIL_TITLE,
  alertBody,
  alertsUrl,
  assertAlertsOnDetail,
  assertDeviceDetail,
  formatDetailProof,
  pickReusableAlert,
  showCameraDetail,
} from './demo-camera-detail.mjs';
import { cameraBody } from './demo-camera-list.mjs';

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
    code: 'CAM-ALERT-01',
    name: '温度告警镜头',
    type: 'camera',
    shedCode: 'S01',
    note: '镜头码对照告警',
    onlineStatus: 'offline',
    lastHeartbeatAt: null,
    lastSeenAt: null,
    ...overrides,
  };
}

function alertRow(overrides = {}) {
  return {
    id: 'alert-detail-01',
    shedCode: 'S01',
    cameraCode: 'CAM-ALERT-01',
    level: 'warning',
    status: 'open',
    title: DETAIL_TITLE,
    message: DETAIL_MESSAGE,
    ...overrides,
  };
}

test('alert body is a warning on CAM-ALERT-01 and does not touch temperature rules', () => {
  assert.deepEqual(alertBody(), {
    shedCode: 'S01',
    cameraCode: 'CAM-ALERT-01',
    level: 'warning',
    title: '镜头详情告警',
    message: '棚区 S01 摄像头 CAM-ALERT-01 镜头详情',
  });
  assert.equal(alertsUrl().searchParams.get('cameraCode'), 'CAM-ALERT-01');
  assert.equal(alertsUrl().searchParams.get('pageSize'), '100');
  assert.equal(pickReusableAlert([alertRow({ status: 'acked' })]).status, 'acked');
  assert.equal(pickReusableAlert([alertRow({ title: '温度过高告警' })]), null);
  assert.equal(pickReusableAlert([alertRow({ cameraCode: 'CAM-FILTER-02' })]), null);
});

test('detail must match the listed camera and must not rewrite the archive', () => {
  assert.equal(assertDeviceDetail(deviceRow(), deviceRow()).id, 'dev-alert-01');
  assert.throws(() => assertDeviceDetail(deviceRow({ name: '另一台' }), deviceRow()), /名称/);
  assert.throws(() => assertDeviceDetail(deviceRow({ shedCode: 'S02' }), deviceRow({ shedCode: 'S02' })), /棚区/);
  assert.throws(() => assertDeviceDetail(deviceRow({ type: 'sensor' }), deviceRow({ type: 'sensor' })), /类型/);
  assert.throws(
    () => assertDeviceDetail(deviceRow({ onlineStatus: 'online' }), deviceRow()),
    /状态/,
  );
  assert.throws(
    () => assertDeviceDetail(deviceRow({ lastSeenAt: '2026-10-14T01:02:03.004Z' }), deviceRow()),
    /心跳/,
  );
});

test('related alerts stay on this camera', () => {
  assert.equal(assertAlertsOnDetail({ items: [alertRow()] }, alertRow()).id, 'alert-detail-01');
  assert.throws(
    () => assertAlertsOnDetail({ items: [alertRow({ cameraCode: 'CAM-FILTER-01' })] }, alertRow()),
    /其他摄像头/,
  );
  assert.throws(() => assertAlertsOnDetail({ items: [] }, alertRow()), /没有 alert-detail-01/);
});

test('proof names the list, the detail page, and the related alert', () => {
  const proof = formatDetailProof({
    created: true,
    alertCreated: true,
    device: deviceRow(),
    alert: alertRow(),
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /登记: 新建/);
  assert.match(proof, /告警: 新建/);
  assert.match(proof, /镜头码: CAM-ALERT-01/);
  assert.match(proof, /编号: CAM-ALERT-01/);
  assert.match(proof, /名称: 温度告警镜头/);
  assert.match(proof, /类型: 摄像头/);
  assert.match(proof, /棚区: S01/);
  assert.match(proof, /状态: 离线/);
  assert.match(proof, /备注: 镜头码对照告警/);
  assert.match(proof, /最近心跳: —/);
  assert.match(proof, /相关告警: 镜头详情告警/);
  assert.match(proof, /告警 id: alert-detail-01/);
  assert.match(proof, /告警级别: 一般/);
  assert.match(proof, /告警状态: 待确认/);
  assert.match(proof, /告警说明: 棚区 S01 摄像头 CAM-ALERT-01 镜头详情/);
  assert.match(proof, /设备页: http:\/\/127\.0\.0\.1:43123\/devices$/m);
  assert.match(proof, /镜头详情: http:\/\/127\.0\.0\.1:43123\/devices\/dev-alert-01/);
  assert.match(proof, /告警详情: http:\/\/127\.0\.0\.1:43123\/alerts\/alert-detail-01/);
  assert.doesNotMatch(proof, /CAM-REG-02/);
  assert.doesNotMatch(proof, /ingest/);
});

test('an existing camera and an existing alert are printed without rewriting them', () => {
  const proof = formatDetailProof({
    created: false,
    alertCreated: false,
    device: deviceRow({
      name: 'CAM-ALERT-01',
      note: null,
      onlineStatus: 'online',
      lastSeenAt: '2026-10-14T01:02:03.004Z',
    }),
    alert: alertRow({ status: 'acked', id: 'alert-kept' }),
    webOrigin: 'http://127.0.0.1:43123/',
  });
  assert.match(proof, /登记: 已有，未改档案/);
  assert.match(proof, /告警: 已有，未改/);
  assert.match(proof, /名称: CAM-ALERT-01/);
  assert.match(proof, /状态: 在线/);
  assert.match(proof, /备注: —/);
  assert.match(proof, /最近心跳: 2026-10-14T01:02:03.004Z/);
  assert.match(proof, /告警状态: 已确认/);
  assert.match(proof, /镜头详情: http:\/\/127\.0\.0\.1:43123\/devices\/dev-alert-01/);
});

test('http chain registers the camera, reads its detail, and leaves a related alert', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push(`${init?.method || 'GET'} ${target}`);
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.endsWith('/devices') && init?.method === 'POST') {
      assert.deepEqual(JSON.parse(init.body), cameraBody());
      return jsonResponse(201, deviceRow());
    }
    if (target.endsWith('/devices?pageSize=100')) {
      return jsonResponse(200, { items: [deviceRow()], total: 1 });
    }
    if (target.endsWith('/devices/dev-alert-01') && (!init?.method || init.method === 'GET')) {
      return jsonResponse(200, deviceRow());
    }
    if (target.includes('/alerts?') && target.includes('cameraCode=CAM-ALERT-01')) {
      const created = calls.some((line) => line.startsWith('POST') && line.includes('/alerts'));
      return jsonResponse(200, {
        items: created ? [alertRow()] : [],
        total: created ? 1 : 0,
      });
    }
    if (target.endsWith('/alerts') && init?.method === 'POST') {
      assert.deepEqual(JSON.parse(init.body), alertBody());
      assert.equal(init.headers.authorization, 'Bearer tok');
      return jsonResponse(201, alertRow());
    }
    if (target.endsWith('/alerts/alert-detail-01')) return jsonResponse(200, alertRow());
    return jsonResponse(500, { message: `未预期的请求 ${target}` });
  };
  try {
    const result = await showCameraDetail();
    assert.equal(result.created, true);
    assert.equal(result.alertCreated, true);
    assert.equal(result.device.code, 'CAM-ALERT-01');
    assert.equal(result.alert.title, DETAIL_TITLE);
    assert.equal(calls.some((line) => line.startsWith('PATCH')), false);
    assert.equal(calls.some((line) => line.includes('/ingest')), false);
    assert.equal(calls.some((line) => line.includes('/heartbeat')), false);
    assert.equal(calls.filter((line) => line.startsWith('POST') && line.endsWith('/alerts')).length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('http chain leaves an existing camera and its detail alert unchanged', async () => {
  const original = globalThis.fetch;
  const calls = [];
  const existing = deviceRow({
    name: 'CAM-ALERT-01',
    note: null,
    onlineStatus: 'online',
    lastSeenAt: '2026-10-14T01:02:03.004Z',
  });
  const kept = alertRow({ id: 'alert-kept', status: 'acked' });
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
    if (target.endsWith('/devices/dev-alert-01')) return jsonResponse(200, existing);
    if (target.includes('/alerts?')) return jsonResponse(200, { items: [kept, alertRow({ id: 'temp', title: '温度过高告警', cameraCode: 'CAM-ALERT-01' })], total: 2 });
    if (target.endsWith('/alerts/alert-kept')) return jsonResponse(200, kept);
    return jsonResponse(500, { message: `未预期的请求 ${target}` });
  };
  try {
    const result = await showCameraDetail();
    assert.equal(result.created, false);
    assert.equal(result.alertCreated, false);
    assert.equal(result.device.name, 'CAM-ALERT-01');
    assert.equal(result.alert.id, 'alert-kept');
    assert.equal(calls.some((line) => line.startsWith('PATCH')), false);
    assert.equal(calls.some((line) => line.startsWith('POST') && line.includes('/alerts')), false);
    assert.equal(calls.some((line) => line.includes('/ingest')), false);
  } finally {
    globalThis.fetch = original;
  }
});
