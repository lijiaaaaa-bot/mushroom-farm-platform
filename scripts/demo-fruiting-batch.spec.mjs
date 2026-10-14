import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { readFixture, repoRoot } from './lib/ingest-wire.mjs';
import { DEMO_CAMERA as FIXTURE_CAMERA, DEMO_FIXTURE as ONE_FIXTURE } from './demo-one-http-recognition.mjs';
import {
  DEMO_BATCH,
  DEMO_CAMERA,
  DEMO_FIXTURE,
  DEMO_SHED,
  PHASE_LABEL,
  assertFruitingReplay,
  batchesPageUrl,
  buildFruitingSamples,
  diameterFor,
  formatFruitingProof,
  nextPhasePosts,
  phaseInstant,
  validateFruitingSamples,
} from './demo-fruiting-batch.mjs';

const now = new Date('2026-10-14T01:02:03.004Z');

test('payload keeps three rising days on CAM-FB-01 and leaves the one-ingest fixture', () => {
  const fixture = readFixture(DEMO_FIXTURE);
  assert.equal(fixture.cameraCode, DEMO_CAMERA);
  assert.equal(fixture.shedCode, DEMO_SHED);
  assert.equal(fixture.batchCode, DEMO_BATCH);
  assert.equal(fixture.diseaseCount, 0);
  assert.equal(fixture.temperature, 22.5);
  assert.deepEqual(
    fixture.points.map((point) => [point.offsetDays, point.mushroomCount, point.matureCount]),
    [
      [5, 11, 2],
      [2, 18, 6],
      [0, 27, 11],
    ],
  );
  const one = readFixture(ONE_FIXTURE);
  assert.equal(one.body.cameraCode, FIXTURE_CAMERA);
  assert.equal(one.body.cameraCode, 'CAM-DEMO-01');
  const samples = buildFruitingSamples(now);
  assert.deepEqual(
    samples.map((sample) => sample.day),
    ['2026-10-09', '2026-10-12', '2026-10-14'],
  );
  assert.deepEqual(
    samples.map((sample) => sample.mushroomCount),
    [11, 18, 27],
  );
  for (const sample of samples) {
    assert.equal(sample.diameter, diameterFor(sample.day, sample.offsetDays));
    assert.equal(sample.body.cameraCode, DEMO_CAMERA);
    assert.notEqual(sample.body.cameraCode, 'CAM-DEMO-01');
    assert.notEqual(sample.body.cameraCode, 'CAM-HT-01');
  }
  const again = buildFruitingSamples(now);
  assert.deepEqual(
    again.map((sample) => sample.body.idempotencyKey),
    samples.map((sample) => sample.body.idempotencyKey),
  );
  validateFruitingSamples(samples, now);
  assert.equal(readFixture(ONE_FIXTURE).body.cameraCode, 'CAM-DEMO-01');
  assert.equal(readFixture(DEMO_FIXTURE).cameraCode, DEMO_CAMERA);
});

test('phase posts move flush to fast growth then mature, and a complete batch is left alone', () => {
  const startedAt = '2026-10-09T01:02:03.004Z';
  assert.deepEqual(nextPhasePosts([{ phase: 'flush' }], 'flush', null), ['fast_growth', 'mature']);
  assert.deepEqual(
    nextPhasePosts(
      [{ phase: 'flush' }, { phase: 'fast_growth' }, { phase: 'mature' }],
      'mature',
      null,
    ),
    [],
  );
  assert.deepEqual(
    nextPhasePosts([{ phase: 'flush' }, { phase: 'fast_growth' }], 'fast_growth', null),
    ['mature'],
  );
  assert.deepEqual(nextPhasePosts([{ phase: 'flush' }], 'flush', '2026-10-14T00:00:00.000Z'), []);
  const fast = phaseInstant(now, 'fast_growth', startedAt);
  const mature = phaseInstant(now, 'mature', startedAt);
  assert.ok(fast.getTime() >= Date.parse(startedAt));
  assert.ok(mature.getTime() > fast.getTime());
  assert.ok(mature.getTime() <= now.getTime());
});

