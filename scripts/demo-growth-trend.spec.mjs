import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { readFixture, repoRoot } from './lib/ingest-wire.mjs';
import { DEMO_CAMERA as FIXTURE_CAMERA, DEMO_FIXTURE as ONE_FIXTURE } from './demo-one-http-recognition.mjs';
import {
  CONTRAST_CAMERA,
  DEMO_CAMERA,
  DEMO_FIXTURE,
  DEMO_SHED,
  assertCameraPoints,
  assertContrastEmpty,
  buildGrowthPayloads,
  diameterFor,
  formatGrowthProof,
  growthTrendUrl,
  validateGrowthPayloads,
} from './demo-growth-trend.mjs';

const now = new Date('2026-10-14T01:02:03.004Z');

test('payload keeps three rising days on CAM-GT-01 and leaves the one-ingest fixture', () => {
  const fixture = readFixture(DEMO_FIXTURE);
  assert.equal(fixture.cameraCode, DEMO_CAMERA);
  assert.equal(fixture.shedCode, DEMO_SHED);
  assert.equal(fixture.contrastCamera, CONTRAST_CAMERA);
  assert.equal(fixture.diseaseCount, 0);
  assert.equal(fixture.temperature, 22.5);
  assert.equal(fixture.body.cameraCode, DEMO_CAMERA);
  assert.equal(fixture.body.mushroomCount, 21);
  assert.equal(fixture.body.matureCount, 8);
  assert.deepEqual(
    fixture.points.map((point) => [point.offsetDays, point.mushroomCount, point.matureCount]),
    [
      [5, 8, 2],
      [2, 14, 5],
      [0, 21, 8],
    ],
  );
  const one = readFixture(ONE_FIXTURE);
  assert.equal(one.body.cameraCode, FIXTURE_CAMERA);
  assert.equal(one.body.cameraCode, 'CAM-DEMO-01');
  const samples = buildGrowthPayloads(now);
  assert.deepEqual(
    samples.map((sample) => sample.day),
    ['2026-10-09', '2026-10-12', '2026-10-14'],
  );
  assert.deepEqual(
    samples.map((sample) => sample.mushroomCount),
    [8, 14, 21],
  );
  assert.deepEqual(
    samples.map((sample) => sample.matureCount),
    [2, 5, 8],
  );
  for (const sample of samples) {
    assert.equal(sample.diameter, diameterFor(sample.day, sample.offsetDays));
    assert.equal(sample.body.cameraCode, DEMO_CAMERA);
    assert.notEqual(sample.body.cameraCode, 'CAM-DEMO-01');
  }
  const again = buildGrowthPayloads(now);
  assert.deepEqual(
    again.map((sample) => sample.body.idempotencyKey),
    samples.map((sample) => sample.body.idempotencyKey),
  );
  validateGrowthPayloads(samples, now);
  assert.equal(readFixture(ONE_FIXTURE).body.cameraCode, 'CAM-DEMO-01');
  assert.equal(readFixture(DEMO_FIXTURE).cameraCode, DEMO_CAMERA);
});

test('proof prints the shed, the days and a url that opens the curve', () => {
  const samples = buildGrowthPayloads(now);
  const series = {
    days: 7,
    sheds: [
      {
        shedCode: DEMO_SHED,
        points: [],
        cameras: [
          {
            cameraCode: DEMO_CAMERA,
            points: samples.map((sample) => ({
              day: sample.day,
              mushroomCount: sample.mushroomCount,
              matureCount: sample.matureCount,
              capDiameterMean: sample.diameter,
              sampleCount: 1,
            })),
          },
        ],
      },
    ],
  };
  assertCameraPoints(series, samples);
  assertContrastEmpty({ sheds: [] });
  assert.throws(() => assertContrastEmpty(series), /对照趋势/);
  assert.throws(
    () =>
      assertCameraPoints(
        {
          sheds: [
            {
              shedCode: DEMO_SHED,
              cameras: [
                {
                  cameraCode: DEMO_CAMERA,
                  points: [{ day: samples[0].day, mushroomCount: 1, matureCount: 1, capDiameterMean: 1 }],
                },
              ],
            },
          ],
        },
        samples,
      ),
    /至少要 2 个|没有 /,
  );
  const proof = formatGrowthProof({
    samples,
    duplicates: new Map(samples.map((sample) => [sample.day, false])),
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /棚区: S01/);
  assert.match(proof, /摄像头: CAM-GT-01/);
  assert.match(proof, /天数: 7/);
  assert.match(proof, /2026-10-09: 蘑菇 8，成熟 2/);
  assert.match(proof, /2026-10-12: 蘑菇 14，成熟 5/);
  assert.match(proof, /2026-10-14: 蘑菇 21，成熟 8/);
  const open = growthTrendUrl({ days: 7 }, 'http://127.0.0.1:43123');
  const month = growthTrendUrl({ days: 30 }, 'http://127.0.0.1:43123');
  const contrast = growthTrendUrl(
    { days: 7, cameraCode: CONTRAST_CAMERA },
    'http://127.0.0.1:43123',
  );
  assert.match(proof, new RegExp(open.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(proof, new RegExp(month.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(proof, new RegExp(contrast.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(open, /days=7/);
  assert.match(open, /shedCode=S01/);
  assert.match(open, /cameraCode=CAM-GT-01/);
  assert.doesNotMatch(proof, /CAM-DEMO-01/);
});

test('make target and the demo doc name the curve and the empty contrast', () => {
  const root = repoRoot();
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  assert.match(makefile, /^demo-growth-trend:.*\n\tnode scripts\/demo-growth-trend\.mjs\s*$/m);
  assert.match(makefile, /scripts\/demo-growth-trend\.spec\.mjs/);
  const doc = readFileSync(join(root, 'docs/DEMO_GROWTH_TREND.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  assert.match(doc, /make demo-growth-trend/);
  assert.match(doc, /CAM-GT-01/);
  assert.match(doc, /CAM-GT-NONE/);
  assert.match(doc, /S01/);
  assert.match(doc, /7 天/);
  assert.match(doc, /30 天/);
  assert.match(doc, /蘑菇/);
  assert.match(doc, /成熟/);
  assert.match(doc, /菌盖/);
  assert.match(doc, /没有日聚合/);
  assert.match(doc, /验收/);
  assert.match(doc, /截图/);
  assert.match(caps, /DEMO_GROWTH_TREND\.md/);
  assert.match(caps, /make demo-growth-trend/);
  assert.doesNotMatch(doc, /假定|假设/);
  const untouched = [
    'scripts/demo-env-filter.mjs',
    'scripts/demo-harvest-list.mjs',
    'scripts/demo-harvest-filter.mjs',
    'scripts/demo-alert-rules.mjs',
    'scripts/demo-report-xlsx.mjs',
    'scripts/demo-telemetry-latest.mjs',
    'scripts/demo-telemetry-history.mjs',
    'scripts/demo-telemetry-threshold-alert.mjs',
    'scripts/demo-alert-rule-config.mjs',
  ];
  for (const file of untouched) {
    const source = readFileSync(join(root, file), 'utf8');
    assert.doesNotMatch(source, /CAM-GT-01|demo-growth-trend/);
  }
});
