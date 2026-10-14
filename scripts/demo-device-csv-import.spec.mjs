import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CSV_CAMERA,
  CSV_CONFLICT_NAME,
  CSV_CONFLICT_NOTE,
  CSV_NAME,
  CSV_NOTE,
  CSV_SHED,
  CSV_SKIP_REASON,
  assertArchiveUnchanged,
  assertImportReport,
  assertImportedCamera,
  demoCsvText,
  formatImportProof,
  importListedCamera,
  showCsvImport,
} from './demo-device-csv-import.mjs';

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
    id: 'dev-csv-01',
    code: CSV_CAMERA,
    name: CSV_NAME,
    type: 'camera',
    shedCode: CSV_SHED,
    note: CSV_NOTE,
    onlineStatus: 'offline',
    lastHeartbeatAt: null,
    lastSeenAt: null,
    enabled: true,
    ...overrides,
  };
}

function freshReport() {
  return {
    successCount: 1,
    failCount: 0,
    skippedCount: 1,
    errors: [],
    skipped: [{ row: 2, reason: CSV_SKIP_REASON }],
  };
}

function repeatReport() {
  return {
    successCount: 0,
    failCount: 0,
    skippedCount: 2,
    errors: [],
    skipped: [
      { row: 1, reason: CSV_SKIP_REASON },
      { row: 2, reason: CSV_SKIP_REASON },
    ],
  };
}

test('the generated CSV is two rows and is not a committed fixture', () => {
  const csv = demoCsvText();
  assert.match(csv, /^设备编码,棚编码,名称,类型,备注\n/);
  assert.match(csv, /CAM-CSV-01,S01,CSV导入镜头,摄像头,CSV导入可演示/);
  assert.match(csv, /CAM-CSV-01,S01,覆盖名称,摄像头,覆盖备注/);
  assert.equal(csv.trim().split('\n').length, 3);
  assert.equal(csv.includes('idempotencyKey'), false);
  assert.throws(() => readFileSync(join(root, 'packages/contracts/fixtures/devices.csv')), {
    code: 'ENOENT',
  });
});

test('a new row must match the first CSV line and must not keep the conflict line', () => {
  assert.equal(assertImportedCamera(deviceRow(), { created: true }).code, CSV_CAMERA);
  assert.throws(
    () => assertImportedCamera(deviceRow({ name: CSV_CONFLICT_NAME }), { created: true }),
    /冲突行/,
  );
  assert.throws(
    () => assertImportedCamera(deviceRow({ note: CSV_CONFLICT_NOTE }), { created: false }),
    /冲突行/,
  );
  assert.throws(
    () => assertImportedCamera(deviceRow({ name: '别的名称', note: null }), { created: true }),
    /名称或备注/,
  );
  assert.throws(
    () => assertImportedCamera(deviceRow({ onlineStatus: 'online' }), { created: true }),
    /离线/,
  );
  assert.throws(() => assertImportedCamera(null, { created: true }), /没有 CAM-CSV-01/);
  assert.throws(() => assertImportedCamera(deviceRow({ type: 'sensor' }), { created: false }), /类型/);
  assert.throws(() => assertImportedCamera(deviceRow({ shedCode: 'S02' }), { created: false }), /棚区/);
});

test('an existing archive may already be online and must stay byte-for-byte on the compared fields', () => {
  const existing = deviceRow({
    name: '原来的名称',
    note: '原来的备注',
    onlineStatus: 'online',
    lastSeenAt: '2026-10-14T01:02:03.004Z',
  });
  assert.equal(assertImportedCamera(existing, { created: false }).name, '原来的名称');
  assert.equal(assertArchiveUnchanged(existing, { ...existing }).note, '原来的备注');
  assert.throws(
    () => assertArchiveUnchanged(existing, { ...existing, name: CSV_NAME }),
    /改了已有档案/,
  );
  assert.throws(
    () => assertArchiveUnchanged(existing, { ...existing, note: CSV_NOTE }),
    /改了已有档案/,
  );
  assert.throws(
    () => assertArchiveUnchanged(existing, { ...existing, id: 'other' }),
    /id/,
  );
});

