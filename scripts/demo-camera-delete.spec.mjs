import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DELETE_CAMERA,
  DELETE_NAME,
  DELETE_NOTE,
  DELETE_NOTE_AFTER,
  DELETE_SHED,
  assertDeleteSource,
  assertDeletedFromList,
  assertEditedCamera,
  assertMissingDetail,
  deleteCameraCreateBody,
  deleteCameraPatchBody,
  deleteListedCamera,
  formatDeleteProof,
  showDeletedCamera,
} from './demo-camera-delete.mjs';

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
    id: 'dev-del-01',
    code: DELETE_CAMERA,
    name: DELETE_NAME,
    type: 'camera',
    shedCode: DELETE_SHED,
    note: DELETE_NOTE,
    onlineStatus: 'offline',
    enabled: true,
    lastHeartbeatAt: null,
    lastSeenAt: null,
    ...overrides,
  };
}

function editedRow(overrides = {}) {
  return deviceRow({ note: DELETE_NOTE_AFTER, ...overrides });
}

test('create and patch bodies pin CAM-DEL-01 and only change the note', () => {
  assert.deepEqual(deleteCameraCreateBody(), {
    code: 'CAM-DEL-01',
    name: '可删除镜头',
    type: 'camera',
    shedCode: 'S01',
    note: '删除前',
  });
  assert.deepEqual(deleteCameraPatchBody(), { note: '删除前已改' });
  assert.equal(Object.hasOwn(deleteCameraPatchBody(), 'onlineStatus'), false);
  assert.equal(Object.hasOwn(deleteCameraPatchBody(), 'enabled'), false);
  assert.equal(Object.hasOwn(deleteCameraCreateBody(), 'idempotencyKey'), false);
});

test('a new row must stay offline until the note patch and the delete', () => {
  assert.equal(assertDeleteSource(deviceRow(), { created: true }).code, DELETE_CAMERA);
  assert.throws(
    () => assertDeleteSource(deviceRow({ name: 'CAM-DEL-01', note: null }), { created: true }),
    /名称或备注/,
  );
  assert.throws(
    () => assertDeleteSource(deviceRow({ onlineStatus: 'online' }), { created: true }),
    /离线/,
  );
  assert.throws(
    () => assertDeleteSource(deviceRow({ enabled: false }), { created: true }),
    /启用/,
  );
  assert.throws(() => assertDeleteSource(null, { created: true }), /没有 CAM-DEL-01/);
  assert.throws(() => assertDeleteSource(deviceRow({ id: '' }), { created: true }), /没有 id/);
});

test('an existing row keeps its name and may already be stopped', () => {
  const existing = deviceRow({
    name: '东侧可删除',
    note: '旧备注',
    onlineStatus: 'online',
    enabled: false,
    lastHeartbeatAt: '2026-10-14T01:02:03.004Z',
  });
  assert.equal(assertDeleteSource(existing, { created: false }).note, '旧备注');
  assert.throws(
    () => assertDeleteSource(deviceRow({ type: 'sensor' }), { created: false }),
    /类型/,
  );
  assert.throws(
    () => assertDeleteSource(deviceRow({ shedCode: 'S02' }), { created: false }),
    /棚区/,
  );
});

test('the note patch leaves status and heartbeat, then the row is gone', () => {
  const before = deviceRow({
    name: '东侧可删除',
    note: '旧备注',
    onlineStatus: 'online',
    lastHeartbeatAt: '2026-10-14T01:02:03.004Z',
  });
  const edited = editedRow({
    name: '东侧可删除',
    onlineStatus: 'online',
    lastHeartbeatAt: '2026-10-14T01:02:03.004Z',
  });
  assert.equal(assertEditedCamera(edited, before).note, DELETE_NOTE_AFTER);
  const sameName = { name: '东侧可删除', onlineStatus: 'online', lastHeartbeatAt: '2026-10-14T01:02:03.004Z' };
  assert.throws(() => assertEditedCamera(editedRow({ ...sameName, note: '另一句' }), before), /备注/);
  assert.throws(
    () => assertEditedCamera(editedRow({ ...sameName, onlineStatus: 'offline' }), before),
    /在线状态/,
  );
  assert.throws(
    () => assertEditedCamera(editedRow({ ...sameName, lastHeartbeatAt: null }), before),
    /心跳/,
  );
  const kept = [{ id: 'keep-1', code: 'CAM-STOP-01' }];
  assert.equal(assertDeletedFromList(kept, edited, ['CAM-STOP-01']).length, 1);
  assert.throws(() => assertDeletedFromList([edited], edited, []), /仍有/);
  assert.throws(() => assertDeletedFromList([], edited, ['CAM-STOP-01']), /CAM-STOP-01/);
  assert.equal(assertMissingDetail(404, { message: '设备不存在' }).message, '设备不存在');
  assert.throws(() => assertMissingDetail(200, edited), /404/);
  assert.throws(() => assertMissingDetail(404, { message: '没有' }), /设备不存在/);
});

