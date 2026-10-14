import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildDemoPayload,
  DEMO_CAMERA,
  DEMO_FIXTURE,
  validateDemoPayload,
} from './demo-one-http-recognition.mjs';
import { readFixture, repoRoot } from './lib/ingest-wire.mjs';
import {
  REG_CAMERA,
  REG_NAME,
  REG_NOTE,
  REG_SHED,
  buildRegisteredPayload,
  formatRegisterProof,
  registerAndIngest,
} from './demo-register-and-ingest.mjs';

const now = new Date('2026-10-14T01:02:03.004Z');
const sampleId = '44444444-4444-4444-4444-444444444444';

test('registered payload keeps the sample counts and image, and leaves CAM-DEMO-01 on disk', () => {
  const fixture = readFixture(DEMO_FIXTURE);
  assert.equal(fixture.body.cameraCode, DEMO_CAMERA);
  assert.equal(DEMO_CAMERA, 'CAM-DEMO-01');
  const body = buildRegisteredPayload(now);
  assert.equal(body.cameraCode, REG_CAMERA);
  assert.equal(body.shedCode, REG_SHED);
  assert.equal(body.recognizedAt, now.toISOString());
  assert.match(body.idempotencyKey, /^demo-reg-02-\d+$/);
  assert.equal(body.mushroomCount, 12);
  assert.equal(body.matureCount, 5);
  assert.equal(body.diseaseCount, 1);
  assert.deepEqual(body.capDiameters, fixture.body.capDiameters);
  assert.equal(body.snapshotBase64, fixture.body.snapshotBase64);
  const canonical = validateDemoPayload(body, now);
  assert.equal(canonical.cameraCode, 'CAM-REG-02');
  assert.equal(readFixture(DEMO_FIXTURE).body.cameraCode, 'CAM-DEMO-01');
  assert.equal(buildDemoPayload(now).cameraCode, 'CAM-DEMO-01');
  assert.match(buildDemoPayload(now).idempotencyKey, /^demo-one-\d+$/);
});

test('proof names the devices page and the recognitions filter for CAM-REG-02', () => {
  const body = buildRegisteredPayload(now);
  const proof = formatRegisterProof({
    created: true,
    device: {
      code: REG_CAMERA,
      name: REG_NAME,
      shedCode: REG_SHED,
      note: REG_NOTE,
    },
    sent: {
      id: 'rec-reg',
      duplicate: false,
      body,
      snapshotObjectKey: 'snapshots/S01/2026-10-14/CAM-REG-02/010203.jpg',
      snapshotReadUrl: 'http://127.0.0.1:41821/api/v1/ingest/recognitions/rec-reg/snapshot',
    },
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /登记: 新建/);
  assert.match(proof, /设备编号: CAM-REG-02/);
  assert.match(proof, /备注: 演示登记/);
  assert.match(proof, /设备页: http:\/\/127\.0\.0\.1:43123\/devices/);
  assert.match(proof, /\/recognitions\?cameraCode=CAM-REG-02/);
  assert.match(proof, /抓拍对象键: snapshots\/S01\/2026-10-14\/CAM-REG-02\/010203\.jpg/);
  assert.doesNotMatch(proof, /cameraCode=CAM-DEMO-01/);
});

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
    async arrayBuffer() {
      return new TextEncoder().encode(JSON.stringify(body)).buffer;
    },
  };
}

function jpegResponse(bytes) {
  return {
    ok: true,
    status: 200,
    async json() {
      throw new Error('snapshot is bytes');
    },
    async text() {
      return '';
    },
    async arrayBuffer() {
      return Uint8Array.from(bytes).buffer;
    },
  };
}

function deviceRow(note = REG_NOTE) {
  return {
    id: 'dev-reg-02',
    code: REG_CAMERA,
    name: REG_NAME,
    type: 'camera',
    shedCode: REG_SHED,
    note,
    onlineStatus: 'offline',
  };
}

