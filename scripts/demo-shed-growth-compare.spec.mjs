import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { readFixture, repoRoot } from './lib/ingest-wire.mjs';
import { DEMO_CAMERA as ONE_CAMERA, DEMO_FIXTURE as ONE_FIXTURE } from './demo-one-http-recognition.mjs';
import { DEMO_CAMERA as TREND_CAMERA, DEMO_FIXTURE as TREND_FIXTURE } from './demo-growth-trend.mjs';
import {
  DEMO_FIXTURE,
  DEMO_KEY_PREFIX,
  assertShedGap,
  buildComparePayloads,
  compareUrl,
  diameterFor,
  formatCompareProof,
  validateComparePayloads,
} from './demo-shed-growth-compare.mjs';

const now = new Date('2026-10-15T02:03:04.000Z');

test('payload keeps two sheds apart on the same Shanghai days', () => {
  const fixture = readFixture(DEMO_FIXTURE);
  assert.deepEqual(
    fixture.sheds.map((shed) => shed.shedCode),
    ['S01', 'S02'],
  );
  assert.deepEqual(
    fixture.sheds.map((shed) => shed.cameraCode),
    ['CAM-SG-S01', 'CAM-SG-S02'],
  );
  assert.equal(fixture.diseaseCount, 0);
  assert.equal(fixture.temperature, 22.5);
  assert.equal(fixture.clock, '2026-10-15T02:03:04.000Z');
  assert.equal(fixture.body.cameraCode, 'CAM-SG-S01');
  assert.equal(fixture.body.mushroomCount, 21);
  assert.equal(fixture.body.matureCount, 8);
  const samples = buildComparePayloads(now);
  assert.deepEqual(
    [...new Set(samples.map((sample) => sample.day))],
    ['2026-10-10', '2026-10-13', '2026-10-15'],
  );
  const latest = samples.filter((sample) => sample.day === '2026-10-15');
  assert.equal(latest.find((sample) => sample.shedCode === 'S01').mushroomCount, 21);
  assert.equal(latest.find((sample) => sample.shedCode === 'S01').matureCount, 8);
  assert.equal(latest.find((sample) => sample.shedCode === 'S02').mushroomCount, 8);
  assert.equal(latest.find((sample) => sample.shedCode === 'S02').matureCount, 3);
  for (const sample of samples) {
    assert.equal(sample.diameter, diameterFor(sample.day, sample.offsetDays, sample.shedCode));
    assert.match(sample.body.idempotencyKey, new RegExp(`^${DEMO_KEY_PREFIX}-`));
    assert.notEqual(sample.body.cameraCode, 'CAM-DEMO-01');
    assert.notEqual(sample.body.cameraCode, 'CAM-GT-01');
  }
  const s01 = samples.find((sample) => sample.day === '2026-10-15' && sample.shedCode === 'S01');
  const s02 = samples.find((sample) => sample.day === '2026-10-15' && sample.shedCode === 'S02');
  assert.ok(s01.diameter > s02.diameter);
  const again = buildComparePayloads(now);
  assert.deepEqual(
    again.map((sample) => sample.body.idempotencyKey),
    samples.map((sample) => sample.body.idempotencyKey),
  );
  validateComparePayloads(samples, now);
  assert.equal(readFixture(ONE_FIXTURE).body.cameraCode, ONE_CAMERA);
  assert.equal(readFixture(TREND_FIXTURE).cameraCode, TREND_CAMERA);
  assert.equal(readFixture(TREND_FIXTURE).body.mushroomCount, 21);
});

test('api shape shows the two sheds differ on the latest day', () => {
  const samples = buildComparePayloads(now);
  const series = {
    days: 7,
    sheds: ['S01', 'S02'].map((shedCode) => {
      const rows = samples.filter((sample) => sample.shedCode === shedCode);
      return {
        shedCode,
        points: rows.map((sample) => ({
          day: sample.day,
          mushroomCount: sample.mushroomCount,
          matureCount: sample.matureCount,
          capDiameterMean: sample.diameter,
          sampleCount: 1,
        })),
        cameras: [
          {
            cameraCode: rows[0].cameraCode,
            points: rows.map((sample) => ({
              day: sample.day,
              mushroomCount: sample.mushroomCount,
              matureCount: sample.matureCount,
              capDiameterMean: sample.diameter,
              sampleCount: 1,
            })),
          },
        ],
      };
    }),
  };
  const gap = assertShedGap(series, samples);
  assert.equal(gap.latest, '2026-10-15');
  assert.equal(gap.s01, 21);
  assert.equal(gap.s02, 8);
  assert.ok(gap.s01 > gap.s02);
  const flat = {
    sheds: series.sheds.map((shed) => ({
      ...shed,
      points: shed.points.map((point) =>
        point.day === '2026-10-15' ? { ...point, mushroomCount: 21 } : point,
      ),
    })),
  };
  assert.throws(() => assertShedGap(flat, samples), /没有高于/);
  assert.throws(
    () => assertShedGap({ sheds: series.sheds.filter((shed) => shed.shedCode === 'S01') }, samples),
    /没有棚区 S02/,
  );
});