test('create, list, edit the note, delete, and the detail is gone', async () => {
  const original = globalThis.fetch;
  const calls = [];
  const created = deviceRow();
  const edited = editedRow();
  let lists = 0;
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push(`${init?.method || 'GET'} ${target}`);
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.endsWith('/devices') && init?.method === 'POST') {
      assert.deepEqual(JSON.parse(init.body), deleteCameraCreateBody());
      return jsonResponse(201, created);
    }
    if (target.endsWith('/devices/dev-del-01') && init?.method === 'PATCH') {
      assert.deepEqual(JSON.parse(init.body), deleteCameraPatchBody());
      return jsonResponse(200, edited);
    }
    if (target.endsWith('/devices/dev-del-01') && init?.method === 'DELETE') {
      return jsonResponse(200, edited);
    }
    if (target.endsWith('/devices?pageSize=100')) {
      lists += 1;
      if (lists === 1) return jsonResponse(200, { items: [created], total: 1 });
      if (lists === 2) return jsonResponse(200, { items: [edited], total: 1 });
      return jsonResponse(200, { items: [], total: 0 });
    }
    if (target.endsWith('/devices/dev-del-01') && (!init?.method || init.method === 'GET')) {
      return jsonResponse(404, { message: '设备不存在' });
    }
    return jsonResponse(500, { message: `未预期的请求 ${target}` });
  };
  try {
    const result = await deleteListedCamera('tok');
    assert.equal(result.created, true);
    assert.equal(result.edited.note, DELETE_NOTE_AFTER);
    assert.equal(result.edited.onlineStatus, 'offline');
    assert.equal(result.edited.lastHeartbeatAt, null);
    const proof = formatDeleteProof(result);
    assert.match(proof, /登记: 新建/);
    assert.match(proof, /列表: CAM-DEL-01/);
    assert.match(proof, /改后备注: 删除前已改/);
    assert.match(proof, /删除: CAM-DEL-01/);
    assert.match(proof, /列表: 已无这一台/);
    assert.match(proof, /详情: 不存在/);
    assert.equal(calls.some((line) => line.includes('/ingest')), false);
    assert.equal(calls.filter((line) => line.startsWith('POST')).length, 1);
    assert.equal(calls.filter((line) => line.startsWith('PATCH')).length, 1);
    assert.equal(calls.filter((line) => line.startsWith('DELETE')).length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('an existing camera is edited and deleted without touching the sibling row', async () => {
  const original = globalThis.fetch;
  const calls = [];
  const sibling = {
    id: 'dev-stop-01',
    code: 'CAM-STOP-01',
    name: '可停用镜头',
    type: 'camera',
    shedCode: 'S01',
    note: '停用前',
    onlineStatus: 'offline',
    enabled: false,
  };
  const before = deviceRow({
    name: '东侧可删除',
    note: '旧备注',
    onlineStatus: 'online',
    enabled: false,
    lastHeartbeatAt: '2026-10-14T01:02:03.004Z',
  });
  const edited = editedRow({
    name: '东侧可删除',
    onlineStatus: 'online',
    enabled: false,
    lastHeartbeatAt: '2026-10-14T01:02:03.004Z',
  });
  let lists = 0;
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push(`${init?.method || 'GET'} ${target}`);
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.endsWith('/devices') && init?.method === 'POST') {
      return jsonResponse(409, { message: '设备编码已存在' });
    }
    if (target.endsWith('/devices/dev-del-01') && init?.method === 'PATCH') {
      assert.deepEqual(JSON.parse(init.body), { note: DELETE_NOTE_AFTER });
      return jsonResponse(200, edited);
    }
    if (target.endsWith('/devices/dev-del-01') && init?.method === 'DELETE') {
      return jsonResponse(200, { id: before.id, code: DELETE_CAMERA });
    }
    if (target.endsWith('/devices?pageSize=100')) {
      lists += 1;
      if (lists === 1) return jsonResponse(200, { items: [sibling, before], total: 2 });
      if (lists === 2) return jsonResponse(200, { items: [sibling, edited], total: 2 });
      return jsonResponse(200, { items: [sibling], total: 1 });
    }
    if (target.endsWith('/devices/dev-del-01')) {
      return jsonResponse(404, { message: '设备不存在' });
    }
    return jsonResponse(500, { message: `未预期的请求 ${target}` });
  };
  try {
    const result = await deleteListedCamera('tok');
    assert.equal(result.created, false);
    assert.equal(result.before.name, '东侧可删除');
    assert.equal(result.before.lastHeartbeatAt, '2026-10-14T01:02:03.004Z');
    assert.equal(result.edited.note, DELETE_NOTE_AFTER);
    assert.equal(result.edited.onlineStatus, 'online');
    assert.equal(result.edited.enabled, false);
    const proof = formatDeleteProof({ ...result, webOrigin: 'http://127.0.0.1:43123/' });
    assert.match(proof, /登记: 已有，未改名称和心跳/);
    assert.match(proof, /在线状态: 在线/);
    assert.match(proof, /最近心跳: 2026-10-14T01:02:03.004Z/);
    assert.match(proof, /设备页: http:\/\/127\.0\.0\.1:43123\/devices/);
    assert.equal(calls.some((line) => line.includes('/ingest')), false);
    assert.equal(calls.filter((line) => line.startsWith('DELETE')).length, 1);
    assert.equal(typeof showDeletedCamera, 'function');
  } finally {
    globalThis.fetch = original;
  }
});

