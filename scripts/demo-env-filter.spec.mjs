import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { repoRoot } from './lib/ingest-wire.mjs';
import {
  DEMO_SENSOR,
  DEMO_SHED,
  NOW_TEMP,
  OLDER_TEMP,
  OUTSIDE_TEMP,
  assertWindow,
  buildDemoPayloads,
  environmentFilterUrl,
  formatDemoProof,
  placeReading,
  sendEnvFilterDemo,
  validateDemoPayloads,
} from './demo-env-filter.mjs';

const now = new Date('2026-10-14T08:00:00.000Z');

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
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

test('checked-in sample keeps three temperatures and the make target stays beside history', () => {
  const root = repoRoot();
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  assert.match(makefile, /^demo-env-filter:.*\n\tnode scripts\/demo-env-filter\.mjs\s*$/m);
  assert.match(makefile, /^demo-telemetry-history:.*\n\tnode scripts\/demo-telemetry-history\.mjs\s*$/m);
  assert.match(makefile, /^demo-telemetry-latest:/m);
  assert.match(makefile, /^demo-telemetry-threshold-alert:/m);
  assert.match(makefile, /^demo-alert-time-range:/m);
  assert.match(makefile, /^demo-harvest-filter:/m);
  assert.match(makefile, /^demo-alert-rules:/m);
  const payloads = validateDemoPayloads(buildDemoPayloads(now), now);
  assert.equal(payloads.latest.sensorCode, DEMO_SENSOR);
  assert.equal(payloads.latest.shedCode, DEMO_SHED);
  assert.equal(payloads.outside.temperature, OUTSIDE_TEMP);
  assert.equal(payloads.older.temperature, OLDER_TEMP);
  assert.equal(payloads.latest.temperature, NOW_TEMP);
  assert.equal(payloads.outside.idempotencyKey, 'demo-env-filter-outside');
  assert.equal(payloads.older.idempotencyKey, 'demo-env-filter-older');
  assert.equal(payloads.latest.idempotencyKey, 'demo-env-filter-now');
  assert.equal(payloads.latest.observedAt, now.toISOString());
  assert.doesNotMatch(JSON.stringify(payloads), /SENSOR-HIST/);
  const proof = formatDemoProof({
    seeded: [
      { id: 'out', created: true, temperature: OUTSIDE_TEMP, observedAt: payloads.outside.observedAt },
      { id: 'old', created: false, temperature: OLDER_TEMP, observedAt: payloads.older.observedAt },
      { id: 'now', created: false, temperature: NOW_TEMP, observedAt: payloads.latest.observedAt },
    ],
    clock: payloads.clock,
    wideCount: 3,
    narrowCount: 2,
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /留下 3 条环境读数/);
  assert.match(proof, /传感器: SENSOR-ENVF-01/);
  assert.match(proof, /窗外: 新建/);
  assert.match(proof, /15\.2℃/);
  assert.match(proof, /19\.7℃/);
  assert.match(proof, /26\.4℃/);
  assert.match(proof, /宽窗口条数: 3/);
  assert.match(proof, /窄窗口条数: 2/);
  assert.match(proof, /登录: admin \/ Admin@123456/);
  const wide = environmentFilterUrl(
    { sensorCode: DEMO_SENSOR, from: payloads.clock.wideFrom, to: payloads.clock.to },
    'http://127.0.0.1:43123',
  );
  const narrow = environmentFilterUrl(
    { sensorCode: DEMO_SENSOR, from: payloads.clock.narrowFrom, to: payloads.clock.to },
    'http://127.0.0.1:43123',
  );
  assert.ok(proof.includes(`宽窗口列表: ${wide}`), proof);
  assert.ok(proof.includes(`窄窗口列表: ${narrow}`), proof);
  assert.match(wide, /sensorCode=SENSOR-ENVF-01/);
  assert.match(narrow, /from=/);
  assert.notEqual(wide, narrow);
});

test('an outside row that falls inside the narrow window fails before any request', () => {
  const payloads = buildDemoPayloads(now);
  payloads.outside.observedAt = payloads.latest.observedAt;
  assert.throws(() => validateDemoPayloads(payloads, now), /窄窗口/);
});

test('placeReading updates an existing idempotency key and posts only when missing', async () => {
  const payloads = validateDemoPayloads(buildDemoPayloads(now), now);
  const updates = [];
  const posts = [];
  const reused = await placeReading(payloads.latest, {
    query: async (sql, params) => {
      if (sql.startsWith('SELECT')) return { rows: [{ id: 'env-kept' }] };
      updates.push({ sql, params });
      return { rows: [] };
    },
    post: async () => {
      throw new Error('已有行不应再 POST');
    },
  });
  assert.equal(reused.id, 'env-kept');
  assert.equal(reused.created, false);
  assert.equal(updates.length, 1);
  assert.match(updates[0].sql, /UPDATE environment_readings/);
  assert.equal(updates[0].params[0], 'demo-env-filter-now');
  assert.equal(updates[0].params[1], payloads.latest.observedAt);
  assert.equal(updates[0].params[2], NOW_TEMP);

  const created = await placeReading(payloads.outside, {
    query: async (sql) => {
      if (sql.startsWith('SELECT')) return { rows: [] };
      throw new Error('没有旧行时不应 UPDATE');
    },
    post: async (body) => {
      posts.push(body);
      return { id: 'env-new' };
    },
  });
  assert.equal(created.created, true);
  assert.equal(created.id, 'env-new');
  assert.equal(posts[0].sensorCode, DEMO_SENSOR);
  assert.equal(posts[0].temperature, OUTSIDE_TEMP);
});

test('http send reuses rows, checks both windows, and rejects a reversed range', async () => {
  const original = globalThis.fetch;
  const payloads = validateDemoPayloads(buildDemoPayloads(now), now);
  const calls = [];
  const placed = [];
  globalThis.fetch = async (url, init) => {
    const target = new URL(String(url));
    calls.push(`${init?.method || 'GET'} ${target.pathname}${target.search}`);
    if (target.pathname.endsWith('/auth/login')) {
      assert.deepEqual(JSON.parse(init.body), { username: 'admin', password: 'Admin@123456' });
      return jsonResponse(200, { accessToken: 'tok' });
    }
    if (target.pathname.endsWith('/environment-readings')) {
      assert.equal(init.headers.authorization, 'Bearer tok');
      assert.equal(target.searchParams.get('sensorCode'), DEMO_SENSOR);
      const from = target.searchParams.get('from');
      const to = target.searchParams.get('to');
      if (from === '2026-10-14T05:00:00.000Z' && to === '2026-10-14T01:00:00.000Z') {
        return jsonResponse(400, { message: '时间筛选无效', statusCode: 400 });
      }
      if (from === '2000-01-01T00:00:00.000Z') {
        return jsonResponse(200, { items: [], total: 0 });
      }
      if (from === payloads.clock.wideFrom.toISOString()) {
        return jsonResponse(200, {
          items: [
            rowFrom(payloads.latest, 'env-now'),
            rowFrom(payloads.older, 'env-old'),
            rowFrom(payloads.outside, 'env-out'),
          ],
          total: 3,
        });
      }
      if (from === payloads.clock.narrowFrom.toISOString()) {
        return jsonResponse(200, {
          items: [rowFrom(payloads.latest, 'env-now'), rowFrom(payloads.older, 'env-old')],
          total: 2,
        });
      }
      return jsonResponse(500, { message: `未模拟的窗口 ${from}` });
    }
    return jsonResponse(404, {});
  };
  try {
    const sent = await sendEnvFilterDemo({
      now,
      place: async (body) => {
        placed.push(body.idempotencyKey);
        return { id: `id-${body.temperature}`, created: false };
      },
      forgetExtras: async (sensorCode, keys) => {
        assert.equal(sensorCode, DEMO_SENSOR);
        assert.deepEqual(keys, ['demo-env-filter-outside', 'demo-env-filter-older', 'demo-env-filter-now']);
      },
    });
    assert.deepEqual(placed, ['demo-env-filter-outside', 'demo-env-filter-older', 'demo-env-filter-now']);
    assert.equal(sent.wideCount, 3);
    assert.equal(sent.narrowCount, 2);
    assert.equal(sent.seeded.every((row) => row.created), false);
    assert.equal(calls.filter((call) => call.startsWith('GET') && call.includes('/environment-readings')).length, 4);
  } finally {
    globalThis.fetch = original;
  }
});

test('window assertions reject a narrow list that still has the outside temperature', () => {
  const payloads = validateDemoPayloads(buildDemoPayloads(now), now);
  assert.throws(
    () =>
      assertWindow(
        [
          rowFrom(payloads.latest, 'env-now'),
          rowFrom(payloads.older, 'env-old'),
          rowFrom(payloads.outside, 'env-out'),
        ],
        {
          from: payloads.clock.narrowFrom,
          to: payloads.clock.to,
          sensorCode: DEMO_SENSOR,
          requiredTemps: [OLDER_TEMP, NOW_TEMP],
          forbiddenTemps: [OUTSIDE_TEMP],
        },
      ),
    /15\.2/,
  );
});

test('the written steps name both list views and leave the other demos alone', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_ENV_FILTER.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  const historyDoc = readFileSync(join(root, 'docs/DEMO_TELEMETRY_HISTORY.md'), 'utf8');
  const historyScript = readFileSync(join(root, 'scripts/demo-telemetry-history.mjs'), 'utf8');
  const latestScript = readFileSync(join(root, 'scripts/demo-telemetry-latest.mjs'), 'utf8');
  const thresholdScript = readFileSync(join(root, 'scripts/demo-telemetry-threshold-alert.mjs'), 'utf8');
  const alertTime = readFileSync(join(root, 'scripts/demo-alert-time-range.mjs'), 'utf8');
  const harvest = readFileSync(join(root, 'scripts/demo-harvest-filter.mjs'), 'utf8');
  const rules = readFileSync(join(root, 'scripts/demo-alert-rules.mjs'), 'utf8');
  assert.match(doc, /make demo-env-filter/);
  assert.match(doc, /admin/);
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /SENSOR-ENVF-01/);
  assert.match(doc, /15\.2/);
  assert.match(doc, /19\.7/);
  assert.match(doc, /26\.4/);
  assert.match(doc, /开始时间/);
  assert.match(doc, /结束时间/);
  assert.match(doc, /共 3 条/);
  assert.match(doc, /共 2 条/);
  assert.match(doc, /时间筛选无效/);
  assert.match(doc, /没有符合条件的环境读数/);
  assert.match(doc, /暂无环境读数/);
  assert.match(doc, /宽窗口列表/);
  assert.match(doc, /窄窗口列表/);
  assert.match(doc, /截图/);
  assert.match(doc, /make demo-telemetry-history/);
  assert.match(doc, /make demo-telemetry-latest/);
  assert.match(doc, /make demo-telemetry-threshold-alert/);
  assert.match(doc, /make demo-alert-time-range/);
  assert.match(doc, /make demo-harvest-filter/);
  assert.match(doc, /make demo-alert-rules/);
  assert.match(caps, /make demo-env-filter/);
  assert.match(caps, /DEMO_ENV_FILTER\.md/);
  assert.match(readme, /DEMO_ENV_FILTER\.md/);
  assert.match(status, /make demo-env-filter/);
  assert.doesNotMatch(historyDoc, /SENSOR-ENVF/);
  assert.doesNotMatch(historyScript, /SENSOR-ENVF/);
  assert.doesNotMatch(latestScript, /SENSOR-ENVF|demo-env-filter/);
  assert.doesNotMatch(thresholdScript, /SENSOR-ENVF|demo-env-filter/);
  assert.doesNotMatch(alertTime, /SENSOR-ENVF|demo-env-filter/);
  assert.doesNotMatch(harvest, /SENSOR-ENVF|demo-env-filter/);
  assert.doesNotMatch(rules, /SENSOR-ENVF|demo-env-filter/);
});
