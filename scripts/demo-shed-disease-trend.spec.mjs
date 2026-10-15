import assert from 'node:assert/strict';
import test from 'node:test';
import { readFixture } from './lib/ingest-wire.mjs';
import { DEMO_CAMERA as ONE_CAMERA, DEMO_FIXTURE as ONE_FIXTURE } from './demo-one-http-recognition.mjs';
import { DEMO_CAMERA as TREND_CAMERA, buildGrowthPayloads } from './demo-growth-trend.mjs';
import { DEMO_CAMERA as GRAIN_CAMERA } from './demo-growth-grain.mjs';
import { DEMO_CAMERA as RATE_CAMERA } from './demo-maturity-rate.mjs';
import { DEMO_CAMERA as DELTA_CAMERA } from './demo-shed-growth-delta.mjs';
import { DEMO_CAMERA as LIST_CAMERA } from './demo-disease-list.mjs';
import {
  CONTRAST_CAMERA,
  DEMO_CAMERA,
  DEMO_FIXTURE,
  DEMO_SHED,
  DISEASE_COUNTS,
  DISEASE_LEVEL,
  assertContrastEmpty,
  assertDiseasePoints,
  buildShedDiseaseTrendPayloads,
  diseaseNote,
  formatShedDiseaseTrendProof,
  shedDiseaseTrendUrl,
  validateShedDiseaseTrendPayloads,
} from './demo-shed-disease-trend.mjs';

const clocks = [
  new Date('2026-10-15T02:00:00.000Z'),
  new Date('2026-10-05T01:00:00.000Z'),
  new Date('2026-03-01T02:00:00.000Z'),
  new Date('2026-11-01T16:00:00.000Z'),
];

test('CAM-SDT-01 disease counts rise across four Shanghai days', () => {
  const before = readFixture(DEMO_FIXTURE);
  assert.equal(before.cameraCode, TREND_CAMERA);
  assert.equal(before.cameraCode, 'CAM-GT-01');
  assert.equal(before.diseaseCount, 0);
  assert.equal(DEMO_CAMERA, 'CAM-SDT-01');
  assert.equal(DEMO_SHED, 'S01');
  assert.equal(CONTRAST_CAMERA, 'CAM-SDT-NONE');
  assert.equal(DISEASE_LEVEL, 1);
  assert.notEqual(DEMO_CAMERA, TREND_CAMERA);
  assert.notEqual(DEMO_CAMERA, GRAIN_CAMERA);
  assert.notEqual(DEMO_CAMERA, RATE_CAMERA);
  assert.notEqual(DEMO_CAMERA, DELTA_CAMERA);
  assert.notEqual(DEMO_CAMERA, ONE_CAMERA);
  assert.notEqual(DEMO_CAMERA, LIST_CAMERA);
  for (const now of clocks) {
    const samples = buildShedDiseaseTrendPayloads(now);
    const again = buildShedDiseaseTrendPayloads(now);
    assert.deepEqual(
      again.map((sample) => sample.body.idempotencyKey),
      samples.map((sample) => sample.body.idempotencyKey),
    );
    validateShedDiseaseTrendPayloads(samples, now);
    const ordered = [...samples].sort((a, b) => a.day.localeCompare(b.day));
    assert.deepEqual(
      ordered.map((sample) => sample.diseaseCount),
      DISEASE_COUNTS,
    );
    assert.equal(diseaseNote(ordered.map((sample) => sample.diseaseCount)), '病害 1 → 3 → 6 → 10（升）');
    for (const sample of samples) {
      assert.equal(sample.body.cameraCode, DEMO_CAMERA);
      assert.equal(sample.body.shedCode, DEMO_SHED);
      assert.equal(sample.body.diseaseLevel, 1);
      assert.equal(sample.body.idempotencyKey.startsWith('demo-shed-disease-trend-'), true);
      assert.ok(sample.diameter >= 4.2);
    }
    const diameters = ordered.map((sample) => sample.diameter);
    for (let index = 1; index < diameters.length; index += 1) {
      assert.ok(diameters[index] - diameters[index - 1] >= 0.05);
    }
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

test('proof prints the disease trend page and 1 to 10', () => {
  const now = clocks[0];
  const samples = buildShedDiseaseTrendPayloads(now);
  const proof = formatShedDiseaseTrendProof({
    samples,
    duplicates: new Map(samples.map((sample) => [sample.day, false])),
    closed: 2,
    webOrigin: 'http://127.0.0.1:43123',
  });
  const url = shedDiseaseTrendUrl({ days: 7 }, 'http://127.0.0.1:43123');
  assert.match(proof, /棚区: S01/);
  assert.match(proof, /摄像头: CAM-SDT-01/);
  assert.match(proof, /病害 1 → 3 → 6 → 10（升）/);
  assert.match(proof, /关闭告警: 2/);
  assert.match(url, /\/shed-disease-trend\?/);
  assert.doesNotMatch(url, /\/diseases\?/);
  assert.doesNotMatch(url, /growth-trends/);
  assert.doesNotMatch(url, /shed-growth-delta/);
  assert.doesNotMatch(url, /shed-env-24h/);
  assert.match(proof, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(proof, /cameraCode=CAM-SDT-NONE/);
});

test('api day buckets must carry the same disease counts', () => {
  const now = clocks[0];
  const samples = buildShedDiseaseTrendPayloads(now);
  const series = {
    days: 7,
    sheds: [
      {
        shedCode: 'S01',
        points: [{ day: samples[0].day, diseaseCount: 99 }],
        cameras: [
          {
            cameraCode: 'CAM-SDT-01',
            points: samples.map((sample) => ({
              day: sample.day,
              diseaseCount: sample.diseaseCount,
            })),
          },
        ],
      },
    ],
  };
  const counts = assertDiseasePoints(series, samples);
  assert.deepEqual(counts, DISEASE_COUNTS);
  assertContrastEmpty({ sheds: [] });
  assert.throws(() => assertContrastEmpty(series), /对照趋势不是空的/);
  assert.throws(
    () =>
      assertDiseasePoints(
        {
          sheds: [
            {
              shedCode: 'S01',
              cameras: [
                {
                  cameraCode: 'CAM-SDT-01',
                  points: samples.map((sample, index) => ({
                    day: sample.day,
                    diseaseCount: index + 1,
                  })),
                },
              ],
            },
          ],
        },
        samples,
      ),
    /病害数量/,
  );
});
