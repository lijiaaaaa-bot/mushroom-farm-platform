import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  NEW_CAMERA,
  NEW_NAME,
  NEW_NOTE,
  NEW_SHED,
  assertNewCamera,
  assertNewCameraDetail,
  createListedCamera,
  formatCreateProof,
  newCameraBody,
  showNewCamera,
} from './demo-camera-create.mjs';

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
    id: 'dev-new-01',
    code: NEW_CAMERA,
    name: NEW_NAME,
    type: 'camera',
    shedCode: NEW_SHED,
    note: NEW_NOTE,
    onlineStatus: 'offline',
    lastHeartbeatAt: null,
    lastSeenAt: null,
    ...overrides,
  };
}

test('create body pins CAM-NEW-01 on S01 and does not send ingest fields', () => {
  assert.deepEqual(newCameraBody(), {
    code: 'CAM-NEW-01',
    name: '新增镜头',
    type: 'camera',
    shedCode: 'S01',
    note: '新增可演示',
  });
  assert.equal(Object.hasOwn(newCameraBody(), 'idempotencyKey'), false);
});

test('a new row must stay offline and match the request', () => {
  assert.equal(assertNewCamera(deviceRow(), { created: true }).code, NEW_CAMERA);
  assert.throws(
    () => assertNewCamera(deviceRow({ name: 'CAM-NEW-01', note: null }), { created: true }),
    /名称或备注/,
  );
  assert.throws(
    () => assertNewCamera(deviceRow({ onlineStatus: 'online' }), { created: true }),
    /离线/,
  );
  assert.throws(() => assertNewCamera(null, { created: true }), /没有 CAM-NEW-01/);
  assert.throws(() => assertNewCamera(deviceRow({ id: '' }), { created: true }), /没有 id/);
});

test('an existing row keeps its name and may already be online', () => {
  const existing = deviceRow({
    name: 'CAM-NEW-01',
    note: null,
    onlineStatus: 'online',
    lastSeenAt: '2026-10-14T01:02:03.004Z',
  });
  assert.equal(assertNewCamera(existing, { created: false }).name, 'CAM-NEW-01');
  assert.throws(
    () => assertNewCamera(deviceRow({ type: 'sensor' }), { created: false }),
    /类型/,
  );
  assert.throws(
    () => assertNewCamera(deviceRow({ shedCode: 'S02' }), { created: false }),
    /棚区/,
  );
});

test('detail must match the listed camera', () => {
  assert.equal(assertNewCameraDetail(deviceRow(), deviceRow()).id, 'dev-new-01');
  assert.throws(
    () => assertNewCameraDetail(deviceRow({ name: '另一台' }), deviceRow()),
    /名称/,
  );
  assert.throws(
    () => assertNewCameraDetail(deviceRow({ note: null }), deviceRow()),
    /备注/,
  );
  assert.throws(
    () => assertNewCameraDetail(deviceRow({ id: 'other' }), deviceRow()),
    /id/,
  );
  assert.throws(
    () => assertNewCameraDetail(deviceRow({ lastHeartbeatAt: '2026-10-14T01:02:03.004Z' }), deviceRow()),
    /心跳/,
  );
});

