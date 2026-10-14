import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  EDIT_CAMERA,
  EDIT_NAME,
  EDIT_NOTE_AFTER,
  EDIT_NOTE_BEFORE,
  EDIT_SHED,
  EDIT_STATUS_AFTER,
  assertEditSource,
  assertEditedCamera,
  assertEditedDetail,
  editCameraCreateBody,
  editCameraPatchBody,
  editListedCamera,
  formatEditProof,
  showEditedCamera,
} from './demo-camera-edit.mjs';

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
    id: 'dev-edit-01',
    code: EDIT_CAMERA,
    name: EDIT_NAME,
    type: 'camera',
    shedCode: EDIT_SHED,
    note: EDIT_NOTE_BEFORE,
    onlineStatus: 'offline',
    lastHeartbeatAt: null,
    lastSeenAt: null,
    ...overrides,
  };
}

function editedRow(overrides = {}) {
  return deviceRow({
    note: EDIT_NOTE_AFTER,
    onlineStatus: EDIT_STATUS_AFTER,
    ...overrides,
  });
}

test('create and patch bodies pin CAM-EDIT-01 and do not send ingest fields', () => {
  assert.deepEqual(editCameraCreateBody(), {
    code: 'CAM-EDIT-01',
    name: '可编辑镜头',
    type: 'camera',
    shedCode: 'S01',
    note: '编辑前',
  });
  assert.deepEqual(editCameraPatchBody(), {
    note: '备注已改',
    onlineStatus: 'online',
  });
  assert.equal(Object.hasOwn(editCameraCreateBody(), 'idempotencyKey'), false);
  assert.equal(Object.hasOwn(editCameraPatchBody(), 'lastHeartbeatAt'), false);
  assert.equal(EDIT_NOTE_BEFORE, '编辑前');
  assert.equal(EDIT_NOTE_AFTER, '备注已改');
});

test('a new row must stay offline until the patch', () => {
  assert.equal(assertEditSource(deviceRow(), { created: true }).code, EDIT_CAMERA);
  assert.throws(
    () => assertEditSource(deviceRow({ name: 'CAM-EDIT-01', note: null }), { created: true }),
    /名称或备注/,
  );
  assert.throws(
    () => assertEditSource(deviceRow({ onlineStatus: 'online' }), { created: true }),
    /离线/,
  );
  assert.throws(() => assertEditSource(null, { created: true }), /没有 CAM-EDIT-01/);
  assert.throws(() => assertEditSource(deviceRow({ id: '' }), { created: true }), /没有 id/);
});

test('an existing row keeps its name and may already be online', () => {
  const existing = deviceRow({
    name: 'CAM-EDIT-01',
    note: '旧备注',
    onlineStatus: 'online',
    lastHeartbeatAt: '2026-10-14T01:02:03.004Z',
  });
  assert.equal(assertEditSource(existing, { created: false }).note, '旧备注');
  assert.throws(
    () => assertEditSource(deviceRow({ type: 'sensor' }), { created: false }),
    /类型/,
  );
  assert.throws(
    () => assertEditSource(deviceRow({ shedCode: 'S02' }), { created: false }),
    /棚区/,
  );
});

test('the list and the detail show the edited note and status', () => {
  const before = deviceRow();
  const listed = editedRow();
  assert.equal(assertEditedCamera(listed, before).note, EDIT_NOTE_AFTER);
  assert.equal(assertEditedDetail(listed, listed).onlineStatus, 'online');
  assert.throws(() => assertEditedCamera(editedRow({ note: '编辑前' }), before), /备注/);
  assert.throws(() => assertEditedCamera(editedRow({ onlineStatus: 'offline' }), before), /状态/);
  assert.throws(
    () => assertEditedCamera(editedRow({ name: '另一台' }), before),
    /名称或棚区/,
  );
  assert.throws(
    () => assertEditedCamera(editedRow({ lastHeartbeatAt: '2026-10-14T01:02:03.004Z' }), before),
    /心跳/,
  );
  assert.throws(
    () => assertEditedDetail(editedRow({ note: '另一句' }), listed),
    /备注/,
  );
  assert.throws(
    () => assertEditedDetail(editedRow({ onlineStatus: 'offline' }), listed),
    /状态/,
  );
  assert.throws(() => assertEditedDetail(editedRow({ id: 'other' }), listed), /id/);
});

