import assert from 'node:assert/strict';
import test from 'node:test';
import { readFixture } from './lib/ingest-wire.mjs';
import {
  CONTRAST_SENSOR,
  DAY_METRICS,
  DEMO_FIXTURE,
  ENV_POINTS,
  YDAY_POINT,
  YDAY_SENSOR,
  assertContrastEmpty,
  assertOverviewEnv,
  assertSensorReading,
  buildEnvMeanPayloads,
  cleanEnvMeans,
  formatEnvMeanProof,
  readingsFromBucketRows,
  syncSensorDayBucket,
  validateEnvMeanPayloads,
} from './demo-env-mean.mjs';

const clocks = [
  new Date('2026-10-16T04:00:00.000Z'),
  new Date('2026-10-15T16:02:00.000Z'),
  new Date('2026-10-16T15:58:00.000Z'),
  new Date('2026-03-01T16:00:00.000Z'),
];

test('two sheds stay inside today and yesterday stays out of the mean', () => {
  const before = readFixture(DEMO_FIXTURE);
  assert.equal(before.body.sensorCode, 'SENSOR-HIST-01');
  assert.equal(before.body.temperature, 23.1);
  const clean = cleanEnvMeans();
  assert.deepEqual(clean, {
    envMeanTemperature: 24,
    envMeanHumidity: 85,
    envMeanCo2: 800,
    envMeanSubstrateMoisture: 73,
  });
  for (const now of clocks) {
    const built = buildEnvMeanPayloads(now);
    validateEnvMeanPayloads(built, now);
    assert.equal(built.points.length, 2);
    assert.equal(built.points[0].shedCode, 'S01');
    assert.equal(built.points[1].shedCode, 'S02');
    assert.equal(built.points[0].sensorCode, 'SENSOR-EM-01');
    assert.equal(built.points[1].sensorCode, 'SENSOR-EM-02');
    assert.notEqual(built.yesterdayPoint.sensorCode, CONTRAST_SENSOR);
    assert.equal(built.yesterdayPoint.body.sensorCode, YDAY_SENSOR);
    const todayStart = new Date(built.start).getTime();
    const todayEnd = new Date(built.end).getTime();
    for (const point of built.points) {
      const at = new Date(point.body.observedAt).getTime();
      assert.ok(at >= todayStart);
      assert.ok(at < todayEnd);
      assert.equal(point.body.idempotencyKey, `demo-env-mean-${point.sensorCode}-${built.day}`);
    }
    const yAt = new Date(built.yesterdayPoint.body.observedAt).getTime();
    assert.ok(yAt < todayStart);
    assert.equal(
      built.yesterdayPoint.body.idempotencyKey,
      `demo-env-mean-${YDAY_SENSOR}-${built.yesterday}`,
    );
  }
  const after = readFixture(DEMO_FIXTURE);
  assert.deepEqual(after, before);
});

test('overview note matches the day-bucket mean and a clean day is 24/85/800/73', () => {
  const bucketRows = [];
  for (const point of ENV_POINTS) {
    for (const [field, metric] of DAY_METRICS) {
      bucketRows.push({
        camera_code: point.sensorCode,
        metric,
        value: point[field],
      });
    }
  }
  bucketRows.push({
    camera_code: '',
    metric: 'env_temperature',
    value: 99,
  });
  const checked = assertOverviewEnv(
    {
      ...cleanEnvMeans(),
      liveMushroomTotal: 30,
      env: { avgTemp: 21 },
    },
    bucketRows,
  );
  assert.equal(checked.clean, true);
  assert.deepEqual(checked.means, cleanEnvMeans());
  const extra = [
    ...bucketRows,
    { camera_code: 'SENSOR-OTHER', metric: 'env_temperature', value: 20 },
    { camera_code: 'SENSOR-OTHER', metric: 'env_humidity', value: 80 },
    { camera_code: 'SENSOR-OTHER', metric: 'env_co2', value: 700 },
    { camera_code: 'SENSOR-OTHER', metric: 'env_substrate_moisture', value: 70 },
  ];
  const mixed = assertOverviewEnv(
    {
      envMeanTemperature: 22.7,
      envMeanHumidity: 83.3,
      envMeanCo2: 766.7,
      envMeanSubstrateMoisture: 72,
    },
    extra,
  );
  assert.equal(mixed.clean, false);
  assert.equal(mixed.means.envMeanTemperature, 22.7);
  const proof = formatEnvMeanProof({
    means: checked.means,
    day: '2026-10-16',
    clean: true,
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /^全园环境参数均值 温度 24℃ · 湿度 85% · CO₂ 800ppm · 基质含水率 73%/);
  assert.match(proof, /SENSOR-EM-01（S01）: 22℃ · 78% · CO₂ 620 · 基质含水率 68%/);
  assert.match(proof, /SENSOR-EM-02（S02）: 26℃ · 92% · CO₂ 980 · 基质含水率 78%/);
  assert.match(proof, new RegExp(`${YDAY_SENSOR}: 昨天`));
  assert.match(proof, new RegExp(`对照 ${CONTRAST_SENSOR}: 当天 0 条`));
  assert.match(proof, /总览: http:\/\/127\.0\.0\.1:43123\//);
  assert.match(proof, /大屏: http:\/\/127\.0\.0\.1:43123\/big-screen/);
  assert.equal(assertSensorReading([{ ...ENV_POINTS[0] }], ENV_POINTS[0]).temperature, 22);
  assert.doesNotThrow(() => assertContrastEmpty([]));
  assert.throws(() => assertContrastEmpty([{ sensorCode: CONTRAST_SENSOR }]), /对照传感器/);
  assert.throws(
    () =>
      assertOverviewEnv(
        {
          envMeanTemperature: 24,
          envMeanHumidity: 85,
          envMeanCo2: 800,
          envMeanSubstrateMoisture: 73,
        },
        [
          ...bucketRows,
          { camera_code: YDAY_SENSOR, metric: 'env_temperature', value: 16 },
        ],
      ),
    /昨天的传感器/,
  );
  assert.equal(readingsFromBucketRows(bucketRows).length, 2);
});

test('day bucket rewrite only touches this sensor on that day', async () => {
  const built = validateEnvMeanPayloads(buildEnvMeanPayloads(clocks[0]), clocks[0]);
  const point = built.points[0];
  const calls = [];
  await syncSensorDayBucket(point, point.bucketStart, point.observedAt, {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [] };
    },
  });
  assert.match(calls[0].sql, /DELETE FROM metric_buckets_day/);
  assert.equal(calls[0].params[0], 'S01');
  assert.equal(calls[0].params[1], 'SENSOR-EM-01');
  assert.equal(calls.length, 1 + DAY_METRICS.length);
  assert.ok(calls.slice(1).every((call) => call.sql.includes('INSERT INTO metric_buckets_day')));
  assert.ok(calls.slice(1).every((call) => call.params[1] === 'SENSOR-EM-01'));
  assert.ok(calls.slice(1).every((call) => !String(call.sql).includes("camera_code = ''")));
});
