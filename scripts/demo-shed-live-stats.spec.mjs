import assert from 'node:assert/strict';
import test from 'node:test';
import { readFixture } from './lib/ingest-wire.mjs';
import { DEMO_CAMERA as ONE_CAMERA, DEMO_FIXTURE as ONE_FIXTURE } from './demo-one-http-recognition.mjs';
import { DEMO_CAMERA as TREND_CAMERA, buildGrowthPayloads } from './demo-growth-trend.mjs';
import { DEMO_CAMERA as GRAIN_CAMERA } from './demo-growth-grain.mjs';
import { DEMO_CAMERA as RATE_CAMERA } from './demo-maturity-rate.mjs';
import { DEMO_CAMERA as DELTA_CAMERA } from './demo-shed-growth-delta.mjs';
import { DEMO_CAMERA as DISEASE_CAMERA } from './demo-shed-disease-trend.mjs';
import {
  CONTRAST_CAMERA,
  DEMO_CAMERA,
  DEMO_FIXTURE,
  DEMO_SHED,
  DISEASE_COUNT,
  DISEASE_LEVEL,
  MATURE_COUNT,
  MUSHROOM_COUNT,
  PENDING_COUNT,
  assertLiveStats,
  assertLiveStatsEmpty,
  buildShedLiveStatsPayload,
  formatShedLiveStatsProof,
  liveStatsNote,
  pendingMatureCount,
  shedLiveStatsUrl,
  validateShedLiveStatsPayload,
} from './demo-shed-live-stats.mjs';

const clocks = [
  new Date('2026-10-15T02:00:00.000Z'),
  new Date('2026-10-05T01:00:00.000Z'),
  new Date('2026-03-01T02:00:00.000Z'),
  new Date('2026-11-01T16:00:00.000Z'),
];

test('CAM-SLS-01 writes one day of 20, 8, 12, and 2', () => {
  const before = readFixture(DEMO_FIXTURE);
  assert.equal(before.cameraCode, TREND_CAMERA);
  assert.equal(before.cameraCode, 'CAM-GT-01');
  assert.equal(before.diseaseCount, 0);
  assert.equal(before.body.mushroomCount, 21);
  assert.equal(DEMO_CAMERA, 'CAM-SLS-01');
  assert.equal(DEMO_SHED, 'S01');
  assert.equal(CONTRAST_CAMERA, 'CAM-SLS-NONE');
  assert.equal(DISEASE_LEVEL, 1);
  assert.equal(MUSHROOM_COUNT, 20);
  assert.equal(MATURE_COUNT, 8);
  assert.equal(DISEASE_COUNT, 2);
  assert.equal(PENDING_COUNT, 12);
  assert.equal(pendingMatureCount(20, 8), 12);
  assert.equal(pendingMatureCount(0, 3), 0);
  assert.equal(pendingMatureCount(4, 9), 0);
  assert.notEqual(DEMO_CAMERA, TREND_CAMERA);
  assert.notEqual(DEMO_CAMERA, GRAIN_CAMERA);
  assert.notEqual(DEMO_CAMERA, RATE_CAMERA);
  assert.notEqual(DEMO_CAMERA, DELTA_CAMERA);
  assert.notEqual(DEMO_CAMERA, DISEASE_CAMERA);
  assert.notEqual(DEMO_CAMERA, ONE_CAMERA);
  for (const now of clocks) {
    const sample = buildShedLiveStatsPayload(now);
    const again = buildShedLiveStatsPayload(now);
    assert.equal(again.body.idempotencyKey, sample.body.idempotencyKey);
    validateShedLiveStatsPayload(sample, now);
    assert.equal(sample.body.cameraCode, DEMO_CAMERA);
    assert.equal(sample.body.shedCode, DEMO_SHED);
    assert.equal(sample.body.mushroomCount, 20);
    assert.equal(sample.body.matureCount, 8);
    assert.equal(sample.body.diseaseCount, 2);
    assert.equal(sample.body.diseaseLevel, 1);
    assert.equal(sample.body.idempotencyKey.startsWith('demo-shed-live-stats-'), true);
    assert.equal(sample.body.matureCount / sample.body.mushroomCount < 0.6, true);
  }
  const after = readFixture(DEMO_FIXTURE);
  assert.equal(after.cameraCode, 'CAM-GT-01');
  assert.equal(after.diseaseCount, 0);
  assert.deepEqual(after.points, before.points);
  assert.equal(readFixture(ONE_FIXTURE).body.cameraCode, 'CAM-DEMO-01');
  const trend = buildGrowthPayloads(clocks[0]);
  assert.ok(trend.every((sample) => sample.body.cameraCode === 'CAM-GT-01'));
  assert.ok(trend.every((sample) => sample.body.diseaseCount === 0));
});

test('proof prints the four live counts and the empty contrast', () => {
  const now = clocks[0];
  const sample = buildShedLiveStatsPayload(now);
  const proof = formatShedLiveStatsProof({
    sample,
    duplicate: false,
    closed: 0,
    webOrigin: 'http://127.0.0.1:43123',
  });
  const url = shedLiveStatsUrl({ cameraCode: DEMO_CAMERA }, 'http://127.0.0.1:43123');
  const contrast = shedLiveStatsUrl({ cameraCode: CONTRAST_CAMERA }, 'http://127.0.0.1:43123');
  assert.equal(
    liveStatsNote({
      mushroomCount: 20,
      matureCount: 8,
      pendingMatureCount: 12,
      diseaseCount: 2,
    }),
    '蘑菇 20 · 成熟 8 · 待成熟 12 · 病害 2',
  );
  assert.match(proof, /棚区: S01/);
  assert.match(proof, /摄像头: CAM-SLS-01/);
  assert.match(proof, /蘑菇 20 · 成熟 8 · 待成熟 12 · 病害 2/);
  assert.match(proof, /蘑菇数: 20/);
  assert.match(proof, /成熟数: 8/);
  assert.match(proof, /待成熟: 12/);
  assert.match(proof, /病害数: 2/);
  assert.match(url, /\/shed-live-stats\?/);
  assert.match(url, /cameraCode=CAM-SLS-01/);
  assert.match(contrast, /cameraCode=CAM-SLS-NONE/);
  assert.doesNotMatch(url, /\/growth-trends\?/);
  assert.doesNotMatch(url, /shed-growth-delta/);
  assert.doesNotMatch(url, /shed-disease-trend/);
  assert.doesNotMatch(url, /shed-env-24h/);
  assert.match(proof, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assertLiveStats({
    available: true,
    shedCode: 'S01',
    cameraCode: 'CAM-SLS-01',
    mushroomCount: 20,
    matureCount: 8,
    pendingMatureCount: 12,
    diseaseCount: 2,
    basis: 'latest_per_camera',
  });
  assertLiveStatsEmpty({
    available: false,
    mushroomCount: null,
    pendingMatureCount: null,
  });
  assert.throws(
    () =>
      assertLiveStats({
        available: true,
        shedCode: 'S01',
        cameraCode: 'CAM-SLS-01',
        mushroomCount: 20,
        matureCount: 8,
        pendingMatureCount: 11,
        diseaseCount: 2,
        basis: 'latest_per_camera',
      }),
    /待成熟/,
  );
  assert.throws(() => assertLiveStatsEmpty({ available: true, mushroomCount: 20 }), /对照仍有/);
});
