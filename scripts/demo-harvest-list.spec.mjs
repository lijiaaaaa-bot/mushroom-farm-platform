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
  CONTRAST_CAMERA,
  DEMO_CAMERA,
  DEMO_DIAMETER,
  DEMO_MATURE,
  DEMO_MUSHROOM,
  DEMO_SHED,
  assertContrastEmpty,
  assertHarvestDetail,
  assertHarvestRow,
  buildHarvestPayload,
  formatHarvestProof,
  harvestDetailUrl,
  harvestListUrl,
  shanghaiDay,
} from './demo-harvest-list.mjs';

const now = new Date('2026-10-14T01:02:03.004Z');
const id = '88888888-8888-4888-8888-888888888888';

function listedRow(overrides = {}) {
  const body = buildHarvestPayload(now);
  return {
    id,
    shedCode: DEMO_SHED,
    cameraCode: DEMO_CAMERA,
    recognizedAt: body.recognizedAt,
    matureCount: body.matureCount,
    mushroomCount: body.mushroomCount,
    avgCapDiameter: DEMO_DIAMETER,
    ...overrides,
  };
}

test('payload keeps the fixture counts and changes only this request camera', () => {
  const fixture = readFixture(DEMO_FIXTURE);
  assert.equal(fixture.body.cameraCode, FIXTURE_CAMERA);
  assert.equal(fixture.body.cameraCode, 'CAM-DEMO-01');
  assert.equal(fixture.body.matureCount, DEMO_MATURE);
  assert.equal(fixture.body.mushroomCount, DEMO_MUSHROOM);
  const body = buildHarvestPayload(now);
  assert.equal(body.cameraCode, DEMO_CAMERA);
  assert.equal(body.shedCode, DEMO_SHED);
  assert.equal(body.matureCount, DEMO_MATURE);
  assert.equal(body.mushroomCount, DEMO_MUSHROOM);
  assert.equal(body.recognizedAt, now.toISOString());
  assert.match(body.idempotencyKey, /^demo-harvest-list-\d+$/);
  assert.equal(body.temperature, fixture.body.temperature);
  assert.equal(body.snapshotBase64, fixture.body.snapshotBase64);
  assert.notEqual(body.cameraCode, fixture.body.cameraCode);
  assert.deepEqual(body.capDiameters, fixture.body.capDiameters);
  const canonical = validateDemoPayload(body, now);
  assert.equal(canonical.cameraCode, DEMO_CAMERA);
  assert.equal(canonical.matureCount, DEMO_MATURE);
  assert.equal(readFixture(DEMO_FIXTURE).body.cameraCode, 'CAM-DEMO-01');
  assert.equal(shanghaiDay(now), '2026-10-14');
});

test('proof prints the list, the detail and the empty contrast', () => {
  const row = listedRow();
  const body = buildHarvestPayload(now);
  assertHarvestRow(row, body);
  assertHarvestDetail({ ...row }, row);
  assertContrastEmpty({ items: [], summary: { matureCount: 0, mushroomCount: 0 } }, id);
  assert.throws(
    () => assertContrastEmpty({ items: [row], summary: { matureCount: 5, mushroomCount: 12 } }, id),
    /对照列表/,
  );
  assert.throws(() => assertHarvestRow({ ...row, matureCount: 0 }, body), /成熟数/);
  assert.throws(
    () => assertHarvestDetail({ ...row, avgCapDiameter: null }, row),
    /菌盖直径/,
  );
  const proof = formatHarvestProof({
    id,
    row,
    date: '2026-10-14',
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /采摘记录: 新建/);
  assert.match(proof, new RegExp(`id: ${id}`));
  assert.match(proof, /棚区: S01/);
  assert.match(proof, /摄像头: CAM-HAR-01/);
  assert.match(proof, /成熟数: 5/);
  assert.match(proof, /蘑菇数: 12/);
  assert.match(proof, /菌盖直径: 4\.7/);
  assert.match(
    proof,
    new RegExp(harvestListUrl({ date: '2026-10-14', cameraCode: DEMO_CAMERA }, 'http://127.0.0.1:43123').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
  assert.match(
    proof,
    new RegExp(
      harvestDetailUrl(id, { date: '2026-10-14', cameraCode: DEMO_CAMERA }, 'http://127.0.0.1:43123').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    ),
  );
  assert.match(
    proof,
    new RegExp(
      harvestListUrl({ date: '2026-10-14', cameraCode: CONTRAST_CAMERA }, 'http://127.0.0.1:43123').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    ),
  );
  assert.doesNotMatch(proof, /CAM-DEMO-01/);
});

test('make target and the demo doc name the list and the detail', () => {
  const root = repoRoot();
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  assert.match(makefile, /^demo-harvest-list:.*\n\tnode scripts\/demo-harvest-list\.mjs\s*$/m);
  assert.match(makefile, /scripts\/demo-harvest-list\.spec\.mjs/);
  const doc = readFileSync(join(root, 'docs/DEMO_HARVEST_LIST.md'), 'utf8');
  assert.match(doc, /make demo-harvest-list/);
  assert.match(doc, /CAM-HAR-01/);
  assert.match(doc, /CAM-HAR-NONE/);
  assert.match(doc, /采摘列表/);
  assert.match(doc, /采摘详情/);
  assert.match(doc, /对照列表/);
  assert.match(doc, /没有符合条件的采摘记录/);
  assert.match(doc, /时间/);
  assert.match(doc, /棚区/);
  assert.match(doc, /摄像头/);
  assert.match(doc, /成熟数/);
  assert.match(doc, /蘑菇数/);
  assert.match(doc, /菌盖直径/);
  assert.doesNotMatch(doc, /假定|假设/);
});
