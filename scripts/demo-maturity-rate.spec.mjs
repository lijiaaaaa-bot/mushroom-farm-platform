import assert from 'node:assert/strict';
import test from 'node:test';
import { readFixture } from './lib/ingest-wire.mjs';
import { DEMO_CAMERA as ONE_CAMERA, DEMO_FIXTURE as ONE_FIXTURE } from './demo-one-http-recognition.mjs';
import { DEMO_CAMERA as TREND_CAMERA, buildGrowthPayloads } from './demo-growth-trend.mjs';
import { DEMO_CAMERA as GRAIN_CAMERA, buildGrainPayloads } from './demo-growth-grain.mjs';
import {
  DEMO_CAMERA,
  DEMO_FIXTURE,
  DEMO_SHED,
  assertMaturityPoints,
  buildMaturityPayloads,
  formatMaturityProof,
  formatRate,
  maturityPercent,
  maturityRateUrl,
  validateMaturityPayloads,
} from './demo-maturity-rate.mjs';

const clocks = [
  new Date('2026-10-15T02:00:00.000Z'),
  new Date('2026-10-05T01:00:00.000Z'),
  new Date('2026-03-01T02:00:00.000Z'),
  new Date('2026-11-01T16:00:00.000Z'),
];

test('CAM-MR-01 rates rise and a zero-mushroom day stays empty', () => {
  const before = readFixture(DEMO_FIXTURE);
  assert.equal(before.cameraCode, TREND_CAMERA);
  assert.equal(before.cameraCode, 'CAM-GT-01');
  assert.equal(DEMO_CAMERA, 'CAM-MR-01');
  assert.equal(DEMO_SHED, 'S01');
  assert.notEqual(DEMO_CAMERA, TREND_CAMERA);
  assert.notEqual(DEMO_CAMERA, GRAIN_CAMERA);
  assert.notEqual(DEMO_CAMERA, ONE_CAMERA);
  for (const now of clocks) {
    const samples = buildMaturityPayloads(now);
    const again = buildMaturityPayloads(now);
    assert.deepEqual(
      again.map((sample) => sample.body.idempotencyKey),
      samples.map((sample) => sample.body.idempotencyKey),
    );
    validateMaturityPayloads(samples, now);
    const ordered = [...samples].sort((a, b) => a.day.localeCompare(b.day));
    assert.deepEqual(
      ordered.map((sample) => [sample.mushroomCount, sample.matureCount, sample.maturityRate]),
      [
        [0, 0, null],
        [20, 2, 10],
        [20, 6, 30],
        [20, 10, 50],
      ],
    );
    assert.equal(ordered[0].maturityRate, maturityPercent(0, 0));
    assert.ok(ordered[1].maturityRate < ordered[3].maturityRate);
    for (const sample of samples) {
      assert.equal(sample.body.cameraCode, DEMO_CAMERA);
      assert.equal(sample.body.shedCode, DEMO_SHED);
      assert.equal(sample.body.idempotencyKey.startsWith('demo-maturity-rate-'), true);
    }
  }
  const after = readFixture(DEMO_FIXTURE);
  assert.equal(after.cameraCode, 'CAM-GT-01');
  assert.deepEqual(after.points, before.points);
  assert.equal(readFixture(ONE_FIXTURE).body.cameraCode, 'CAM-DEMO-01');
  const trend = buildGrowthPayloads(clocks[0]);
  const grain = buildGrainPayloads(clocks[0]);
  assert.ok(trend.every((sample) => sample.body.cameraCode === 'CAM-GT-01'));
  assert.ok(grain.every((sample) => sample.body.cameraCode === 'CAM-GG-01'));
  assert.equal(readFixture(DEMO_FIXTURE).cameraCode, 'CAM-GT-01');
});

test('proof prints the page and two different rates', () => {
  const now = clocks[0];
  const samples = buildMaturityPayloads(now);
  const proof = formatMaturityProof({
    samples,
    duplicates: new Map(samples.map((sample) => [sample.day, false])),
    webOrigin: 'http://127.0.0.1:43123',
  });
  const url = maturityRateUrl({ days: 7 }, 'http://127.0.0.1:43123');
  assert.match(proof, /棚区: S01/);
  assert.match(proof, /摄像头: CAM-MR-01/);
  assert.match(proof, /成熟率 10% → 30% → 50%（升）/);
  assert.match(proof, /成熟率 —/);
  assert.match(proof, /升降 升 20/);
  assert.match(proof, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(formatRate(null), '—');
  assert.equal(formatRate(10), '10%');
  assert.equal(formatRate(35.7), '35.7%');
});

test('api points must carry the same percents', () => {
  const now = clocks[0];
  const samples = buildMaturityPayloads(now);
  const series = {
    sheds: [
      {
        shedCode: 'S01',
        cameras: [
          {
            cameraCode: 'CAM-MR-01',
            points: samples.map((sample) => ({
              day: sample.day,
              mushroomCount: sample.mushroomCount,
              matureCount: sample.matureCount,
              maturityRate: sample.maturityRate,
            })),
          },
        ],
      },
    ],
  };
  assertMaturityPoints(series, samples);
  assert.throws(
    () =>
      assertMaturityPoints(
        {
          sheds: [
            {
              shedCode: 'S01',
              cameras: [
                {
                  cameraCode: 'CAM-MR-01',
                  points: samples.map((sample) => ({
                    day: sample.day,
                    mushroomCount: sample.mushroomCount,
                    matureCount: sample.matureCount,
                    maturityRate: 10,
                  })),
                },
              ],
            },
          ],
        },
        samples,
      ),
    /成熟率/,
  );
});
