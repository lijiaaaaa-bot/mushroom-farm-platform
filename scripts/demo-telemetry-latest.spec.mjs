import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  DEMO_FIXTURE,
  DEMO_SENSOR,
  DEMO_SHED,
  assertHistoryKeepsOlder,
  assertLatestReading,
  buildDemoPayloads,
  environmentDetailUrl,
  formatDemoProof,
  resolveChannel,
  sendDemo,
  validateDemoPayloads,
} from './demo-telemetry-latest.mjs';
import { readFixture, repoRoot } from './lib/ingest-wire.mjs';

const now = new Date('2026-10-14T01:02:03.004Z');

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

test('checked-in sample covers temperature humidity co2 and moisture, and make posts it', () => {
  const makefile = readFileSync(join(repoRoot(), 'Makefile'), 'utf8');
  assert.match(makefile, /^demo-telemetry-latest:.*\n\tnode scripts\/demo-telemetry-latest\.mjs\s*$/m);
  assert.match(makefile, /^demo-one-ingest:/m);
  assert.match(makefile, /^demo-alert-handle-note:/m);
  const fixture = readFixture(DEMO_FIXTURE);
  assert.equal(fixture.expect, 'ok');
  assert.equal(fixture.body.sensorCode, DEMO_SENSOR);
  assert.equal(fixture.body.shedCode, DEMO_SHED);
  assert.notEqual(fixture.body.temperature, fixture.older.temperature);
  const payloads = buildDemoPayloads(now);
  assert.equal(payloads.latest.observedAt, now.toISOString());
  assert.equal(payloads.older.observedAt, new Date(now.getTime() - 120_000).toISOString());
  assert.match(payloads.latest.idempotencyKey, /^demo-telemetry-latest-\d+$/);
  assert.notEqual(payloads.latest.idempotencyKey, fixture.body.idempotencyKey);
  assert.equal(payloads.latest.temperature, 24.6);
  assert.equal(payloads.latest.humidity, 85);
  assert.equal(payloads.latest.co2, 760);
  assert.equal(payloads.latest.substrateMoisture, 72);
  assert.equal(payloads.older.temperature, 19.2);
  const canonical = validateDemoPayloads(payloads, now);
  assert.equal(canonical.latest.sensorCode, DEMO_SENSOR);
  const proof = formatDemoProof({
    channel: 'http',
    older: payloads.older,
    latest: payloads.latest,
    id: 'env-1',
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /发了 2 条环境遥测/);
  assert.match(proof, /id: env-1/);
  assert.match(proof, /最新温度: 24\.6℃/);
  assert.match(proof, /较早温度: 19\.2℃/);
  assert.match(proof, /登录: admin \/ Admin@123456/);
  assert.match(proof, /打开: http:\/\/127\.0\.0\.1:43123\/environment$/m);
  assert.match(proof, new RegExp(environmentDetailUrl('env-1').replace(/[.]/g, '\\.')));
  assert.equal(resolveChannel(['node', 'script']), 'http');
  assert.equal(resolveChannel(['node', 'script', '--channel', 'mqtt']), 'mqtt');
  assert.throws(() => resolveChannel(['node', 'script', '--channel', 'tcp']), /http 或 mqtt/);
});

test('a sample with the same temperature on both rows fails before any request', () => {
  const payloads = buildDemoPayloads(now);
  payloads.older.temperature = payloads.latest.temperature;
  assert.throws(() => validateDemoPayloads(payloads, now), /温度相同/);
});

test('http send posts the older row then the latest row and reads that latest value back', async () => {
  const original = globalThis.fetch;
  const calls = [];
  const payloads = buildDemoPayloads(now);
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push(target);
    if (target.endsWith('/ingest/environment')) {
      const body = JSON.parse(init.body);
      assert.equal(init.headers['x-ingest-token'], 'dev-ingest-token');
      const id = body.temperature === payloads.latest.temperature ? 'env-new' : 'env-old';
      return jsonResponse(201, { accepted: true, duplicate: false, id });
    }
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.includes('/environment-readings/latest?')) {
      return jsonResponse(200, {
        items: [
          {
            id: 'env-new',
            shedCode: payloads.latest.shedCode,
            sensorCode: payloads.latest.sensorCode,
            observedAt: payloads.latest.observedAt,
            temperature: payloads.latest.temperature,
            humidity: payloads.latest.humidity,
            co2: payloads.latest.co2,
            substrateMoisture: payloads.latest.substrateMoisture,
          },
        ],
        total: 1,
      });
    }
    if (target.includes('/environment-readings?')) {
      return jsonResponse(200, {
        items: [
          {
            temperature: payloads.latest.temperature,
            observedAt: payloads.latest.observedAt,
          },
          {
            temperature: payloads.older.temperature,
            observedAt: payloads.older.observedAt,
          },
        ],
        total: 2,
      });
    }
    if (target.endsWith('/environment-readings/env-new')) {
      return jsonResponse(200, {
        id: 'env-new',
        shedCode: payloads.latest.shedCode,
        sensorCode: payloads.latest.sensorCode,
        observedAt: payloads.latest.observedAt,
        temperature: payloads.latest.temperature,
        humidity: payloads.latest.humidity,
        co2: payloads.latest.co2,
        substrateMoisture: payloads.latest.substrateMoisture,
      });
    }
    throw new Error(`unexpected ${target}`);
  };
  try {
    const sent = await sendDemo({ channel: 'http', now, timeoutMs: 0 });
    const posts = calls.filter((url) => url.endsWith('/ingest/environment'));
    assert.equal(posts.length, 2);
    assert.equal(sent.id, 'env-new');
    assert.equal(sent.latest.temperature, 24.6);
    assert.match(formatDemoProof(sent), /详情: .*\/environment\/env-new/);
  } finally {
    globalThis.fetch = original;
  }
});