test('proof prints the shed, the batch, the phases and a replay url', () => {
  const samples = buildFruitingSamples(now);
  const replay = {
    batch: {
      id: 'batch-1',
      shedCode: DEMO_SHED,
      batchCode: DEMO_BATCH,
      startedAt: samples[0].body.recognizedAt,
      phase: 'mature',
      closedAt: null,
    },
    phases: [
      { phase: 'flush', occurredAt: '2026-10-09T01:02:03.004Z' },
      { phase: 'fast_growth', occurredAt: '2026-10-11T01:02:03.004Z' },
      { phase: 'mature', occurredAt: '2026-10-13T01:02:03.004Z' },
    ],
    curve: samples.map((sample) => ({
      day: sample.day,
      mushroomCount: sample.mushroomCount,
      matureCount: sample.matureCount,
      capDiameterMean: Math.round(sample.diameter * 10) / 10,
    })),
  };
  const checked = assertFruitingReplay(replay, samples);
  assert.throws(() => assertFruitingReplay({ ...replay, curve: [] }, samples), /至少要 2 天/);
  assert.throws(
    () => assertFruitingReplay({ ...replay, phases: replay.phases.slice(0, 1) }, samples),
    /快速生长|成熟/,
  );
  const proof = formatFruitingProof({
    ...checked,
    phaseWrites: { flush: '新建', fast_growth: '新建', mature: '新建' },
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /棚区: S01/);
  assert.match(proof, /批次: FB-DEMO-01/);
  assert.match(proof, /当前阶段: 成熟/);
  assert.match(proof, /阶段记录: 出菇（新建） → 快速生长（新建） → 成熟（新建）/);
  assert.match(proof, /阶段: 出菇 2026-10-09 → 快速生长 2026-10-11 → 成熟 2026-10-13/);
  assert.match(proof, /回放: 2026-10-09 至 2026-10-14，共 3 天/);
  assert.match(proof, /2026-10-09: 蘑菇 11，成熟 2/);
  assert.match(proof, /2026-10-14: 蘑菇 27，成熟 11/);
  const open = batchesPageUrl(DEMO_BATCH, 'http://127.0.0.1:43123');
  assert.equal(open, 'http://127.0.0.1:43123/batches?batchCode=FB-DEMO-01');
  assert.match(proof, /打开: http:\/\/127\.0\.0\.1:43123\/batches\?batchCode=FB-DEMO-01/);
  assert.equal(PHASE_LABEL.fast_growth, '快速生长');
  assert.doesNotMatch(proof, /CAM-DEMO-01/);
});

test('make target and the demo doc name the list, the phases and the replay', () => {
  const root = repoRoot();
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  assert.match(makefile, /^demo-fruiting-batch:.*\n\tnode scripts\/demo-fruiting-batch\.mjs\s*$/m);
  assert.match(makefile, /scripts\/demo-fruiting-batch\.spec\.mjs/);
  const doc = readFileSync(join(root, 'docs/DEMO_FRUITING_BATCH.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  assert.match(doc, /make demo-fruiting-batch/);
  assert.match(doc, /FB-DEMO-01/);
  assert.match(doc, /S01/);
  assert.match(doc, /出菇/);
  assert.match(doc, /快速生长/);
  assert.match(doc, /成熟/);
  assert.match(doc, /回放/);
  assert.match(doc, /docs\/evidence\/demo-fruiting-batch\/list\.png/);
  assert.match(doc, /docs\/evidence\/demo-fruiting-batch\/phases\.png/);
  assert.match(doc, /docs\/evidence\/demo-fruiting-batch\/replay\.png/);
  assert.match(doc, /验收/);
  assert.match(caps, /DEMO_FRUITING_BATCH\.md/);
  assert.match(caps, /make demo-fruiting-batch/);
  assert.doesNotMatch(doc, /假定|假设/);
  const untouched = [
    'scripts/demo-harvest-task.mjs',
    'scripts/demo-harvest-list.mjs',
    'scripts/demo-harvest-filter.mjs',
    'docs/DEMO_HARVEST_TASK.md',
    'docs/DEMO_HARVEST_LIST.md',
    'docs/DEMO_HARVEST_FILTER.md',
  ];
  for (const file of untouched) {
    const source = readFileSync(join(root, file), 'utf8');
    assert.doesNotMatch(source, /FB-DEMO-01|demo-fruiting-batch|CAM-FB-01/);
  }
});
