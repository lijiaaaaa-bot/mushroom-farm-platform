import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  DEMO_CAMERA,
  DEMO_FIXTURE,
  DEMO_SHED,
  buildDemoPayload,
  formatDemoProof,
  recognitionUiUrl,
  sendDemo,
  validateDemoPayload,
} from './demo-one-http-recognition.mjs';
import { readFixture, repoRoot } from './lib/ingest-wire.mjs';

const now = new Date('2026-10-14T01:02:03.004Z');

test('checked-in sample covers section 一 and the make target posts that sample', () => {
  const makefile = readFileSync(join(repoRoot(), 'Makefile'), 'utf8');
  assert.match(makefile, /^demo-one-ingest:.*\n\tnode scripts\/demo-one-http-recognition\.mjs\s*$/m);
  const fixture = readFixture(DEMO_FIXTURE);
  assert.equal(fixture.expect, 'ok');
  assert.equal(fixture.body.cameraCode, DEMO_CAMERA);
  assert.equal(fixture.body.shedCode, DEMO_SHED);
  const body = buildDemoPayload(now);
  assert.equal(body.recognizedAt, now.toISOString());
  assert.notEqual(body.idempotencyKey, fixture.body.idempotencyKey);
  assert.match(body.idempotencyKey, /^demo-one-\d+$/);
  assert.equal(body.mushroomCount, fixture.body.mushroomCount);
  assert.deepEqual(body.capDiameters, fixture.body.capDiameters);
  assert.equal(body.snapshotBase64, fixture.body.snapshotBase64);
  const canonical = validateDemoPayload(body, now);
  assert.equal(canonical.shedCode, 'S01');
  assert.equal(canonical.cameraCode, 'CAM-DEMO-01');
  assert.equal(canonical.mushroomCount, 12);
  assert.equal(canonical.matureCount, 5);
  assert.deepEqual(canonical.capDiameters, [3.2, 4.8, 6.1]);
  assert.equal(canonical.diseaseCount, 1);
  assert.equal(canonical.diseaseLevel, 1);
  assert.equal(canonical.temperature, 22.5);
  assert.equal(canonical.humidity, 88);
  assert.equal(canonical.co2, 900);
  assert.equal(canonical.substrateMoisture, 70);
  assert.ok(canonical.snapshotBase64);
  const proof = formatDemoProof({ id: 'rec-1', duplicate: false, body, webOrigin: 'http://127.0.0.1:43123' });
  assert.match(proof, /发了 1 条识别/);
  assert.match(proof, /id: rec-1/);
  assert.match(proof, /登录: admin \/ Admin@123456/);
  assert.match(proof, new RegExp(recognitionUiUrl('CAM-DEMO-01').replace(/[?]/g, '\\?')));
  assert.match(proof, /\/big-screen/);
  assert.match(proof, /recognition_records WHERE id = 'rec-1'/);
});

test('a sample missing a section 一 field fails before any request', () => {
  const body = buildDemoPayload(now);
  delete body.capDiameters;
  assert.throws(() => validateDemoPayload(body, now), /各菌盖直径|样例未通过契约/);
  const noImage = buildDemoPayload(now);
  noImage.snapshotBase64 = 'not-a-jpeg';
  assert.throws(() => validateDemoPayload(noImage, now), /JPEG|样例未通过契约/);
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
  };
}

test('http send posts one sample and only succeeds when that id is listed', async () => {
  const original = globalThis.fetch;
  const calls = [];
  let listed = false;
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    const target = String(url);
    if (target.endsWith('/ingest/recognition')) {
      const body = JSON.parse(init.body);
      assert.equal(body.shedCode, DEMO_SHED);
      assert.equal(body.cameraCode, DEMO_CAMERA);
      assert.equal(body.recognizedAt, now.toISOString());
      assert.equal(body.mushroomCount, 12);
      assert.deepEqual(body.capDiameters, [3.2, 4.8, 6.1]);
      assert.equal(init.headers['x-ingest-token'], 'dev-ingest-token');
      return jsonResponse(200, {
        accepted: true,
        duplicate: false,
        id: '22222222-2222-2222-2222-222222222222',
      });
    }
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.includes('/ingest/recognitions?')) {
      if (!listed) return jsonResponse(200, { items: [] });
      const posted = buildDemoPayload(now);
      return jsonResponse(200, {
        items: [
          {
            id: '22222222-2222-2222-2222-222222222222',
            cameraCode: posted.cameraCode,
            recognizedAt: posted.recognizedAt,
            idempotencyKey: posted.idempotencyKey,
          },
        ],
      });
    }
    throw new Error(`unexpected ${target}`);
  };
  try {
    await assert.rejects(() => sendDemo({ channel: 'http', now }), /识别列表里没有这次的记录/);
    assert.equal(calls.filter((url) => url.endsWith('/ingest/recognition')).length, 1);
    listed = true;
    const sent = await sendDemo({ channel: 'http', now });
    assert.equal(sent.id, '22222222-2222-2222-2222-222222222222');
    assert.equal(calls.filter((url) => url.endsWith('/ingest/recognition')).length, 2);
    assert.match(formatDemoProof(sent), /id: 22222222-2222-2222-2222-222222222222/);
    assert.match(formatDemoProof(sent), /\/recognitions\?cameraCode=CAM-DEMO-01/);
  } finally {
    globalThis.fetch = original;
  }
});

test('the written steps name the make target, login, and recognitions path', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_ONE_INGEST.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  assert.match(doc, /make demo-one-ingest/);
  assert.match(doc, /admin/);
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /\/recognitions\?cameraCode=CAM-DEMO-01/);
  assert.match(doc, /recognition\.demo-one\.json/);
  assert.match(caps, /make demo-one-ingest/);
  assert.match(caps, /DEMO_ONE_INGEST\.md/);
  const added = readme.split('\n').filter((line) => line.includes('DEMO_ONE_INGEST.md'));
  assert.equal(added.length, 1);
});
