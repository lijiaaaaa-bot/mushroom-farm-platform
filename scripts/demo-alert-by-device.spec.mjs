import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { repoRoot } from './lib/ingest-wire.mjs';
import {
  DEVICE_LEVEL,
  DEVICE_SHED,
  DEVICE_SPECS,
  EAST_CAMERA,
  EAST_TITLE,
  TITLE_QUERY,
  WEST_CAMERA,
  WEST_TITLE,
  alertMessage,
  assertBothPresent,
  assertDeviceRows,
  deviceBody,
  formatDeviceProof,
  listUrl,
  pickReusable,
  sendDeviceFilterDemo,
} from './demo-alert-by-device.mjs';

const eastDeviceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const westDeviceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const eastAlertId = '11111111-1111-4111-8111-111111111111';
const westAlertId = '22222222-2222-4222-8222-222222222222';

const deviceIds = {
  [EAST_CAMERA]: eastDeviceId,
  [WEST_CAMERA]: westDeviceId,
};

const alertIds = {
  [EAST_CAMERA]: eastAlertId,
  [WEST_CAMERA]: westAlertId,
};

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
    if (method === 'POST' && target.pathname.endsWith('/devices')) {
      const body = JSON.parse(init.body);
      assert.equal(body.shedCode, DEVICE_SHED);
      assert.equal(body.type, 'camera');
      assert.equal(init.headers.authorization, 'Bearer tok');
      const spec = DEVICE_SPECS.find((row) => row.code === body.code);
      assert.ok(spec);
      assert.equal(body.name, spec.name);
      assert.equal(body.note, spec.note);
      const existing = state.devices.find((item) => item.code === body.code);
      if (existing) {
        state.reusedDevices.push(body);
        return jsonResponse(409, { message: '设备编码已存在' });
      }
      const created = {
        id: deviceIds[body.code],
        ...body,
        onlineStatus: 'offline',
      };
      state.devices.push(created);
      state.createdDevices.push(body);
      return jsonResponse(201, created);
    }
    if (method === 'GET' && target.pathname.endsWith('/devices')) {
      return jsonResponse(200, { items: state.devices, total: state.devices.length });
    }
    if (method === 'POST' && target.pathname.endsWith('/alerts')) {
      const body = JSON.parse(init.body);
      assert.equal(body.shedCode, DEVICE_SHED);
      assert.equal(body.level, DEVICE_LEVEL);
      assert.equal(body.message, alertMessage(body.cameraCode));
      assert.equal(init.headers.authorization, 'Bearer tok');
      const existing = state.alerts.find(
        (item) =>
          item.cameraCode === body.cameraCode &&
          item.title === body.title &&
          item.shedCode === body.shedCode &&
          item.status === 'open',
      );
      if (existing) {
        state.reusedAlerts.push(body);
        return jsonResponse(201, existing);
      }
      const created = {
        id: alertIds[body.cameraCode],
        shedCode: body.shedCode,
        cameraCode: body.cameraCode,
        sensorCode: null,
        level: body.level,
        status: 'open',
        title: body.title,
        message: body.message,
      };
      state.alerts.push(created);
      state.createdAlerts.push(body);
      return jsonResponse(201, created);
    }
    if (method === 'GET' && target.pathname.endsWith('/alerts')) {
      const deviceId = target.searchParams.get('deviceId');
      const cameraCode = target.searchParams.get('cameraCode');
      const status = target.searchParams.get('status');
      const q = target.searchParams.get('q') || '';
      const device = state.devices.find((item) => item.id === deviceId);
      let items = state.alerts.filter((row) => {
        if (q && !String(row.title).includes(q)) return false;
        if (status && row.status !== status) return false;
        if (cameraCode && row.cameraCode !== cameraCode) return false;
        if (device && row.cameraCode !== device.code && row.sensorCode !== device.code) return false;
        if (deviceId && !device) return false;
        return true;
      });
      if (target.searchParams.get('shedCode')) {
        const shed = target.searchParams.get('shedCode');
        items = items.filter((row) => row.shedCode === shed);
      }
      return jsonResponse(200, { items, total: items.length });
    }
    return jsonResponse(404, { message: '未模拟' });
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

