import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  DEMO_CAMERA,
  DEMO_FIXTURE,
  DEMO_OTHER,
  DEMO_SHED,
  assertHistoryWindow,
  assertOtherCamera,
  assertOutsideKept,
  buildDemoPayloads,
  formatDemoProof,
  recognitionHistoryUrl,
  resolveChannel,
  sendDemo,
  validateDemoPayloads,
} from './demo-recognition-history.mjs';
import { readFixture, repoRoot } from './lib/ingest-wire.mjs';

const now = new Date('2026-10-14T01:30:00.000Z');

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

function rowFrom(body, id) {
  return {
    id,
    shedCode: body.shedCode,
    cameraCode: body.cameraCode,
    recognizedAt: body.recognizedAt,
    mushroomCount: body.mushroomCount,
    matureCount: body.matureCount,
  };
}

test('checked-in sample posts four recognitions and the make target stays beside the telemetry history demo', () => {
  const makefile = readFileSync(join(repoRoot(), 'Makefile'), 'utf8');
  assert.match(makefile, /^demo-recognition-history:.*\n\tnode scripts\/demo-recognition-history\.mjs\s*$/m);
  assert.match(makefile, /^demo-one-ingest:.*\n\tnode scripts\/demo-one-http-recognition\.mjs\s*$/m);
  assert.match(makefile, /^demo-telemetry-history:/m);
  const fixture = readFixture(DEMO_FIXTURE);
  assert.equal(fixture.expect, 'ok');
  assert.equal(fixture.body.cameraCode, DEMO_CAMERA);
  assert.equal(fixture.body.shedCode, DEMO_SHED);
  assert.equal(fixture.other.cameraCode, DEMO_OTHER);
  const golden = readFixture('recognition.golden.json');
  const demoOne = readFixture('recognition.demo-one.json');
  assert.equal(golden.body.cameraCode, 'CAM-S01-01');
  assert.equal(demoOne.body.cameraCode, 'CAM-DEMO-01');
  const payloads = buildDemoPayloads(now);
  assert.equal(payloads.latest.recognizedAt, now.toISOString());
  assert.equal(payloads.latest.mushroomCount, 12);
  assert.equal(payloads.older.mushroomCount, 9);
  assert.equal(payloads.outside.mushroomCount, 7);
  assert.equal(payloads.other.mushroomCount, 11);
  assert.match(payloads.latest.idempotencyKey, /^demo-recognition-history-\d+$/);
  assert.notEqual(payloads.latest.idempotencyKey, fixture.body.idempotencyKey);
  const canonical = validateDemoPayloads(payloads, now);
  assert.equal(canonical.latest.cameraCode, DEMO_CAMERA);
  const proof = formatDemoProof({
    channel: 'http',
    ...payloads,
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /发了 4 条识别/);
  assert.match(proof, /摄像头: CAM-HIST-01/);
  assert.match(proof, /窗内总数: 9、12/);
  assert.match(proof, /窗外总数: 7/);
  assert.match(proof, /另一台: CAM-HIST-02 总数 11/);
  assert.match(proof, /登录: admin \/ Admin@123456/);
  const page = recognitionHistoryUrl(
    { cameraCode: DEMO_CAMERA, from: payloads.window.from, to: payloads.window.to },
    'http://127.0.0.1:43123',
  );
  assert.ok(proof.includes(page), proof);
  assert.match(page, /\/recognitions\?/);
  assert.match(page, /cameraCode=CAM-HIST-01/);
  assert.match(page, /from=/);
  assert.match(page, /to=/);
  assert.equal(resolveChannel(['node', 'script']), 'http');
  assert.equal(resolveChannel(['node', 'script', '--channel', 'mqtt']), 'mqtt');
  assert.throws(() => resolveChannel(['node', 'script', '--channel', 'tcp']), /http 或 mqtt/);
});

test('a sample whose outside row falls inside the window fails before any request', () => {
  const payloads = buildDemoPayloads(now);
  payloads.outside.recognizedAt = payloads.latest.recognizedAt;
  assert.throws(() => validateDemoPayloads(payloads, now), /查询窗口/);
});

test('http send posts the four rows and reads the camera window back', async () => {
  const original = globalThis.fetch;
  const calls = [];
  const payloads = validateDemoPayloads(buildDemoPayloads(now), now);
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push({ target, init });
    if (target.endsWith('/ingest/recognition')) {
      const body = JSON.parse(init.body);
      assert.equal(init.headers['x-ingest-token'], 'dev-ingest-token');
      return jsonResponse(201, { accepted: true, duplicate: false, id: `rec-${body.mushroomCount}` });
    }
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.includes('CAM-HIST-02')) {
      return jsonResponse(200, { items: [rowFrom(payloads.other, 'rec-other')], total: 1 });
    }
    if (target.includes(encodeURIComponent(payloads.outside.recognizedAt))) {
      return jsonResponse(200, { items: [rowFrom(payloads.outside, 'rec-out')], total: 1 });
    }
    if (target.includes('CAM-HIST-01')) {
      return jsonResponse(200, {
        items: [rowFrom(payloads.latest, 'rec-new'), rowFrom(payloads.older, 'rec-old')],
        total: 2,
      });
    }
    return jsonResponse(404, {});
  };
  try {
    const sent = await sendDemo({ channel: 'http', now, timeoutMs: 5_000 });
    const posts = calls.filter((call) => call.target.endsWith('/ingest/recognition'));
    assert.equal(posts.length, 4);
    assert.deepEqual(
      posts.map((call) => JSON.parse(call.init.body).mushroomCount),
      [7, 11, 9, 12],
    );
    assert.equal(sent.latest.cameraCode, DEMO_CAMERA);
    assert.equal(calls.filter((call) => call.target.includes('/recognitions?')).length, 3);
  } finally {
    globalThis.fetch = original;
  }
});

