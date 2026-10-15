import assert from 'node:assert/strict';
import test from 'node:test';
import { readFixture } from './lib/ingest-wire.mjs';
import { DEMO_CAMERA as ONE_CAMERA, DEMO_FIXTURE as ONE_FIXTURE } from './demo-one-http-recognition.mjs';
import { DEMO_CAMERA as TREND_CAMERA, buildGrowthPayloads } from './demo-growth-trend.mjs';
import { DEMO_CAMERA as GRAIN_CAMERA } from './demo-growth-grain.mjs';
import { DEMO_CAMERA as RATE_CAMERA } from './demo-maturity-rate.mjs';
import {
  CONTRAST_CAMERA,
  DEMO_CAMERA,
  DEMO_FIXTURE,
  DEMO_SHED,
  assertContrastEmpty,
  assertDeltaPoints,
  buildShedGrowthDeltaPayloads,
  deltaNote,
  formatShedGrowthDeltaProof,
  growthDeltas,
  shedGrowthDeltaUrl,
  validateShedGrowthDeltaPayloads,
} from './demo-shed-growth-delta.mjs';

const clocks = [
  new Date('2026-10-15T02:00:00.000Z'),
  new Date('2026-10-05T01:00:00.000Z'),
  new Date('2026-03-01T02:00:00.000Z'),
  new Date('2026-11-01T16:00:00.000Z'),
];

test('CAM-GD-01 adjacent day deltas rise from 6 to 8', () => {
  const before = readFixture(DEMO_FIXTURE);
  assert.equal(before.cameraCode, TREND_CAMERA);
  assert.equal(before.cameraCode, 'CAM-GT-01');
  assert.equal(DEMO_CAMERA, 'CAM-GD-01');
  assert.equal(DEMO_SHED, 'S01');
  assert.equal(CONTRAST_CAMERA, 'CAM-GD-NONE');
  assert.notEqual(DEMO_CAMERA, TREND_CAMERA);
  assert.notEqual(DEMO_CAMERA, GRAIN_CAMERA);
  assert.notEqual(DEMO_CAMERA, RATE_CAMERA);
  assert.notEqual(DEMO_CAMERA, ONE_CAMERA);
  for (const now of clocks) {
    const samples = buildShedGrowthDeltaPayloads(now);
    const again = buildShedGrowthDeltaPayloads(now);
    assert.deepEqual(
      again.map((sample) => sample.body.idempotencyKey),
      samples.map((sample) => sample.body.idempotencyKey),
    );
    validateShedGrowthDeltaPayloads(samples, now);
    const deltas = growthDeltas(samples);
    assert.deepEqual(
      deltas.map((item) => [item.mushroomDelta, item.matureDelta]),
      [
        [6, 2],
        [8, 3],
        [10, 4],
      ],
    );
    assert.ok(deltas[1].mushroomDelta > deltas[0].mushroomDelta);
    assert.equal(deltaNote('蘑菇增量', deltas.map((item) => item.mushroomDelta)), '蘑菇增量 6 → 8 → 10（升）');
    for (const sample of samples) {
      assert.equal(sample.body.cameraCode, DEMO_CAMERA);
      assert.equal(sample.body.shedCode, DEMO_SHED);
      assert.equal(sample.body.idempotencyKey.startsWith('demo-shed-growth-delta-'), true);
    }
  }
  const after = readFixture(DEMO_FIXTURE);
  assert.equal(after.cameraCode, 'CAM-GT-01');
  assert.deepEqual(after.points, before.points);
  assert.equal(readFixture(ONE_FIXTURE).body.cameraCode, 'CAM-DEMO-01');
  const trend = buildGrowthPayloads(clocks[0]);
  assert.ok(trend.every((sample) => sample.body.cameraCode === 'CAM-GT-01'));
});

test('proof prints the delta page and 6 to 8', () => {
  const now = clocks[0];
  const samples = buildShedGrowthDeltaPayloads(now);
  const proof = formatShedGrowthDeltaProof({
    samples,
    duplicates: new Map(samples.map((sample) => [sample.day, false])),
    webOrigin: 'http://127.0.0.1:43123',
  });
  const url = shedGrowthDeltaUrl({ days: 7 }, 'http://127.0.0.1:43123');
  assert.match(proof, /棚区: S01/);
  assert.match(proof, /摄像头: CAM-GD-01/);
  assert.match(proof, /蘑菇增量 6 → 8 → 10（升）/);
  assert.match(proof, /成熟增量 2 → 3 → 4（升）/);
  assert.match(proof, /蘑菇增量 \+6/);
  assert.match(proof, /蘑菇增量 \+8/);
  assert.match(url, /\/shed-growth-delta\?/);
  assert.doesNotMatch(url, /growth-trends/);
  assert.doesNotMatch(url, /growth-compare/);
  assert.doesNotMatch(url, /shed-env-24h/);
  assert.match(proof, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(proof, /cameraCode=CAM-GD-NONE/);
});

test('api day buckets must carry the same adjacent deltas', () => {
  const now = clocks[0];
  const samples = buildShedGrowthDeltaPayloads(now);
  const series = {
    days: 7,
    sheds: [
      {
        shedCode: 'S01',
        points: [{ day: samples[0].day, mushroomCount: 99, matureCount: 1 }],
        cameras: [
          {
            cameraCode: 'CAM-GD-01',
            points: samples.map((sample) => ({
              day: sample.day,
              mushroomCount: sample.mushroomCount,
              matureCount: sample.matureCount,
            })),
          },
        ],
      },
    ],
  };
  const deltas = assertDeltaPoints(series, samples);
  assert.deepEqual(
    deltas.map((item) => item.mushroomDelta),
    [6, 8, 10],
  );
  assertContrastEmpty({ sheds: [] });
  assert.throws(() => assertContrastEmpty(series), /对照趋势不是空的/);
  assert.throws(
    () =>
      assertDeltaPoints(
        {
          sheds: [
            {
              shedCode: 'S01',
              cameras: [
                {
                  cameraCode: 'CAM-GD-01',
                  points: samples.map((sample, index) => ({
                    day: sample.day,
                    mushroomCount: 10 + index,
                    matureCount: sample.matureCount,
                  })),
                },
              ],
            },
          ],
        },
        samples,
      ),
    /6 → 8/,
  );
});