test('proof prints both sheds and the compare page urls', () => {
  const samples = buildComparePayloads(now);
  const proof = formatCompareProof({
    samples,
    duplicates: new Map(samples.map((sample) => [sample.body.idempotencyKey, false])),
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /棚间对比: 2 个棚/);
  assert.match(proof, /CAM-SG-S01/);
  assert.match(proof, /CAM-SG-S02/);
  assert.match(proof, /当天: 2026-10-15 S01 蘑菇 21，S02 蘑菇 8/);
  assert.match(proof, /2026-10-10 S01 CAM-SG-S01: 蘑菇 8，成熟 2/);
  assert.match(proof, /2026-10-10 S02 CAM-SG-S02: 蘑菇 3，成熟 1/);
  assert.match(proof, /2026-10-15 S02 CAM-SG-S02: 蘑菇 8，成熟 3/);
  const open = compareUrl({ days: 7 }, 'http://127.0.0.1:43123');
  const month = compareUrl({ days: 30 }, 'http://127.0.0.1:43123');
  assert.match(proof, new RegExp(open.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(proof, new RegExp(month.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(open, /\/growth-compare\?days=7/);
  assert.doesNotMatch(open, /shedCode=/);
  assert.doesNotMatch(proof, /CAM-DEMO-01|CAM-GT-01/);
});

test('make target and the demo doc name both sheds on one screen', () => {
  const root = repoRoot();
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  assert.match(
    makefile,
    /^demo-shed-growth-compare:.*\n\tnode scripts\/demo-shed-growth-compare\.mjs\s*$/m,
  );
  assert.match(makefile, /scripts\/demo-shed-growth-compare\.spec\.mjs/);
  const doc = readFileSync(join(root, 'docs/DEMO_SHED_GROWTH_COMPARE.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const trend = readFileSync(join(root, 'docs/DEMO_GROWTH_TREND.md'), 'utf8');
  assert.match(doc, /make demo-shed-growth-compare/);
  assert.match(doc, /CAM-SG-S01/);
  assert.match(doc, /CAM-SG-S02/);
  assert.match(doc, /S01/);
  assert.match(doc, /S02/);
  assert.match(doc, /21/);
  assert.match(doc, /蘑菇 8/);
  assert.match(doc, /同屏/);
  assert.match(doc, /验收/);
  assert.match(doc, /截图/);
  assert.match(doc, /\/growth-compare/);
  assert.match(caps, /DEMO_SHED_GROWTH_COMPARE\.md/);
  assert.match(caps, /make demo-shed-growth-compare/);
  assert.match(trend, /make demo-growth-trend/);
  assert.match(trend, /CAM-GT-01/);
  assert.doesNotMatch(doc, /假定|假设/);
  assert.doesNotMatch(trend, /CAM-SG-S01|demo-shed-growth-compare/);
  const untouched = [
    'scripts/demo-growth-trend.mjs',
    'scripts/demo-env-filter.mjs',
    'scripts/demo-harvest-list.mjs',
    'packages/contracts/fixtures/recognition.demo-growth-trend.json',
    'packages/contracts/fixtures/recognition.demo-one.json',
  ];
  for (const file of untouched) {
    const source = readFileSync(join(root, file), 'utf8');
    assert.doesNotMatch(source, /CAM-SG-S01|demo-shed-growth-compare/);
  }
  const ingest = readFileSync(join(root, 'apps/api/src/ingest/ingest.service.ts'), 'utf8');
  assert.doesNotMatch(ingest, /demo-shed-growth-compare|CAM-SG-S01/);
});