test('the written steps name the make target and leave the other demos alone', () => {
  const doc = readFileSync(join(root, 'docs/DEMO_CAMERA_DELETE.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  assert.match(doc, /make demo-camera-delete/);
  assert.match(doc, /admin/);
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /CAM-DEL-01/);
  assert.match(doc, /删除/);
  assert.match(doc, /404/);
  assert.match(doc, /\/devices/);
  assert.match(caps, /make demo-camera-delete/);
  assert.match(caps, /DEMO_CAMERA_DELETE\.md/);
  assert.match(status, /make demo-camera-delete/);
  assert.equal(
    readme.split('\n').filter((line) => line.includes('DEMO_CAMERA_DELETE.md')).length,
    1,
  );
  assert.match(
    makefile,
    /^demo-camera-delete:.*\n\tnode scripts\/demo-camera-delete\.mjs\s*$/m,
  );
  assert.match(makefile, /scripts\/demo-camera-delete\.spec\.mjs/);
  assert.match(makefile, /^demo-camera-stop:.*\n\tnode scripts\/demo-camera-stop\.mjs\s*$/m);
  assert.match(makefile, /^demo-camera-create:.*\n\tnode scripts\/demo-camera-create\.mjs\s*$/m);
  assert.match(makefile, /^demo-camera-edit:.*\n\tnode scripts\/demo-camera-edit\.mjs\s*$/m);
  assert.match(makefile, /^demo-camera-list:.*\n\tnode scripts\/demo-camera-list\.mjs\s*$/m);
  assert.match(makefile, /^demo-camera-detail:.*\n\tnode scripts\/demo-camera-detail\.mjs\s*$/m);
  const untouched = [
    'scripts/demo-camera-list.mjs',
    'scripts/demo-camera-detail.mjs',
    'scripts/demo-camera-create.mjs',
    'scripts/demo-camera-edit.mjs',
    'scripts/demo-camera-stop.mjs',
    'scripts/demo-register-and-ingest.mjs',
    'scripts/demo-register-and-heartbeat.mjs',
    'scripts/demo-one-alert.mjs',
    'scripts/demo-alert-status-filter.mjs',
    'scripts/demo-telemetry-latest.mjs',
    'scripts/demo-telemetry-threshold-alert.mjs',
    'scripts/demo-alert-rule-config.mjs',
    'docs/DEMO_CAMERA_LIST.md',
    'docs/DEMO_CAMERA_DETAIL.md',
    'docs/DEMO_CAMERA_CREATE.md',
    'docs/DEMO_CAMERA_EDIT.md',
    'docs/DEMO_CAMERA_STOP.md',
  ];
  for (const relative of untouched) {
    const text = readFileSync(join(root, relative), 'utf8');
    assert.doesNotMatch(text, /CAM-DEL-01|demo-camera-delete/);
  }
});