test('mqtt send publishes the same four bodies', async () => {
  const original = globalThis.fetch;
  const payloads = validateDemoPayloads(buildDemoPayloads(now), now);
  const published = [];
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.includes('CAM-HIST-02')) {
      return jsonResponse(200, { items: [rowFrom(payloads.other, 'rec-other')], total: 1 });
    }
    if (target.includes(encodeURIComponent(payloads.outside.recognizedAt))) {
      return jsonResponse(200, { items: [rowFrom(payloads.outside, 'rec-out')], total: 1 });
    }
    return jsonResponse(200, {
      items: [rowFrom(payloads.latest, 'rec-new'), rowFrom(payloads.older, 'rec-old')],
      total: 2,
    });
  };
  try {
    const sent = await sendDemo({
      channel: 'mqtt',
      now,
      timeoutMs: 5_000,
      publish: async (topic, payload) => {
        published.push({ topic, body: JSON.parse(payload) });
      },
    });
    assert.equal(published.length, 4);
    assert.equal(published[0].topic, 'mushroom/S01/CAM-HIST-01/recognition');
    assert.equal(published[0].body.mushroomCount, 7);
    assert.equal(published[3].topic, 'mushroom/S01/CAM-HIST-02/recognition');
    assert.equal(published[3].body.mushroomCount, 11);
    assert.equal(sent.topic, 'mushroom/S01/CAM-HIST-01/recognition');
  } finally {
    globalThis.fetch = original;
  }
});

test('history assertions reject a window that drops the earlier row or keeps the outside row', () => {
  const payloads = validateDemoPayloads(buildDemoPayloads(now), now);
  assert.throws(
    () => assertHistoryWindow([rowFrom(payloads.latest, 'rec-new')], payloads),
    /总数 9/,
  );
  assert.throws(
    () =>
      assertHistoryWindow(
        [
          rowFrom(payloads.latest, 'rec-new'),
          rowFrom(payloads.older, 'rec-old'),
          rowFrom(payloads.outside, 'rec-out'),
        ],
        payloads,
      ),
    /窗口外/,
  );
  assert.throws(() => assertOutsideKept([], payloads.outside), /总数 7/);
  assert.throws(
    () => assertOtherCamera([rowFrom(payloads.latest, 'rec-new')], payloads.other, DEMO_CAMERA),
    /CAM-HIST-02/,
  );
});

test('the written steps name the make target, login, and recognition history path', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_RECOGNITION_HISTORY.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  assert.match(doc, /make demo-recognition-history/);
  assert.match(doc, /41821/);
  assert.match(doc, /43123/);
  assert.match(doc, /admin/);
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /\/recognitions/);
  assert.match(doc, /CAM-HIST-01/);
  assert.match(doc, /总数 12/);
  assert.match(doc, /总数 9/);
  assert.match(doc, /recognition\.demo-history\.json/);
  assert.match(doc, /--channel mqtt/);
  assert.match(doc, /上海日/);
  assert.match(doc, /时间筛选无效/);
  assert.match(doc, /没有符合条件的识别记录/);
  assert.match(caps, /make demo-recognition-history/);
  assert.match(caps, /DEMO_RECOGNITION_HISTORY\.md/);
  assert.match(readme, /DEMO_RECOGNITION_HISTORY\.md/);
  assert.match(doc, /make demo-one-ingest/);
  assert.match(doc, /make demo-telemetry-history/);
});
