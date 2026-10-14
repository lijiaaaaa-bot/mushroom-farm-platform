import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { readFixture, repoRoot } from './lib/ingest-wire.mjs';
import { DEMO_CAMERA as FIXTURE_CAMERA, DEMO_FIXTURE as ONE_FIXTURE } from './demo-one-http-recognition.mjs';
import {
  DEMO_ALGORITHM,
  DEMO_CAMERA,
  DEMO_FIXTURE,
  DEMO_METHOD,
  DEMO_SHED,
  assertForecastDays,
  buildYieldPayloads,
  formatYieldProof,
  harvestForecastUrl,
  projectSeed,
  validateYieldPayloads,
} from './demo-yield-forecast.mjs';

const now = new Date('2026-10-14T01:02:03.004Z');

test('payload keeps three rising mature days on CAM-YF-01 and leaves the one-ingest fixture', () => {
  const fixture = readFixture(DEMO_FIXTURE);
  assert.equal(fixture.cameraCode, DEMO_CAMERA);
  assert.equal(fixture.shedCode, DEMO_SHED);
  assert.equal(fixture.diseaseCount, 0);
  assert.equal(fixture.temperature, 22.5);
  assert.deepEqual(
    fixture.points.map((point) => [point.offsetDays, point.mushroomCount, point.matureCount]),
    [
      [6, 12, 4],
      [3, 18, 8],
      [0, 24, 12],
    ],
  );
  const one = readFixture(ONE_FIXTURE);
  assert.equal(one.body.cameraCode, FIXTURE_CAMERA);
  assert.equal(one.body.cameraCode, 'CAM-DEMO-01');
  const samples = buildYieldPayloads(now);
  assert.deepEqual(
    samples.map((sample) => sample.day),
    ['2026-10-08', '2026-10-11', '2026-10-14'],
  );
  assert.deepEqual(
    samples.map((sample) => sample.matureCount),
    [4, 8, 12],
  );
  for (const sample of samples) {
    assert.equal(sample.body.cameraCode, DEMO_CAMERA);
    assert.notEqual(sample.body.cameraCode, 'CAM-DEMO-01');
    assert.ok(sample.matureCount / sample.mushroomCount < 0.6);
  }
  const again = buildYieldPayloads(now);
  assert.deepEqual(
    again.map((sample) => sample.body.idempotencyKey),
    samples.map((sample) => sample.body.idempotencyKey),
  );
  validateYieldPayloads(samples, now);
  assert.equal(readFixture(ONE_FIXTURE).body.cameraCode, 'CAM-DEMO-01');
  assert.equal(readFixture(DEMO_FIXTURE).cameraCode, DEMO_CAMERA);
});

test('seed projection is three future mature counts', () => {
  const samples = buildYieldPayloads(now);
  const seeded = projectSeed(samples, '2026-10-14');
  assert.equal(seeded.historyDays, 3);
  assert.equal(seeded.spanDays, 6);
  assert.equal(seeded.from, '2026-10-08');
  assert.equal(seeded.to, '2026-10-14');
  assert.equal(seeded.speedPerDay, 1.33);
  assert.deepEqual(
    seeded.days.map((day) => [day.date, day.matureCount]),
    [
      ['2026-10-15', 13],
      ['2026-10-16', 15],
      ['2026-10-17', 16],
    ],
  );
});