test('proof names the devices page and the detail page', () => {
  const proof = formatEditProof({
    created: true,
    before: deviceRow(),
    device: editedRow(),
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /登记: 新建/);
  assert.match(proof, /编辑前状态: 离线/);
  assert.match(proof, /编辑前备注: 编辑前/);
  assert.match(proof, /编辑后状态: 在线/);
  assert.match(proof, /编辑后备注: 备注已改/);
  assert.match(proof, /镜头码: CAM-EDIT-01/);
  assert.match(proof, /编号: CAM-EDIT-01/);
  assert.match(proof, /名称: 可编辑镜头/);
  assert.match(proof, /类型: 摄像头/);
  assert.match(proof, /棚区: S01/);
  assert.match(proof, /最近心跳: —/);
  assert.match(proof, /设备页: http:\/\/127\.0\.0\.1:43123\/devices$/m);
  assert.match(proof, /镜头详情: http:\/\/127\.0\.0\.1:43123\/devices\/dev-edit-01/);
  assert.doesNotMatch(proof, /CAM-NEW-01|CAM-ALERT-01|CAM-REG-02/);
  assert.doesNotMatch(proof, /ingest/);
});

test('an existing archive keeps its heartbeat in the proof', () => {
  const before = deviceRow({
    name: '东侧可编辑',
    note: '旧备注',
    onlineStatus: 'offline',
    lastHeartbeatAt: '2026-10-14T01:02:03.004Z',
  });
  const proof = formatEditProof({
    created: false,
    before,
    device: editedRow({
      name: '东侧可编辑',
      lastHeartbeatAt: '2026-10-14T01:02:03.004Z',
    }),
    webOrigin: 'http://127.0.0.1:43123/',
  });
  assert.match(proof, /登记: 已有，未改名称和心跳/);
  assert.match(proof, /编辑前状态: 离线/);
  assert.match(proof, /编辑前备注: 旧备注/);
  assert.match(proof, /名称: 东侧可编辑/);
  assert.match(proof, /编辑后状态: 在线/);
  assert.match(proof, /最近心跳: 2026-10-14T01:02:03.004Z/);
});

test('http chain creates the camera, patches it, then reads the list and the detail', async () => {
  const original = globalThis.fetch;
  const calls = [];
  let lists = 0;
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push(`${init?.method || 'GET'} ${target}`);
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.endsWith('/devices') && init?.method === 'POST') {
      assert.deepEqual(JSON.parse(init.body), editCameraCreateBody());
      assert.equal(init.headers.authorization, 'Bearer tok');
      return jsonResponse(201, deviceRow());
    }
    if (target.endsWith('/devices/dev-edit-01') && init?.method === 'PATCH') {
      assert.deepEqual(JSON.parse(init.body), editCameraPatchBody());
      assert.equal(init.headers.authorization, 'Bearer tok');
      return jsonResponse(200, editedRow());
    }
    if (target.endsWith('/devices?pageSize=100')) {
      lists += 1;
      return jsonResponse(200, {
        items: [lists === 1 ? deviceRow() : editedRow()],
        total: 1,
      });
    }
    if (target.endsWith('/devices/dev-edit-01') && (!init?.method || init.method === 'GET')) {
      return jsonResponse(200, editedRow());
    }
    return jsonResponse(500, { message: `未预期的请求 ${target}` });
  };
  try {
    const result = await showEditedCamera();
    assert.equal(result.created, true);
    assert.equal(result.before.note, EDIT_NOTE_BEFORE);
    assert.equal(result.before.onlineStatus, 'offline');
    assert.equal(result.device.note, EDIT_NOTE_AFTER);
    assert.equal(result.device.onlineStatus, 'online');
    assert.equal(result.device.id, 'dev-edit-01');
    assert.deepEqual(
      calls.map((line) => `${line.split(' ')[0]} ${line.split('?')[0].split('/').slice(-1)[0]}`),
      ['POST login', 'POST devices', 'GET devices', 'PATCH dev-edit-01', 'GET devices', 'GET dev-edit-01'],
    );
    assert.equal(calls.some((line) => line.includes('/ingest')), false);
    assert.equal(calls.some((line) => line.includes('/alerts')), false);
    assert.equal(calls.some((line) => line.includes('/heartbeat')), false);
  } finally {
    globalThis.fetch = original;
  }
});