test('http chain registers CAM-REG-02 then posts one recognition and reads the snapshot', async () => {
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
    if (target.includes('/devices?')) {
      return jsonResponse(200, { items: [deviceRow()], total: 1 });
    }
    if (target.endsWith('/ingest/recognition')) {
      const body = JSON.parse(init.body);
      assert.equal(body.cameraCode, 'CAM-REG-02');
      assert.equal(body.shedCode, 'S01');
      assert.equal(body.recognizedAt, now.toISOString());
      assert.match(body.idempotencyKey, /^demo-reg-02-/);
      assert.equal(body.mushroomCount, 12);
      assert.equal(body.snapshotBase64, readFixture(DEMO_FIXTURE).body.snapshotBase64);
      assert.equal(init.headers['x-ingest-token'], 'dev-ingest-token');
      return jsonResponse(200, {
        accepted: true,
        duplicate: false,
        id: sampleId,
        snapshotStored: true,
      });
    }
    if (target.includes('/ingest/recognitions?')) {
      assert.match(target, /cameraCode=CAM-REG-02/);
      const posted = buildRegisteredPayload(now);
      return jsonResponse(200, {
        items: [
          {
            id: sampleId,
            cameraCode: posted.cameraCode,
            recognizedAt: posted.recognizedAt,
            idempotencyKey: posted.idempotencyKey,
            snapshotObjectKey: 'snapshots/S01/2026-10-14/CAM-REG-02/010203.jpg',
          },
        ],
      });
    }
    if (target.endsWith('/snapshot')) {
      return jpegResponse(Buffer.from(buildRegisteredPayload(now).snapshotBase64, 'base64'));
    }
    throw new Error(`unexpected ${target}`);
  };
  try {
    const result = await registerAndIngest({ now });
    assert.equal(result.created, true);
    assert.equal(result.sent.id, sampleId);
    assert.equal(result.sent.body.cameraCode, 'CAM-REG-02');
    assert.equal(calls.filter((line) => line.startsWith('POST') && line.endsWith('/devices')).length, 1);
    assert.equal(
      calls.filter((line) => line.startsWith('POST') && line.endsWith('/ingest/recognition')).length,
      1,
    );
    assert.equal(calls.filter((line) => line.includes('/devices/') && line.startsWith('PATCH')).length, 0);
    const proof = formatRegisterProof(result);
    assert.match(proof, /登记: 新建/);
    assert.match(proof, /id: 44444444-4444-4444-4444-444444444444/);
    assert.match(proof, /\/recognitions\?cameraCode=CAM-REG-02/);
  } finally {
    globalThis.fetch = original;
  }
});

test('an existing CAM-REG-02 is left as stored and still receives one sample', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push(`${init?.method || 'GET'} ${target}`);
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.endsWith('/devices') && init?.method === 'POST') {
      return jsonResponse(409, { message: '设备编码已存在', statusCode: 409 });
    }
    if (target.includes('/devices?')) {
      return jsonResponse(200, {
        items: [deviceRow('靠门，已核对')],
        total: 1,
      });
    }
    if (target.endsWith('/ingest/recognition')) {
      const body = JSON.parse(init.body);
      assert.equal(body.cameraCode, 'CAM-REG-02');
      return jsonResponse(200, {
        accepted: true,
        duplicate: false,
        id: sampleId,
        snapshotStored: true,
      });
    }
    if (target.includes('/ingest/recognitions?')) {
      const posted = buildRegisteredPayload(now);
      return jsonResponse(200, {
        items: [
          {
            id: sampleId,
            cameraCode: 'CAM-REG-02',
            recognizedAt: posted.recognizedAt,
            idempotencyKey: posted.idempotencyKey,
            snapshotObjectKey: 'snapshots/S01/2026-10-14/CAM-REG-02/010203.jpg',
          },
        ],
      });
    }
    if (target.endsWith('/snapshot')) {
      return jpegResponse(Buffer.from(buildRegisteredPayload(now).snapshotBase64, 'base64'));
    }
    throw new Error(`unexpected ${target}`);
  };
  try {
    const result = await registerAndIngest({ now });
    assert.equal(result.created, false);
    assert.equal(result.device.note, '靠门，已核对');
    assert.equal(calls.filter((line) => line.startsWith('PATCH')).length, 0);
    assert.match(formatRegisterProof(result), /登记: 已有，未改档案/);
    assert.match(formatRegisterProof(result), /备注: 靠门，已核对/);
  } finally {
    globalThis.fetch = original;
  }
});

test('register failure stops before any recognition post', async () => {
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
    await assert.rejects(() => registerAndIngest({ now }), /登记失败 403/);
    assert.equal(calls.filter((url) => url.endsWith('/ingest/recognition')).length, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test('the written steps name the form, the make target, and the filtered recognitions page', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_REGISTER_AND_INGEST.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const one = readFileSync(join(root, 'docs/DEMO_ONE_INGEST.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  assert.match(doc, /make demo-register-and-ingest/);
  assert.match(doc, /admin/);
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /\/devices/);
  assert.match(doc, /CAM-REG-02/);
  assert.match(doc, /S01/);
  assert.match(doc, /西侧过道/);
  assert.match(doc, /演示登记/);
  assert.match(doc, /\/recognitions\?cameraCode=CAM-REG-02/);
  assert.match(doc, /成熟 5/);
  assert.match(doc, /总数 12/);
  assert.match(doc, /病害 1/);
  assert.match(doc, /POST \/api\/v1\/devices/);
  assert.match(caps, /make demo-register-and-ingest/);
  assert.match(caps, /DEMO_REGISTER_AND_INGEST\.md/);
  assert.match(caps, /登记一台摄像头/);
  assert.match(caps, /CAM-REG-01/);
  assert.match(one, /make demo-one-ingest/);
  assert.match(one, /\/recognitions\?cameraCode=CAM-DEMO-01/);
  assert.doesNotMatch(one, /CAM-REG-02/);
  assert.match(makefile, /^demo-one-ingest:.*\n\tnode scripts\/demo-one-http-recognition\.mjs\s*$/m);
  assert.match(
    makefile,
    /^demo-register-and-ingest:.*\n\tnode scripts\/demo-register-and-ingest\.mjs\s*$/m,
  );
  const added = readme.split('\n').filter((line) => line.includes('DEMO_REGISTER_AND_INGEST.md'));
  assert.equal(added.length, 1);
});
