import assert from 'node:assert/strict';
import test from 'node:test';
import { readFixture } from './lib/ingest-wire.mjs';
import {
  DEMO_FIXTURE,
  DEMO_SENSOR,
  DEMO_SHED,
  SLOTS,
  assertSeries,
  buildShedEnvSamples,
  formatShedEnvProof,
  shedEnv24hUrl,
  syncSensorHourBuckets,
  validateShedEnvSamples,
} from './demo-shed-env-24h.mjs';

const clocks = [
  new Date('2026-10-15T02:00:00.000Z'),
  new Date('2026-10-15T16:30:00.000Z'),
  new Date('2026-03-01T02:00:00.000Z'),
  new Date('2026-11-01T15:59:00.000Z'),
];

test('SENSOR-ENV24-01 rises across four hours and the history fixture stays put', () => {
  const before = readFixture(DEMO_FIXTURE);
  assert.equal(before.body.sensorCode, 'SENSOR-HIST-01');
  assert.equal(before.body.temperature, 23.1);
  assert.equal(DEMO_SENSOR, 'SENSOR-ENV24-01');
  assert.equal(DEMO_SHED, 'S01');
  assert.notEqual(DEMO_SENSOR, 'SENSOR-HIST-01');
  assert.notEqual(DEMO_SENSOR, 'SENSOR-ENVF-01');
  for (const now of clocks) {
    const samples = validateShedEnvSamples(buildShedEnvSamples(now), now);
    const again = buildShedEnvSamples(now);
    assert.deepEqual(
      again.map((sample) => sample.body.idempotencyKey),
      samples.map((sample) => sample.key),
    );
    assert.deepEqual(
      samples.map((sample) => sample.temperature),
      [22, 24, 25, 26],
    );
    assert.deepEqual(
      samples.map((sample) => sample.humidity),
      [78, 84, 88, 92],
    );
    assert.equal(new Set(samples.map((sample) => sample.hourStart.toISOString())).size, 4);
    for (const sample of samples) {
      assert.equal(sample.body.sensorCode, DEMO_SENSOR);
      assert.equal(sample.body.shedCode, DEMO_SHED);
      assert.equal(sample.body.idempotencyKey.startsWith('demo-shed-env-24h-'), true);
    }
  }
  const after = readFixture(DEMO_FIXTURE);
  assert.deepEqual(after, before);
  assert.equal(SLOTS[0].temperature, 22);
  assert.equal(SLOTS[SLOTS.length - 1].temperature, 26);
});

test('proof names the curve page and a 22 to 26 rise', () => {
  const now = clocks[0];
  const samples = validateShedEnvSamples(buildShedEnvSamples(now), now);
  const series = assertSeries({
    sheds: [
      {
        shedCode: DEMO_SHED,
        points: samples.map((sample) => ({
          hour: sample.hourStart.toISOString(),
          temperature: sample.temperature,
          humidity: sample.humidity,
          co2: sample.co2,
          substrateMoisture: sample.substrateMoisture,
        })),
      },
    ],
  });
  const proof = formatShedEnvProof({
    seeded: samples.map((sample) => ({ idempotencyKey: sample.key, created: true })),
    samples,
    series,
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /传感器: SENSOR-ENV24-01/);
  assert.match(proof, /温度: 22 → 24 → 25 → 26（升）/);
  assert.match(proof, /湿度: 78 → 84 → 88 → 92（升）/);
  assert.equal(
    shedEnv24hUrl('http://127.0.0.1:43123'),
    'http://127.0.0.1:43123/shed-env-24h?shedCode=S01&sensorCode=SENSOR-ENV24-01',
  );
  assert.match(proof, /\/shed-env-24h\?shedCode=S01&sensorCode=SENSOR-ENV24-01/);
  assert.doesNotMatch(proof, /\/environment\?/);
});

test('hour bucket rewrite only touches this sensor', async () => {
  const samples = validateShedEnvSamples(buildShedEnvSamples(clocks[0]), clocks[0]);
  const calls = [];
  await syncSensorHourBuckets(samples, {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [] };
    },
  });
  assert.match(calls[0].sql, /DELETE FROM metric_buckets_hour/);
  assert.deepEqual(calls[0].params, [DEMO_SHED, DEMO_SENSOR]);
  assert.equal(calls.length, 1 + samples.length * 4);
  assert.ok(calls.slice(1).every((call) => call.sql.includes('INSERT INTO metric_buckets_hour')));
  assert.ok(calls.slice(1).every((call) => call.params[1] === DEMO_SENSOR));
  assert.ok(calls.slice(1).every((call) => !String(call.sql).includes("camera_code = ''")));
});
