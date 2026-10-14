import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { readFixture, repoRoot } from './lib/ingest-wire.mjs';
import {
  DEMO_CAMERA as FIXTURE_CAMERA,
  DEMO_FIXTURE,
  validateDemoPayload,
} from './demo-one-http-recognition.mjs';
import {
  S01_CAMERA,
  S01_MATURE,
  S01_MUSHROOM,
  S01_SHED,
  S02_CAMERA,
  S02_MATURE,
  S02_MUSHROOM,
  S02_SHED,
  assertNarrowPage,
  assertShedPage,
  assertSummarySmaller,
  assertWidePage,
  buildHarvestFilterPayload,
  filterWindow,
  formatHarvestFilterProof,
  harvestFilterUrl,
} from './demo-harvest-filter.mjs';

const now = new Date('2026-10-14T08:00:00.000Z');
const window = filterWindow(now);

function page(items, matureCount) {
  return {
    items,
    summary: {
      matureCount,
      mushroomCount: items.reduce((sum, item) => sum + item.mushroomCount, 0),
    },
  };
}

const s01 = {
  id: 's01',
  shedCode: S01_SHED,
  cameraCode: S01_CAMERA,
  matureCount: S01_MATURE,
  mushroomCount: S01_MUSHROOM,
  recognizedAt: window.older.toISOString(),
};
const s02 = {
  id: 's02',
  shedCode: S02_SHED,
  cameraCode: S02_CAMERA,
  matureCount: S02_MATURE,
  mushroomCount: S02_MUSHROOM,
  recognizedAt: window.now.toISOString(),
};

test('payloads keep the fixture file and place the two sheds three hours apart', () => {
  const fixture = readFixture(DEMO_FIXTURE);
  assert.equal(fixture.body.cameraCode, FIXTURE_CAMERA);
  assert.equal(fixture.body.matureCount, S01_MATURE);
  assert.equal(fixture.body.mushroomCount, S01_MUSHROOM);
  const older = buildHarvestFilterPayload(now, {
    shedCode: S01_SHED,
    cameraCode: S01_CAMERA,
    recognizedAt: window.older,
    matureCount: S01_MATURE,
    mushroomCount: S01_MUSHROOM,
    key: `demo-harvest-filter-s01-${now.getTime()}`,
  });
  const recent = buildHarvestFilterPayload(now, {
    shedCode: S02_SHED,
    cameraCode: S02_CAMERA,
    recognizedAt: window.now,
    matureCount: S02_MATURE,
    mushroomCount: S02_MUSHROOM,
    key: `demo-harvest-filter-s02-${now.getTime()}`,
  });
  assert.equal(older.cameraCode, S01_CAMERA);
  assert.equal(older.shedCode, S01_SHED);
  assert.equal(older.recognizedAt, window.older.toISOString());
  assert.equal(older.matureCount, S01_MATURE);
  assert.equal(recent.shedCode, S02_SHED);
  assert.equal(recent.cameraCode, S02_CAMERA);
  assert.equal(recent.matureCount, S02_MATURE);
  assert.equal(recent.mushroomCount, S02_MUSHROOM);
  assert.equal(recent.recognizedAt, now.toISOString());
  assert.notEqual(older.cameraCode, fixture.body.cameraCode);
  assert.equal(older.diseaseCount, fixture.body.diseaseCount);
  assert.equal(recent.temperature, fixture.body.temperature);
  validateDemoPayload(older, now);
  validateDemoPayload(recent, now);
  assert.equal(readFixture(DEMO_FIXTURE).body.cameraCode, 'CAM-DEMO-01');
  assert.ok(window.wideFrom.getTime() <= window.older.getTime());
  assert.ok(window.older.getTime() < window.narrowFrom.getTime());
  assert.ok(window.narrowFrom.getTime() <= now.getTime());
  assert.ok(now.getTime() <= window.to.getTime());
});

test('shed and narrow windows are shorter than the wide window', () => {
  const wide = page([s01, s02], S01_MATURE + S02_MATURE);
  const shed = page([s01], S01_MATURE);
  const narrow = page([s02], S02_MATURE);
  const wideCount = assertWidePage(wide, s01, s02);
  assert.equal(wideCount, 2);
  assert.equal(assertShedPage(shed, s01, s02, wideCount), 1);
  assert.equal(assertNarrowPage(narrow, s01, s02, wideCount), 1);
  assertSummarySmaller(shed, wide, '棚区 S01');
  assertSummarySmaller(narrow, wide, '窄窗口');
  assert.throws(() => assertShedPage(wide, s01, s02, wideCount), /S02/);
  assert.throws(() => assertNarrowPage(wide, s01, s02, wideCount), /CAM-HF-S01/);
  assert.throws(() => assertSummarySmaller(wide, shed, '反过来'), /成熟数/);
});

test('proof prints the all-shed, S01, and narrow urls', () => {
  const proof = formatHarvestFilterProof({
    s01: { id: s01.id, recognizedAt: s01.recognizedAt },
    s02: { id: s02.id, recognizedAt: s02.recognizedAt },
    window,
    wideCount: 2,
    shedCount: 1,
    narrowCount: 1,
    webOrigin: 'http://127.0.0.1:43123',
  });
  const allUrl = harvestFilterUrl(
    { from: window.wideFrom, to: window.to },
    'http://127.0.0.1:43123',
  );
  const shedUrl = harvestFilterUrl(
    { from: window.wideFrom, to: window.to, shedCode: S01_SHED },
    'http://127.0.0.1:43123',
  );
  const narrowUrl = harvestFilterUrl(
    { from: window.narrowFrom, to: window.to },
    'http://127.0.0.1:43123',
  );
  assert.match(proof, /采摘筛选: 新建/);
  assert.match(proof, /棚区 S01 条数: 1/);
  assert.match(proof, /窄窗口条数: 1/);
  assert.match(proof, /宽窗口条数: 2/);
  assert.match(proof, new RegExp(`全部棚区: ${allUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(proof, new RegExp(`棚区 S01: ${shedUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(proof, new RegExp(`窄窗口: ${narrowUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(allUrl, /from=/);
  assert.match(allUrl, /to=/);
  assert.doesNotMatch(allUrl, /shedCode=/);
  assert.match(shedUrl, /shedCode=S01/);
  assert.notEqual(shedUrl, allUrl);
  assert.notEqual(narrowUrl, allUrl);
  assert.doesNotMatch(proof, /CAM-DEMO-01/);
});

test('make target and the demo doc name the shed and the time window', () => {
  const root = repoRoot();
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  assert.match(makefile, /^demo-harvest-filter:.*\n\tnode scripts\/demo-harvest-filter\.mjs\s*$/m);
  assert.match(makefile, /scripts\/demo-harvest-filter\.spec\.mjs/);
  const doc = readFileSync(join(root, 'docs/DEMO_HARVEST_FILTER.md'), 'utf8');
  assert.match(doc, /make demo-harvest-filter/);
  assert.match(doc, /CAM-HF-S01/);
  assert.match(doc, /CAM-HF-S02/);
  assert.match(doc, /S01/);
  assert.match(doc, /S02/);
  assert.match(doc, /全部棚区/);
  assert.match(doc, /棚区 S01/);
  assert.match(doc, /窄窗口/);
  assert.match(doc, /共 /);
  assert.match(doc, /时间筛选无效/);
  assert.doesNotMatch(doc, /假定|假设/);
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  assert.match(caps, /make demo-harvest-filter/);
  assert.match(caps, /shedCode/);
  assert.match(caps, /CAM-HF-S01/);
  assert.match(caps, /CAM-HF-S02/);
});
