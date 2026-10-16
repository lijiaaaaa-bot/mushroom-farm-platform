import assert from 'node:assert/strict';
import test from 'node:test';
import { readFixture } from './lib/ingest-wire.mjs';
import {
  ANOMALY_POINTS,
  CLOSE_NOTE,
  CONTRAST_SENSOR,
  DEMO_FIXTURE,
  EXPECTED_CLEAN_COUNT,
  NORMAL_POINT,
  SEED_ENV_RULES,
  TODAY_POINTS,
  YDAY_POINT,
  YDAY_SENSOR,
  assertOverviewAnomaly,
  assertSeedEnvRules,
  buildEnvAnomalyPayloads,
  formatEnvAnomalyProof,
  seedRulesForCount,
  sensorRowsFromBuckets,
  validateEnvAnomalyPayloads,
} from './demo-env-anomaly-count.mjs';

const clocks = [
  new Date('2026-10-16T04:00:00.000Z'),
  new Date('2026-10-15T16:02:00.000Z'),
  new Date('2026-10-16T15:58:00.000Z'),
  new Date('2026-03-01T16:00:00.000Z'),
];

test('two anomalous sensors and one normal stay inside today', () => {
  const before = readFixture(DEMO_FIXTURE);
  assert.equal(before.body.sensorCode, 'SENSOR-HIST-01');
  assert.equal(before.body.temperature, 23.1);
  assert.equal(EXPECTED_CLEAN_COUNT, 2);
  assert.equal(CLOSE_NOTE, '异常环境点位演示后关闭');
  for (const now of clocks) {
    const built = buildEnvAnomalyPayloads(now);
    validateEnvAnomalyPayloads(built, now);
    assert.equal(built.points.length, TODAY_POINTS.length);
    assert.equal(built.points[0].sensorCode, 'SENSOR-EAC-01');
    assert.equal(built.points[0].body.temperature, 32);
    assert.equal(built.points[0].body.humidity, 55);
    assert.equal(built.points[1].sensorCode, 'SENSOR-EAC-02');
    assert.equal(built.points[1].body.substrateMoisture, 40);
    assert.equal(built.points[2].sensorCode, NORMAL_POINT.sensorCode);
    assert.notEqual(built.yesterdayPoint.sensorCode, CONTRAST_SENSOR);
    assert.equal(built.yesterdayPoint.body.temperature, YDAY_POINT.temperature);
    const todayStart = new Date(built.start).getTime();
    for (const point of built.points) {
      const at = new Date(point.body.observedAt).getTime();
      assert.ok(at >= todayStart);
      assert.ok(at < new Date(built.end).getTime());
      assert.equal(point.body.idempotencyKey, `demo-env-anomaly-count-${point.sensorCode}-${built.day}`);
    }
    const yAt = new Date(built.yesterdayPoint.body.observedAt).getTime();
    assert.ok(yAt < todayStart);
    assert.equal(
      built.yesterdayPoint.body.idempotencyKey,
      `demo-env-anomaly-count-${YDAY_SENSOR}-${built.yesterday}`,
    );
  }
  const after = readFixture(DEMO_FIXTURE);
  assert.deepEqual(after, before);
});

test('overview count matches day buckets and a clean day is 2', () => {
  const rules = [
    ...SEED_ENV_RULES.map((rule) => ({ ...rule, enabled: true, shedCode: null })),
    { name: '病害数量一般', metric: 'disease_count', threshold: 5, enabled: true, shedCode: null },
  ];
  assertSeedEnvRules(rules);
  assert.throws(() => assertSeedEnvRules(rules.map((rule) => ({ ...rule, threshold: 1 }))), /阈值/);
  const bucketRows = [];
  for (const point of TODAY_POINTS) {
    bucketRows.push(
      { shed_code: point.shedCode, camera_code: point.sensorCode, metric: 'env_temperature', value: point.temperature },
      { shed_code: point.shedCode, camera_code: point.sensorCode, metric: 'env_humidity', value: point.humidity },
      { shed_code: point.shedCode, camera_code: point.sensorCode, metric: 'env_co2', value: point.co2 },
      {
        shed_code: point.shedCode,
        camera_code: point.sensorCode,
        metric: 'env_substrate_moisture',
        value: point.substrateMoisture,
      },
    );
  }
  bucketRows.push({
    shed_code: 'S01',
    camera_code: '',
    metric: 'env_temperature',
    value: 99,
  });
  const clean = assertOverviewAnomaly({ envAnomalyPointCount: 2, todayDiseaseCount: 3 }, bucketRows, rules);
  assert.equal(clean.count, 2);
  assert.equal(clean.clean, true);
  const extra = [
    ...bucketRows,
    { shed_code: 'S03', camera_code: 'SENSOR-OTHER', metric: 'env_temperature', value: 40 },
  ];
  const mixed = assertOverviewAnomaly({ envAnomalyPointCount: 3 }, extra, rules);
  assert.equal(mixed.count, 3);
  assert.equal(mixed.clean, false);
  assert.throws(
    () => assertOverviewAnomaly({ envAnomalyPointCount: 1 }, bucketRows, rules),
    /日桶算出/,
  );
  assert.throws(
    () => assertOverviewAnomaly({ envAnomalyPointCount: 1.5 }, bucketRows, rules),
    /非负整数|契约/,
  );
  const rows = sensorRowsFromBuckets(bucketRows);
  assert.equal(rows.some((row) => row.sensorCode === ''), false);
  assert.equal(seedRulesForCount().length, SEED_ENV_RULES.length);
  const proof = formatEnvAnomalyProof({ count: 2, day: '2026-10-16', clean: true, closed: 3 });
  assert.match(proof.split('\n')[0], /^异常环境点位数 2$/);
  assert.match(proof, /SENSOR-EAC-01/);
  assert.match(proof, /SENSOR-EAC-02/);
  assert.match(proof, /不读告警表/);
  assert.equal(ANOMALY_POINTS.length, 2);
});
