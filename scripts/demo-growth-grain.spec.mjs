import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { readFixture, repoRoot } from './lib/ingest-wire.mjs';
import { DEMO_CAMERA as ONE_CAMERA, DEMO_FIXTURE as ONE_FIXTURE } from './demo-one-http-recognition.mjs';
import { DEMO_CAMERA as TREND_CAMERA } from './demo-growth-trend.mjs';
import {
  DEMO_CAMERA,
  DEMO_FIXTURE,
  DEMO_SHED,
  assertApiGrain,
  assertReadableGrain,
  buildGrainPayloads,
  formatGrainProof,
  grainTrendUrl,
  mondayOf,
  rollupSamples,
} from './demo-growth-grain.mjs';

const clocks = [
  new Date('2026-10-15T02:00:00.000Z'),
  new Date('2026-10-05T01:00:00.000Z'),
  new Date('2026-10-31T16:00:00.000Z'),
  new Date('2026-03-01T02:00:00.000Z'),
  new Date('2026-04-06T01:30:00.000Z'),
  new Date('2026-11-01T16:00:00.000Z'),
];

test('six Shanghai days on CAM-GG-01 collapse from day to week to month', () => {
  const fixture = readFixture(DEMO_FIXTURE);
  assert.equal(fixture.cameraCode, TREND_CAMERA);
  assert.equal(fixture.cameraCode, 'CAM-GT-01');
  assert.equal(fixture.shedCode, DEMO_SHED);
  assert.equal(ONE_CAMERA, 'CAM-DEMO-01');
  assert.notEqual(DEMO_CAMERA, TREND_CAMERA);
  assert.notEqual(DEMO_CAMERA, ONE_CAMERA);
  for (const now of clocks) {
    const samples = buildGrainPayloads(now);
    const again = buildGrainPayloads(now);
    assert.deepEqual(
      again.map((sample) => sample.body.idempotencyKey),
      samples.map((sample) => sample.body.idempotencyKey),
    );
    const { day, week, month } = assertReadableGrain(samples, now);
    assert.equal(day.length, 6);
    assert.equal(week.length, 3);
    assert.ok(month.length === 1 || month.length === 2);
    assert.ok(day.length > week.length && week.length > month.length);
    for (const sample of samples) {
      assert.equal(sample.body.cameraCode, DEMO_CAMERA);
      assert.equal(mondayOf(sample.day) <= sample.day, true);
    }
    assert.equal(readFixture(DEMO_FIXTURE).cameraCode, 'CAM-GT-01');
    assert.equal(readFixture(ONE_FIXTURE).body.cameraCode, 'CAM-DEMO-01');
  }
});

test('proof prints day week and month urls with different counts', () => {
  const now = clocks[0];
  const samples = buildGrainPayloads(now);
  const day = rollupSamples(samples, 'day');
  const week = rollupSamples(samples, 'week');
  const month = rollupSamples(samples, 'month');
  assert.equal(day.length, 6);
  const proof = formatGrainProof({
    samples,
    duplicates: new Map(samples.map((sample) => [sample.day, false])),
    webOrigin: 'http://127.0.0.1:43123',
    now,
  });
  const dayUrl = grainTrendUrl('day', 'http://127.0.0.1:43123');
  const weekUrl = grainTrendUrl('week', 'http://127.0.0.1:43123');
  const monthUrl = grainTrendUrl('month', 'http://127.0.0.1:43123');
  assert.match(proof, /日 6 个点，周 3 个点，月 [12] 个点/);
  assert.match(proof, /棚区: S01/);
  assert.match(proof, /摄像头: CAM-GG-01/);
  assert.match(proof, new RegExp(dayUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(proof, new RegExp(weekUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(proof, new RegExp(monthUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(dayUrl, /grain=day/);
  assert.match(weekUrl, /grain=week/);
  assert.match(monthUrl, /grain=month/);
  assert.match(dayUrl, /days=30/);
  assert.match(dayUrl, /cameraCode=CAM-GG-01/);
  assert.doesNotMatch(proof, /CAM-GT-01|CAM-DEMO-01/);
  const seriesFor = (grain, rows) => ({
    days: 30,
    grain,
    sheds: [
      {
        shedCode: DEMO_SHED,
        cameras: [
          {
            cameraCode: DEMO_CAMERA,
            points: rows.map((row) => ({
              day: row.period,
              mushroomCount: row.mushroomCount,
              matureCount: row.matureCount,
              sampleCount: row.sampleCount,
              capDiameterMean: row.capDiameterMean,
            })),
          },
        ],
      },
    ],
  });
  assertApiGrain(seriesFor('day', day), samples, 'day');
  assertApiGrain(seriesFor('week', week), samples, 'week');
  assertApiGrain(seriesFor('month', month), samples, 'month');
  assert.throws(() => assertApiGrain(seriesFor('week', day), samples, 'week'), /点数|周期/);
});

test('make target and the demo doc name the three grains', () => {
  const root = repoRoot();
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  assert.match(makefile, /^demo-growth-grain:.*\n\tnode scripts\/demo-growth-grain\.mjs\s*$/m);
  assert.match(makefile, /scripts\/demo-growth-grain\.spec\.mjs/);
  assert.match(makefile, /^demo-growth-trend:.*\n\tnode scripts\/demo-growth-trend\.mjs\s*$/m);
  const doc = readFileSync(join(root, 'docs/DEMO_GROWTH_GRAIN.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  assert.match(doc, /make demo-growth-grain/);
  assert.match(doc, /CAM-GG-01/);
  assert.match(doc, /S01/);
  assert.match(doc, /日/);
  assert.match(doc, /周/);
  assert.match(doc, /月/);
  assert.match(doc, /（周）/);
  assert.match(doc, /（月）/);
  assert.match(doc, /验收/);
  assert.match(doc, /截图/);
  assert.match(caps, /DEMO_GROWTH_GRAIN\.md/);
  assert.match(caps, /make demo-growth-grain/);
  assert.match(readme, /DEMO_GROWTH_GRAIN\.md/);
  assert.match(readme, /make demo-growth-grain/);
  assert.doesNotMatch(doc, /假定|假设/);
  assert.doesNotMatch(readme, /demo-growth-grain[\s\S]*接入观测/);
  const trend = readFileSync(join(root, 'scripts/demo-growth-trend.mjs'), 'utf8');
  assert.doesNotMatch(trend, /CAM-GG-01|demo-growth-grain/);
  const fixture = readFileSync(
    join(root, 'packages/contracts/fixtures/recognition.demo-growth-trend.json'),
    'utf8',
  );
  assert.match(fixture, /CAM-GT-01/);
  assert.doesNotMatch(fixture, /CAM-GG-01/);
});