test('the report counts a new row plus one skip, or two skips when the code is already there', () => {
  assert.equal(assertImportReport(freshReport(), { created: true }).skippedCount, 1);
  assert.equal(assertImportReport(repeatReport(), { created: false }).skippedCount, 2);
  assert.throws(
    () => assertImportReport({ ...freshReport(), failCount: 1, errors: [{ row: 1, reason: '棚不存在' }] }, { created: true }),
    /失败行/,
  );
  assert.throws(
    () => assertImportReport({ ...freshReport(), successCount: 2, skippedCount: 0, skipped: [] }, { created: true }),
    /成功 1、跳过 1/,
  );
  assert.throws(
    () => assertImportReport({ ...repeatReport(), successCount: 1, skippedCount: 1 }, { created: false }),
    /成功 0、跳过 2/,
  );
});

test('proof names the devices page, the imported camera, and the skip reason', () => {
  const proof = formatImportProof({
    created: true,
    report: freshReport(),
    device: deviceRow(),
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /导入: 新建/);
  assert.match(proof, /成功: 1/);
  assert.match(proof, /失败: 0/);
  assert.match(proof, /跳过: 1/);
  assert.match(proof, /跳过明细: 第 2 行：设备编码已存在，已跳过/);
  assert.match(proof, /镜头码: CAM-CSV-01/);
  assert.match(proof, /名称: CSV导入镜头/);
  assert.match(proof, /类型: 摄像头/);
  assert.match(proof, /棚区: S01/);
  assert.match(proof, /状态: 离线/);
  assert.match(proof, /备注: CSV导入可演示/);
  assert.match(proof, /最近心跳: —/);
  assert.match(proof, /设备页: http:\/\/127\.0\.0\.1:43123\/devices$/m);
  assert.doesNotMatch(proof, /覆盖名称/);
  assert.doesNotMatch(proof, /CAM-NEW-01/);
  assert.doesNotMatch(proof, /ingest/);
});

test('an existing archive is printed as unchanged', () => {
  const proof = formatImportProof({
    created: false,
    report: repeatReport(),
    device: deviceRow({
      name: '原来的名称',
      note: null,
      onlineStatus: 'online',
      lastSeenAt: '2026-10-14T01:02:03.004Z',
    }),
    webOrigin: 'http://127.0.0.1:43123/',
  });
  assert.match(proof, /导入: 已有，未改档案/);
  assert.match(proof, /成功: 0/);
  assert.match(proof, /跳过: 2/);
  assert.match(proof, /跳过明细: 第 1 行：设备编码已存在，已跳过/);
  assert.match(proof, /名称: 原来的名称/);
  assert.match(proof, /状态: 在线/);
  assert.match(proof, /备注: —/);
  assert.match(proof, /设备页: http:\/\/127\.0\.0\.1:43123\/devices$/m);
});

test('http chain posts the generated CSV, then reads the same device list', async () => {
  const original = globalThis.fetch;
  const calls = [];
  let listed = false;
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push(`${init?.method || 'GET'} ${target}`);
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.endsWith('/devices?pageSize=100')) {
      const items = listed ? [deviceRow()] : [];
      return jsonResponse(200, { items, total: items.length });
    }
    if (target.endsWith('/devices/import') && init?.method === 'POST') {
      assert.deepEqual(JSON.parse(init.body), { csv: demoCsvText() });
      assert.equal(init.headers.authorization, 'Bearer tok');
      assert.equal(init.headers['content-type'], 'application/json');
      listed = true;
      return jsonResponse(200, freshReport());
    }
    return jsonResponse(500, { message: `未预期的请求 ${target}` });
  };
  try {
    const result = await showCsvImport();
    assert.equal(result.created, true);
    assert.equal(result.device.code, CSV_CAMERA);
    assert.equal(result.device.name, CSV_NAME);
    assert.equal(result.device.note, CSV_NOTE);
    assert.equal(result.report.skippedCount, 1);
    assert.deepEqual(
      calls.map((line) => `${line.split(' ')[0]} ${line.split('?')[0].split('/').slice(-1)[0]}`),
      ['POST login', 'GET devices', 'POST import', 'GET devices'],
    );
    assert.equal(calls.some((line) => line.startsWith('PATCH')), false);
    assert.equal(calls.some((line) => line.startsWith('DELETE')), false);
    assert.equal(calls.some((line) => line.includes('/ingest')), false);
    assert.equal(calls.some((line) => line.includes('/alerts')), false);
    assert.equal(calls.some((line) => line.includes('/heartbeat')), false);
    assert.equal(calls.filter((line) => line.startsWith('POST') && line.includes('/devices') && !line.includes('/import')).length, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test('http chain leaves an existing CAM-CSV-01 unchanged', async () => {
  const original = globalThis.fetch;
  const calls = [];
  const existing = deviceRow({
    name: '原来的名称',
    note: '原来的备注',
    onlineStatus: 'online',
    lastSeenAt: '2026-10-14T01:02:03.004Z',
  });
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push(`${init?.method || 'GET'} ${target}`);
    if (target.endsWith('/devices?pageSize=100')) {
      return jsonResponse(200, { items: [existing], total: 1 });
    }
    if (target.endsWith('/devices/import') && init?.method === 'POST') {
      return jsonResponse(200, repeatReport());
    }
    return jsonResponse(500, { message: `未预期的请求 ${target}` });
  };
  try {
    const result = await importListedCamera('tok');
    assert.equal(result.created, false);
    assert.equal(result.device.name, '原来的名称');
    assert.equal(result.device.note, '原来的备注');
    assert.equal(result.device.onlineStatus, 'online');
    assert.equal(calls.filter((line) => line.startsWith('POST')).length, 1);
    assert.equal(calls.some((line) => line.startsWith('PATCH')), false);
    assert.equal(calls.some((line) => line.includes('/ingest')), false);
  } finally {
    globalThis.fetch = original;
  }
});

test('the written steps name the make target and leave the other demos alone', () => {
  const doc = readFileSync(join(root, 'docs/DEMO_DEVICE_CSV_IMPORT.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  assert.match(doc, /make demo-device-csv-import/);
  assert.match(doc, /admin/);
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /CAM-CSV-01/);
  assert.match(doc, /CSV导入镜头/);
  assert.match(doc, /CSV导入可演示/);
  assert.match(doc, /覆盖名称/);
  assert.match(doc, /设备编码已存在，已跳过/);
  assert.match(doc, /\/devices/);
  assert.match(doc, /docs\/evidence\/demo-device-csv-import\//);
  assert.match(caps, /make demo-device-csv-import/);
  assert.match(caps, /DEMO_DEVICE_CSV_IMPORT\.md/);
  assert.match(status, /make demo-device-csv-import/);
  assert.equal(
    readme.split('\n').filter((line) => line.includes('DEMO_DEVICE_CSV_IMPORT.md')).length,
    1,
  );
  assert.match(
    makefile,
    /^demo-device-csv-import:.*\n\tnode scripts\/demo-device-csv-import\.mjs\s*$/m,
  );
  assert.match(makefile, /scripts\/demo-device-csv-import\.spec\.mjs/);
  assert.match(makefile, /^demo-camera-create:.*\n\tnode scripts\/demo-camera-create\.mjs\s*$/m);
  assert.match(makefile, /^demo-camera-edit:.*\n\tnode scripts\/demo-camera-edit\.mjs\s*$/m);
  assert.match(makefile, /^demo-camera-stop:.*\n\tnode scripts\/demo-camera-stop\.mjs\s*$/m);
  assert.match(makefile, /^demo-camera-delete:.*\n\tnode scripts\/demo-camera-delete\.mjs\s*$/m);
  const untouched = [
    'scripts/demo-camera-create.mjs',
    'scripts/demo-camera-list.mjs',
    'scripts/demo-camera-detail.mjs',
    'scripts/demo-camera-edit.mjs',
    'scripts/demo-camera-stop.mjs',
    'scripts/demo-camera-delete.mjs',
    'apps/api/src/ingest/ingest.controller.ts',
    'apps/api/src/ingest/ingest.service.ts',
    'packages/contracts/src/index.ts',
  ];
  for (const relative of untouched) {
    const text = readFileSync(join(root, relative), 'utf8');
    assert.doesNotMatch(text, /CAM-CSV-01|demo-device-csv-import/);
  }
});
