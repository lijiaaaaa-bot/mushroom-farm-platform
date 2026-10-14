import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  DEMO_FIXTURE,
  DEMO_OTHER,
  DEMO_SENSOR,
  DEMO_SHED,
  assertHistoryWindow,
  assertOtherSensor,
  assertOutsideKept,
  buildDemoPayloads,
  environmentHistoryUrl,
  formatDemoProof,
  resolveChannel,
  sendDemo,
  validateDemoPayloads,
} from './demo-telemetry-history.mjs';
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
    sensorCode: body.sensorCode,
    observedAt: body.observedAt,
    temperature: body.temperature,
    humidity: body.humidity,
    co2: body.co2,
    substrateMoisture: body.substrateMoisture,
  };
}

test('checked-in sample posts four readings and the make target stays beside the latest demo', () => {
  const makefile = readFileSync(join(repoRoot(), 'Makefile'), 'utf8');
  assert.match(makefile, /^demo-telemetry-history:.*\n\tnode scripts\/demo-telemetry-history\.mjs\s*$/m);
  assert.match(makefile, /^demo-telemetry-latest:.*\n\tnode scripts\/demo-telemetry-latest\.mjs\s*$/m);
  assert.match(makefile, /^demo-telemetry-threshold-alert:/m);
  const fixture = readFixture(DEMO_FIXTURE);
  assert.equal(fixture.expect, 'ok');
  assert.equal(fixture.body.sensorCode, DEMO_SENSOR);
  assert.equal(fixture.body.shedCode, DEMO_SHED);
  assert.equal(fixture.other.sensorCode, DEMO_OTHER);
  const payloads = buildDemoPayloads(now);
  assert.equal(payloads.latest.observedAt, now.toISOString());
  assert.equal(payloads.latest.temperature, 23.1);
  assert.equal(payloads.older.temperature, 18.4);
  assert.equal(payloads.outside.temperature, 16.5);
  assert.equal(payloads.other.temperature, 21);
  assert.match(payloads.latest.idempotencyKey, /^demo-telemetry-history-\d+$/);
  assert.notEqual(payloads.latest.idempotencyKey, fixture.body.idempotencyKey);
  const canonical = validateDemoPayloads(payloads, now);
  assert.equal(canonical.latest.sensorCode, DEMO_SENSOR);
  const proof = formatDemoProof({
    channel: 'http',
    ...payloads,
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /发了 4 条环境遥测/);
  assert.match(proof, /传感器: SENSOR-HIST-01/);
  assert.match(proof, /窗内温度: 18\.4℃、23\.1℃/);
  assert.match(proof, /窗外温度: 16\.5℃/);
  assert.match(proof, /另一台: SENSOR-HIST-02 21℃/);
  assert.match(proof, /登录: admin \/ Admin@123456/);
  const page = environmentHistoryUrl(
    { sensorCode: DEMO_SENSOR, from: payloads.window.from, to: payloads.window.to },
    'http://127.0.0.1:43123',
  );
  assert.ok(proof.includes(page), proof);
  assert.match(page, /\/environment\?/);
  assert.match(page, /sensorCode=SENSOR-HIST-01/);
  assert.equal(resolveChannel(['node', 'script']), 'http');
  assert.equal(resolveChannel(['node', 'script', '--channel', 'mqtt']), 'mqtt');
  assert.throws(() => resolveChannel(['node', 'script', '--channel', 'tcp']), /http 或 mqtt/);
});

test('a sample whose outside row falls inside the window fails before any request', () => {
  const payloads = buildDemoPayloads(now);
  payloads.outside.observedAt = payloads.latest.observedAt;
  assert.throws(() => validateDemoPayloads(payloads, now), /查询窗口/);
});

test('http send posts the four rows and reads the sensor window back', async () => {
  const original = globalThis.fetch;
  const calls = [];
  const payloads = validateDemoPayloads(buildDemoPayloads(now), now);
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push({ target, init });
    if (target.endsWith('/ingest/environment')) {
      const body = JSON.parse(init.body);
      assert.equal(init.headers['x-ingest-token'], 'dev-ingest-token');
      return jsonResponse(201, { accepted: true, duplicate: false, id: `env-${body.temperature}` });
    }
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.includes('SENSOR-HIST-02')) {
      return jsonResponse(200, { items: [rowFrom(payloads.other, 'env-other')], total: 1 });
    }
    if (target.includes(encodeURIComponent(payloads.outside.observedAt))) {
      return jsonResponse(200, { items: [rowFrom(payloads.outside, 'env-out')], total: 1 });
    }
    if (target.includes('SENSOR-HIST-01')) {
      return jsonResponse(200, {
        items: [rowFrom(payloads.latest, 'env-new'), rowFrom(payloads.older, 'env-old')],
        total: 2,
      });
    }
    return jsonResponse(404, {});
  };
  try {
    const sent = await sendDemo({ channel: 'http', now, timeoutMs: 5_000 });
    const posts = calls.filter((call) => call.target.endsWith('/ingest/environment'));
    assert.equal(posts.length, 4);
    assert.deepEqual(
      posts.map((call) => JSON.parse(call.init.body).temperature),
      [16.5, 21, 18.4, 23.1],
    );
    assert.equal(sent.latest.sensorCode, DEMO_SENSOR);
    assert.equal(calls.filter((call) => call.target.includes('/environment-readings?')).length, 3);
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
    if (target.includes('SENSOR-HIST-02')) {
      return jsonResponse(200, { items: [rowFrom(payloads.other, 'env-other')], total: 1 });
    }
    if (target.includes(encodeURIComponent(payloads.outside.observedAt))) {
      return jsonResponse(200, { items: [rowFrom(payloads.outside, 'env-out')], total: 1 });
    }
    return jsonResponse(200, {
      items: [rowFrom(payloads.latest, 'env-new'), rowFrom(payloads.older, 'env-old')],
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
    assert.equal(published[0].topic, 'mushroom/S01/SENSOR-HIST-01/environment');
    assert.equal(published[0].body.temperature, 16.5);
    assert.equal(published[3].topic, 'mushroom/S01/SENSOR-HIST-02/environment');
    assert.equal(published[3].body.temperature, 21);
    assert.equal(sent.topic, 'mushroom/S01/SENSOR-HIST-01/environment');
  } finally {
    globalThis.fetch = original;
  }
});

test('history assertions reject a window that drops the earlier row or keeps the outside row', () => {
  const payloads = validateDemoPayloads(buildDemoPayloads(now), now);
  assert.throws(
    () => assertHistoryWindow([rowFrom(payloads.latest, 'env-new')], payloads),
    /18\.4/,
  );
  assert.throws(
    () =>
      assertHistoryWindow(
        [rowFrom(payloads.latest, 'env-new'), rowFrom(payloads.older, 'env-old'), rowFrom(payloads.outside, 'env-out')],
        payloads,
      ),
    /窗口外/,
  );
  assert.throws(() => assertOutsideKept([], payloads.outside), /16\.5/);
  assert.throws(
    () => assertOtherSensor([rowFrom(payloads.latest, 'env-new')], payloads.other, DEMO_SENSOR),
    /SENSOR-HIST-02/,
  );
});

test('the written steps name the make target, login, and environment history path', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_TELEMETRY_HISTORY.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  assert.match(doc, /make demo-telemetry-history/);
  assert.match(doc, /41821/);
  assert.match(doc, /43123/);
  assert.match(doc, /admin/);
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /\/environment/);
  assert.match(doc, /SENSOR-HIST-01/);
  assert.match(doc, /23\.1/);
  assert.match(doc, /18\.4/);
  assert.match(doc, /environment\.demo-history\.json/);
  assert.match(doc, /--channel mqtt/);
  assert.match(caps, /make demo-telemetry-history/);
  assert.match(caps, /DEMO_TELEMETRY_HISTORY\.md/);
  assert.match(readme, /DEMO_TELEMETRY_HISTORY\.md/);
  assert.match(doc, /make demo-telemetry-latest/);
});