test('http send fails when the latest API still shows the older temperature', async () => {
  const original = globalThis.fetch;
  const payloads = buildDemoPayloads(now);
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (target.endsWith('/ingest/environment')) {
      const body = JSON.parse(init.body);
      const id = body.temperature === payloads.latest.temperature ? 'env-new' : 'env-old';
      return jsonResponse(201, { accepted: true, duplicate: false, id });
    }
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.includes('/environment-readings/latest?')) {
      return jsonResponse(200, {
        items: [
          {
            id: 'env-old',
            shedCode: payloads.older.shedCode,
            sensorCode: payloads.older.sensorCode,
            observedAt: payloads.older.observedAt,
            temperature: payloads.older.temperature,
            humidity: payloads.older.humidity,
            co2: payloads.older.co2,
            substrateMoisture: payloads.older.substrateMoisture,
          },
        ],
        total: 1,
      });
    }
    throw new Error(`unexpected ${target}`);
  };
  try {
    await assert.rejects(() => sendDemo({ channel: 'http', now, timeoutMs: 0 }), /最新温度是 19\.2/);
  } finally {
    globalThis.fetch = original;
  }
});

test('mqtt send publishes both payloads before reading the latest value', async () => {
  const original = globalThis.fetch;
  const payloads = buildDemoPayloads(now);
  const published = [];
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.includes('/environment-readings/latest?')) {
      return jsonResponse(200, {
        items: [
          {
            id: 'env-mqtt',
            shedCode: payloads.latest.shedCode,
            sensorCode: payloads.latest.sensorCode,
            observedAt: payloads.latest.observedAt,
            temperature: payloads.latest.temperature,
            humidity: payloads.latest.humidity,
            co2: payloads.latest.co2,
            substrateMoisture: payloads.latest.substrateMoisture,
          },
        ],
        total: 1,
      });
    }
    if (target.includes('/environment-readings?')) {
      return jsonResponse(200, {
        items: [
          { temperature: payloads.latest.temperature },
          { temperature: payloads.older.temperature },
        ],
      });
    }
    if (target.endsWith('/environment-readings/env-mqtt')) {
      return jsonResponse(200, {
        id: 'env-mqtt',
        shedCode: payloads.latest.shedCode,
        sensorCode: payloads.latest.sensorCode,
        observedAt: payloads.latest.observedAt,
        temperature: payloads.latest.temperature,
        humidity: payloads.latest.humidity,
        co2: payloads.latest.co2,
        substrateMoisture: payloads.latest.substrateMoisture,
      });
    }
    throw new Error(`unexpected ${target}`);
  };
  try {
    const sent = await sendDemo({
      channel: 'mqtt',
      now,
      timeoutMs: 0,
      publish: async (topic, payload) => {
        published.push({ topic, body: JSON.parse(payload) });
      },
    });
    assert.equal(published.length, 2);
    assert.equal(published[0].topic, 'mushroom/S01/SENSOR-LATEST-01/environment');
    assert.equal(published[0].body.temperature, 19.2);
    assert.equal(published[1].body.temperature, 24.6);
    assert.equal(sent.id, 'env-mqtt');
    assert.equal(sent.topic, 'mushroom/S01/SENSOR-LATEST-01/environment');
  } finally {
    globalThis.fetch = original;
  }
});

test('latest and history assertions reject a swapped row', () => {
  const payloads = buildDemoPayloads(now);
  assert.throws(
    () => assertLatestReading({ ...payloads.older, id: 'env-old' }, payloads.latest),
    /最新温度是 19\.2/,
  );
  assert.throws(
    () => assertHistoryKeepsOlder([{ temperature: payloads.latest.temperature }], payloads.older, payloads.latest),
    /较早一条没有留在/,
  );
});

test('the written steps name the make target, login, and environment path', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_TELEMETRY_LATEST.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  assert.match(doc, /make demo-telemetry-latest/);
  assert.match(doc, /admin/);
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /\/environment/);
  assert.match(doc, /SENSOR-LATEST-01/);
  assert.match(doc, /24\.6/);
  assert.match(doc, /19\.2/);
  assert.match(doc, /environment\.demo-latest\.json/);
  assert.match(doc, /--channel mqtt/);
  assert.match(caps, /make demo-telemetry-latest/);
  assert.match(caps, /DEMO_TELEMETRY_LATEST\.md/);
  const added = readme.split('\n').filter((line) => line.includes('DEMO_TELEMETRY_LATEST.md'));
  assert.equal(added.length, 1);
});