test('proof names the devices page and the detail page', () => {
  const proof = formatCreateProof({
    created: true,
    device: deviceRow(),
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /登记: 新建/);
  assert.match(proof, /镜头码: CAM-NEW-01/);
  assert.match(proof, /编号: CAM-NEW-01/);
  assert.match(proof, /名称: 新增镜头/);
  assert.match(proof, /类型: 摄像头/);
  assert.match(proof, /棚区: S01/);
  assert.match(proof, /状态: 离线/);
  assert.match(proof, /备注: 新增可演示/);
  assert.match(proof, /最近心跳: —/);
  assert.match(proof, /设备页: http:\/\/127\.0\.0\.1:43123\/devices$/m);
  assert.match(proof, /镜头详情: http:\/\/127\.0\.0\.1:43123\/devices\/dev-new-01/);
  assert.doesNotMatch(proof, /CAM-ALERT-01/);
  assert.doesNotMatch(proof, /CAM-REG-02/);
  assert.doesNotMatch(proof, /ingest/);
  assert.doesNotMatch(proof, /告警/);
});

test('an existing archive is printed without rewriting the name', () => {
  const proof = formatCreateProof({
    created: false,
    device: deviceRow({
      name: 'CAM-NEW-01',
      note: null,
      onlineStatus: 'online',
      lastSeenAt: '2026-10-14T01:02:03.004Z',
    }),
    webOrigin: 'http://127.0.0.1:43123/',
  });
  assert.match(proof, /登记: 已有，未改档案/);
  assert.match(proof, /名称: CAM-NEW-01/);
  assert.match(proof, /状态: 在线/);
  assert.match(proof, /备注: —/);
  assert.match(proof, /最近心跳: 2026-10-14T01:02:03.004Z/);
  assert.match(proof, /镜头详情: http:\/\/127\.0\.0\.1:43123\/devices\/dev-new-01/);
});

test('http chain creates the camera, then reads the list and the detail', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push(`${init?.method || 'GET'} ${target}`);
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.endsWith('/devices') && init?.method === 'POST') {
      assert.deepEqual(JSON.parse(init.body), newCameraBody());
      assert.equal(init.headers.authorization, 'Bearer tok');
      return jsonResponse(201, deviceRow());
    }
    if (target.endsWith('/devices?pageSize=100')) {
      return jsonResponse(200, {
        items: [deviceRow(), { id: 'box', code: 'BOX-S02', type: 'ai_box', shedCode: 'S02' }],
        total: 2,
      });
    }
    if (target.endsWith('/devices/dev-new-01') && (!init?.method || init.method === 'GET')) {
      return jsonResponse(200, deviceRow());
    }
    return jsonResponse(500, { message: `未预期的请求 ${target}` });
  };
  try {
    const result = await showNewCamera();
    assert.equal(result.created, true);
    assert.equal(result.device.id, 'dev-new-01');
    assert.equal(result.device.code, NEW_CAMERA);
    assert.equal(result.device.name, NEW_NAME);
    assert.deepEqual(
      calls.map((line) => line.split(' ')[0] + ' ' + line.split('?')[0].split('/').slice(-1)[0]),
      ['POST login', 'POST devices', 'GET devices', 'GET dev-new-01'],
    );
    assert.equal(calls.some((line) => line.startsWith('PATCH')), false);
    assert.equal(calls.some((line) => line.includes('/ingest')), false);
    assert.equal(calls.some((line) => line.includes('/alerts')), false);
    assert.equal(calls.some((line) => line.includes('/heartbeat')), false);
  } finally {
    globalThis.fetch = original;
  }
});

test('http chain leaves an existing CAM-NEW-01 unchanged and still reads detail', async () => {
  const original = globalThis.fetch;
  const calls = [];
  const existing = deviceRow({
    name: 'CAM-NEW-01',
    note: null,
    onlineStatus: 'online',
    lastSeenAt: '2026-10-14T01:02:03.004Z',
  });
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
    if (target.endsWith('/devices/dev-new-01')) return jsonResponse(200, existing);
    return jsonResponse(500, { message: `未预期的请求 ${target}` });
  };
  try {
    const result = await createListedCamera('tok');
    assert.equal(result.created, false);
    assert.equal(result.device.name, 'CAM-NEW-01');
    assert.equal(result.device.note, null);
    assert.equal(result.device.onlineStatus, 'online');
    assert.equal(calls.some((line) => line.startsWith('PATCH')), false);
    assert.equal(calls.some((line) => line.includes('/ingest')), false);
    assert.equal(calls.filter((line) => line.startsWith('POST')).length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('the written steps name the make target and leave the other demos alone', () => {
  const doc = readFileSync(join(root, 'docs/DEMO_CAMERA_CREATE.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  assert.match(doc, /make demo-camera-create/);
  assert.match(doc, /admin/);
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /CAM-NEW-01/);
  assert.match(doc, /新增镜头/);
  assert.match(doc, /\/devices/);
  assert.match(caps, /make demo-camera-create/);
  assert.match(caps, /DEMO_CAMERA_CREATE\.md/);
  assert.match(status, /make demo-camera-create/);
  assert.equal(
    readme.split('\n').filter((line) => line.includes('DEMO_CAMERA_CREATE.md')).length,
    1,
  );
  assert.match(
    makefile,
    /^demo-camera-create:.*\n\tnode scripts\/demo-camera-create\.mjs\s*$/m,
  );
  assert.match(makefile, /scripts\/demo-camera-create\.spec\.mjs/);
  assert.match(makefile, /^demo-camera-list:.*\n\tnode scripts\/demo-camera-list\.mjs\s*$/m);
  assert.match(makefile, /^demo-camera-detail:.*\n\tnode scripts\/demo-camera-detail\.mjs\s*$/m);
  const untouched = [
    'scripts/demo-camera-list.mjs',
    'scripts/demo-camera-detail.mjs',
    'scripts/demo-register-and-ingest.mjs',
    'scripts/demo-register-and-heartbeat.mjs',
    'scripts/demo-one-alert.mjs',
    'scripts/demo-telemetry-latest.mjs',
    'scripts/demo-telemetry-threshold-alert.mjs',
    'scripts/demo-alert-rule-config.mjs',
    'docs/DEMO_CAMERA_LIST.md',
    'docs/DEMO_CAMERA_DETAIL.md',
  ];
  for (const relative of untouched) {
    const text = readFileSync(join(root, relative), 'utf8');
    assert.doesNotMatch(text, /CAM-NEW-01|demo-camera-create/);
  }
});