test('device rows keep only that device, and the unfiltered list keeps both', () => {
  assertDeviceRows(
    [
      { id: eastAlertId, cameraCode: EAST_CAMERA, sensorCode: null, title: EAST_TITLE },
    ],
    { code: EAST_CAMERA, requiredId: eastAlertId, forbiddenIds: [westAlertId] },
  );
  assert.throws(
    () =>
      assertDeviceRows(
        [
          { id: eastAlertId, cameraCode: EAST_CAMERA },
          { id: westAlertId, cameraCode: WEST_CAMERA },
        ],
        { code: EAST_CAMERA, requiredId: eastAlertId, forbiddenIds: [westAlertId] },
      ),
    /另一台设备/,
  );
  assertBothPresent(
    [
      { id: eastAlertId },
      { id: westAlertId },
    ],
    [eastAlertId, westAlertId],
  );
  assert.equal(
    pickReusable(
      [{ id: eastAlertId, cameraCode: EAST_CAMERA, shedCode: DEVICE_SHED, title: EAST_TITLE, status: 'acked' }],
      DEVICE_SPECS[0],
    ),
    null,
  );
  assert.equal(deviceBody(DEVICE_SPECS[0]).code, EAST_CAMERA);
});

test('printed urls compare all, device A, and device B without a status filter', () => {
  const proof = formatDeviceProof({
    devices: [
      { code: EAST_CAMERA, id: eastDeviceId, created: true },
      { code: WEST_CAMERA, id: westDeviceId, created: false },
    ],
    alerts: [
      { title: EAST_TITLE, id: eastAlertId, created: true },
      { title: WEST_TITLE, id: westAlertId, created: true },
    ],
    eastCount: 1,
    westCount: 1,
    allCount: 2,
    webOrigin: 'http://127.0.0.1:43123',
  });
  const all = listUrl('', 'http://127.0.0.1:43123');
  const east = listUrl(eastDeviceId, 'http://127.0.0.1:43123');
  const west = listUrl(westDeviceId, 'http://127.0.0.1:43123');
  assert.match(proof, /留下 2 台设备/);
  assert.match(proof, /留下 2 条告警/);
  assert.match(proof, /设备A条数: 1/);
  assert.match(proof, /设备B条数: 1/);
  assert.match(proof, /全部条数: 2/);
  assert.match(proof, /状态下拉: 全部/);
  assert.match(proof, new RegExp(`全部列表: ${all.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(proof, new RegExp(`设备A列表: ${east.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(proof, new RegExp(`设备B列表: ${west.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.equal(all.includes('deviceId='), false);
  assert.equal(all.includes('status='), false);
  assert.match(east, new RegExp(`deviceId=${eastDeviceId}`));
  assert.match(west, new RegExp(`deviceId=${westDeviceId}`));
  assert.match(all, new RegExp(`q=${encodeURIComponent(TITLE_QUERY)}`));
  assert.notEqual(east, west);
});

test('the command seeds two devices and the filtered lists differ', async () => {
  const state = {
    devices: [],
    alerts: [
      {
        id: 'other-alert',
        shedCode: DEVICE_SHED,
        cameraCode: 'CAM-ALERT-01',
        sensorCode: null,
        level: 'severe',
        status: 'open',
        title: '温度过高告警',
        message: '保持不动',
      },
    ],
    createdDevices: [],
    reusedDevices: [],
    createdAlerts: [],
    reusedAlerts: [],
  };
  const installed = installFetch(state);
  try {
    const result = await sendDeviceFilterDemo();
    assert.deepEqual(
      result.devices.map((item) => item.code),
      [EAST_CAMERA, WEST_CAMERA],
    );
    assert.equal(result.devices.every((item) => item.created), true);
    assert.equal(result.alerts.every((item) => item.created), true);
    assert.equal(result.eastCount, 1);
    assert.equal(result.westCount, 1);
    assert.equal(result.allCount, 2);
    assert.equal(result.eastCount < result.allCount, true);
    assert.equal(result.westCount < result.allCount, true);
    assert.equal(state.alerts.find((item) => item.id === 'other-alert').title, '温度过高告警');
    assert.equal(installed.calls.some((line) => line.includes('/ack') || line.includes('/close')), false);
    assert.equal(installed.calls.some((line) => line.includes('/ingest/')), false);
    assert.match(formatDeviceProof(result), /设备A列表:/);
    assert.match(alertMessage(EAST_CAMERA), /CAM-DEVF-01/);
  } finally {
    installed.restore();
  }
});

test('an existing device and open alert are kept', async () => {
  const state = {
    devices: DEVICE_SPECS.map((spec) => ({
      id: deviceIds[spec.code],
      code: spec.code,
      name: '原名称',
      note: '原备注',
      type: 'camera',
      shedCode: DEVICE_SHED,
    })),
    alerts: DEVICE_SPECS.map((spec) => ({
      id: alertIds[spec.code],
      shedCode: DEVICE_SHED,
      cameraCode: spec.code,
      sensorCode: null,
      level: DEVICE_LEVEL,
      status: 'open',
      title: spec.title,
      message: alertMessage(spec.code),
    })),
    createdDevices: [],
    reusedDevices: [],
    createdAlerts: [],
    reusedAlerts: [],
  };
  const installed = installFetch(state);
  try {
    const result = await sendDeviceFilterDemo();
    assert.equal(result.devices.every((item) => item.created), false);
    assert.equal(result.alerts.every((item) => item.created), false);
    assert.equal(state.createdDevices.length, 0);
    assert.equal(state.createdAlerts.length, 0);
    assert.equal(state.devices.find((item) => item.code === EAST_CAMERA).name, '原名称');
    assert.equal(state.devices.find((item) => item.code === WEST_CAMERA).note, '原备注');
    assert.equal(result.eastCount, 1);
    assert.equal(result.westCount, 1);
    assert.equal(result.allCount, 2);
  } finally {
    installed.restore();
  }
});

test('the written steps name both device lists and leave the other demos alone', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_ALERT_BY_DEVICE.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  const statusScript = readFileSync(join(root, 'scripts/demo-alert-status-filter.mjs'), 'utf8');
  const timeScript = readFileSync(join(root, 'scripts/demo-alert-time-range.mjs'), 'utf8');
  const ackScript = readFileSync(join(root, 'scripts/demo-alert-ack.mjs'), 'utf8');
  const cameraScript = readFileSync(join(root, 'scripts/demo-alert-camera-filter.mjs'), 'utf8');
  const dutyScript = readFileSync(join(root, 'scripts/demo-duty-board.mjs'), 'utf8');
  const deviceScript = readFileSync(join(root, 'scripts/demo-device-online-filter.mjs'), 'utf8');
  assert.match(doc, /make demo-alert-by-device/);
  assert.match(doc, /admin/);
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /deviceId/);
  assert.match(doc, /cameraCode/);
  assert.match(doc, /CAM-DEVF-01/);
  assert.match(doc, /CAM-DEVF-02/);
  assert.match(doc, /东侧设备告警/);
  assert.match(doc, /西侧设备告警/);
  assert.match(doc, /全部列表/);
  assert.match(doc, /设备A列表/);
  assert.match(doc, /设备B列表/);
  assert.match(doc, /截图/);
  assert.match(doc, /全部/);
  assert.match(caps, /make demo-alert-by-device/);
  assert.match(caps, /DEMO_ALERT_BY_DEVICE\.md/);
  assert.match(status, /make demo-alert-by-device/);
  assert.match(readme, /DEMO_ALERT_BY_DEVICE\.md/);
  assert.doesNotMatch(statusScript, /CAM-DEVF-|demo-alert-by-device/);
  assert.doesNotMatch(timeScript, /CAM-DEVF-|demo-alert-by-device/);
  assert.doesNotMatch(ackScript, /CAM-DEVF-|demo-alert-by-device/);
  assert.doesNotMatch(cameraScript, /CAM-DEVF-|demo-alert-by-device/);
  assert.doesNotMatch(dutyScript, /CAM-DEVF-|demo-alert-by-device/);
  assert.doesNotMatch(deviceScript, /CAM-DEVF-|demo-alert-by-device/);
  assert.match(
    makefile,
    /^demo-alert-time-range:.*\n\tnode scripts\/demo-alert-time-range\.mjs\s*$/m,
  );
  assert.match(
    makefile,
    /^demo-alert-by-device:.*\n\tnode scripts\/demo-alert-by-device\.mjs\s*$/m,
  );
  assert.match(makefile, /scripts\/demo-alert-by-device\.spec\.mjs/);
  const added = readme.split('\n').filter((line) => line.includes('DEMO_ALERT_BY_DEVICE.md'));
  assert.equal(added.length, 1);
});