test('proof prints the algorithm, the span, and future mature counts', () => {
  const samples = buildYieldPayloads(now);
  const forecast = {
    label: '估计',
    sufficient: true,
    method: DEMO_METHOD,
    message: null,
    speedPerDay: 1.33,
    historyDays: 3,
    days: projectSeed(samples, '2026-10-14').days,
  };
  assertForecastDays(forecast);
  const proof = formatYieldProof({
    samples,
    duplicates: new Map(samples.map((sample) => [sample.day, false])),
    forecast,
    yieldEstimate: {
      label: '估计',
      sufficient: false,
      days: [],
      message: '有效历史不足：近 30 个自然日仅有 3 天有成熟识别，满 30 天后才给出近 2–3 日产量估计。',
    },
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, new RegExp(`算法: ${DEMO_ALGORITHM}`));
  assert.match(proof, new RegExp(DEMO_METHOD));
  assert.match(proof, /历史天数: 3/);
  assert.match(proof, /历史跨度: 2026-10-08 至 2026-10-14（间隔 6 天）/);
  assert.match(proof, /每日增速: 1\.33/);
  assert.match(proof, /2026-10-08: 蘑菇 12，成熟 4/);
  assert.match(proof, /2026-10-14: 蘑菇 24，成熟 12/);
  assert.match(proof, /2026-10-15: 估计 13 成熟/);
  assert.match(proof, /2026-10-16: 估计 15 成熟/);
  assert.match(proof, /2026-10-17: 估计 16 成熟/);
  assert.match(proof, /对照: 30 日线性 days 为空/);
  const open = harvestForecastUrl('http://127.0.0.1:43123');
  assert.equal(open, 'http://127.0.0.1:43123/harvest');
  assert.match(proof, new RegExp(open.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(proof, /CAM-DEMO-01/);
  assert.doesNotMatch(proof, /公斤|kg/i);
});

test('empty forecast days are rejected', () => {
  assert.throws(
    () =>
      assertForecastDays({
        label: '估计',
        sufficient: false,
        method: DEMO_METHOD,
        message: '近窗日桶不足',
        historyDays: 1,
        days: [],
      }),
    /近窗日桶不足|days 为空/,
  );
});

test('make target and the demo doc name the estimate and the screenshots', () => {
  const root = repoRoot();
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  assert.match(makefile, /^demo-yield-forecast:.*\n\tnode scripts\/demo-yield-forecast\.mjs\s*$/m);
  assert.match(makefile, /scripts\/demo-yield-forecast\.spec\.mjs/);
  const doc = readFileSync(join(root, 'docs/DEMO_YIELD_FORECAST.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  assert.match(doc, /make demo-yield-forecast/);
  assert.match(doc, /CAM-YF-01/);
  assert.match(doc, /S01/);
  assert.match(doc, /日桶增速/);
  assert.match(doc, /估计/);
  assert.match(doc, /成熟/);
  assert.match(doc, /验收/);
  assert.match(doc, /docs\/evidence\/demo-yield-forecast\/estimate-label\.png/);
  assert.match(doc, /docs\/evidence\/demo-yield-forecast\/future-days\.png/);
  assert.match(doc, /docs\/evidence\/demo-yield-forecast\/thin-history\.png/);
  assert.match(caps, /DEMO_YIELD_FORECAST\.md/);
  assert.match(caps, /make demo-yield-forecast/);
  assert.doesNotMatch(doc, /假定|假设/);
  assert.doesNotMatch(doc, /公斤|kg/i);
  const untouched = [
    'scripts/demo-harvest-list.mjs',
    'scripts/demo-harvest-filter.mjs',
    'scripts/demo-harvest-task.mjs',
    'scripts/demo-fruiting-batch.mjs',
    'scripts/demo-growth-trend.mjs',
    'docs/DEMO_HARVEST_LIST.md',
    'docs/DEMO_HARVEST_FILTER.md',
    'docs/DEMO_HARVEST_TASK.md',
    'docs/DEMO_FRUITING_BATCH.md',
    'docs/DEMO_GROWTH_TREND.md',
  ];
  for (const file of untouched) {
    const source = readFileSync(join(root, file), 'utf8');
    assert.doesNotMatch(source, /CAM-YF-01|demo-yield-forecast/);
  }
  const one = readFileSync(join(root, 'packages/contracts/fixtures/recognition.demo-one.json'), 'utf8');
  assert.match(one, /CAM-DEMO-01/);
  assert.doesNotMatch(one, /CAM-YF-01/);
});