test('http chain patches an existing CAM-EDIT-01 without rewriting its heartbeat', async () => {
  const original = globalThis.fetch;
  const calls = [];
  let lists = 0;
  const before = deviceRow({
    name: '东侧可编辑',
    note: '旧备注',
    onlineStatus: 'offline',
    lastHeartbeatAt: '2026-10-14T01:02:03.004Z',
  });
  const after = editedRow({
    name: '东侧可编辑',
    lastHeartbeatAt: '2026-10-14T01:02:03.004Z',
  });
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push(`${init?.method || 'GET'} ${target}`);
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.endsWith('/devices') && init?.method === 'POST') {
      return jsonResponse(409, { message: '设备编码已存在' });
    }
    if (target.endsWith('/devices/dev-edit-01') && init?.method === 'PATCH') {
      assert.deepEqual(JSON.parse(init.body), editCameraPatchBody());
      return jsonResponse(200, after);
    }
    if (target.endsWith('/devices?pageSize=100')) {
      lists += 1;
      return jsonResponse(200, { items: [lists === 1 ? before : after], total: 1 });
    }
    if (target.endsWith('/devices/dev-edit-01')) return jsonResponse(200, after);
    return jsonResponse(500, { message: `未预期的请求 ${target}` });
  };
  try {
    const result = await editListedCamera('tok');
    assert.equal(result.created, false);
    assert.equal(result.before.name, '东侧可编辑');
    assert.equal(result.before.lastHeartbeatAt, '2026-10-14T01:02:03.004Z');
    assert.equal(result.device.note, EDIT_NOTE_AFTER);
    assert.equal(result.device.onlineStatus, 'online');
    assert.equal(result.device.lastHeartbeatAt, '2026-10-14T01:02:03.004Z');
    assert.equal(result.device.name, '东侧可编辑');
    assert.equal(calls.some((line) => line.includes('/ingest')), false);
    assert.equal(calls.filter((line) => line.startsWith('POST')).length, 1);
    assert.equal(calls.filter((line) => line.startsWith('PATCH')).length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('the written steps name the make target and leave the other demos alone', () => {
  const doc = readFileSync(join(root, 'docs/DEMO_CAMERA_EDIT.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  assert.match(doc, /make demo-camera-edit/);
  assert.match(doc, /admin/);
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /CAM-EDIT-01/);
  assert.match(doc, /备注已改/);
  assert.match(doc, /\/devices/);
  assert.match(caps, /make demo-camera-edit/);
  assert.match(caps, /DEMO_CAMERA_EDIT\.md/);
  assert.match(status, /make demo-camera-edit/);
  assert.equal(
    readme.split('\n').filter((line) => line.includes('DEMO_CAMERA_EDIT.md')).length,
    1,
  );
  assert.match(
    makefile,
    /^demo-camera-edit:.*\n\tnode scripts\/demo-camera-edit\.mjs\s*$/m,
  );
  assert.match(makefile, /scripts\/demo-camera-edit\.spec\.mjs/);
  assert.match(makefile, /^demo-camera-create:.*\n\tnode scripts\/demo-camera-create\.mjs\s*$/m);
  assert.match(makefile, /^demo-camera-list:.*\n\tnode scripts\/demo-camera-list\.mjs\s*$/m);
  assert.match(makefile, /^demo-camera-detail:.*\n\tnode scripts\/demo-camera-detail\.mjs\s*$/m);
  const untouched = [
    'scripts/demo-camera-list.mjs',
    'scripts/demo-camera-detail.mjs',
    'scripts/demo-camera-create.mjs',
    'scripts/demo-register-and-ingest.mjs',
    'scripts/demo-register-and-heartbeat.mjs',
    'scripts/demo-one-alert.mjs',
    'scripts/demo-telemetry-latest.mjs',
    'scripts/demo-telemetry-threshold-alert.mjs',
    'scripts/demo-alert-rule-config.mjs',
    'docs/DEMO_CAMERA_LIST.md',
    'docs/DEMO_CAMERA_DETAIL.md',
    'docs/DEMO_CAMERA_CREATE.md',
  ];
  for (const relative of untouched) {
    const text = readFileSync(join(root, relative), 'utf8');
    assert.doesNotMatch(text, /CAM-EDIT-01|demo-camera-edit/);
  }
});
