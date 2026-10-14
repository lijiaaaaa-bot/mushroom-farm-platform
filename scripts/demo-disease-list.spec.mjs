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
  CONTRAST_LEVEL,
  DEMO_CAMERA,
  DEMO_COUNT,
  DEMO_LEVEL,
  DEMO_SHED,
  assertContrastEmpty,
  assertDiseaseDetail,
  assertDiseaseRow,
  buildDiseasePayload,
  diseaseDetailUrl,
  diseaseListUrl,
  formatDiseaseProof,
} from './demo-disease-list.mjs';

const now = new Date('2026-10-14T01:02:03.004Z');
const id = '77777777-7777-4777-8777-777777777777';

function listedRow(overrides = {}) {
  const body = buildDiseasePayload(now);
  return {
    id,
    shedCode: DEMO_SHED,
    cameraCode: DEMO_CAMERA,
    recognizedAt: body.recognizedAt,
    diseaseLevel: DEMO_LEVEL,
    diseaseCount: DEMO_COUNT,
    snapshotObjectKey: 'snapshots/S01/demo.jpg',
    snapshotUrl: null,
    ...overrides,
  };
}

test('payload keeps the fixture file and changes only this request', () => {
  const fixture = readFixture(DEMO_FIXTURE);
  assert.equal(fixture.body.cameraCode, FIXTURE_CAMERA);
  assert.equal(fixture.body.cameraCode, 'CAM-DEMO-01');
  assert.equal(fixture.body.diseaseCount, 1);
  assert.equal(fixture.body.diseaseLevel, 1);
  const body = buildDiseasePayload(now);
  assert.equal(body.cameraCode, DEMO_CAMERA);
  assert.equal(body.shedCode, DEMO_SHED);
  assert.equal(body.diseaseCount, DEMO_COUNT);
  assert.equal(body.diseaseLevel, DEMO_LEVEL);
  assert.equal(body.recognizedAt, now.toISOString());
  assert.match(body.idempotencyKey, /^demo-disease-list-\d+$/);
  assert.equal(body.temperature, fixture.body.temperature);
  assert.equal(body.snapshotBase64, fixture.body.snapshotBase64);
  assert.notEqual(body.cameraCode, fixture.body.cameraCode);
  assert.notEqual(body.diseaseCount, fixture.body.diseaseCount);
  const canonical = validateDemoPayload(body, now);
  assert.equal(canonical.cameraCode, DEMO_CAMERA);
  assert.equal(canonical.diseaseCount, DEMO_COUNT);
  assert.equal(canonical.diseaseLevel, DEMO_LEVEL);
  assert.equal(readFixture(DEMO_FIXTURE).body.cameraCode, 'CAM-DEMO-01');
});

test('proof prints the list, the detail and the empty contrast', () => {
  const row = listedRow();
  assertDiseaseRow(row, buildDiseasePayload(now));
  assertDiseaseDetail({ ...row }, row);
  assertContrastEmpty({ items: [], total: 0 }, id);
  assert.throws(() => assertContrastEmpty({ items: [row], total: 1 }, id), /对照列表/);
  assert.throws(() => assertDiseaseRow({ ...row, diseaseCount: 0 }, buildDiseasePayload(now)), /病害数量/);
  const proof = formatDiseaseProof({
    id,
    row,
    webOrigin: 'http://127.0.0.1:43123',
    snapshotObjectKey: row.snapshotObjectKey,
  });
  assert.match(proof, /病害记录: 新建/);
  assert.match(proof, new RegExp(`id: ${id}`));
  assert.match(proof, /棚区: S01/);
  assert.match(proof, /位置: CAM-DIS-01/);
  assert.match(proof, /病害等级: 1/);
  assert.match(proof, /病害数量: 2/);
  assert.match(proof, /图片: 有/);
  assert.match(proof, /病害列表: http:\/\/127\.0\.0\.1:43123\/diseases\?cameraCode=CAM-DIS-01/);
  assert.match(
    proof,
    new RegExp(`病害详情: ${diseaseDetailUrl(id, 'http://127.0.0.1:43123').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
  );
  assert.match(
    proof,
    new RegExp(
      diseaseListUrl(
        { cameraCode: DEMO_CAMERA, diseaseLevel: CONTRAST_LEVEL },
        'http://127.0.0.1:43123',
      ).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    ),
  );
  assert.match(proof, /diseaseLevel=3/);
  assert.doesNotMatch(proof, /CAM-DEMO-01/);
});

test('make target and the demo doc name the list and the detail', () => {
  const root = repoRoot();
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  assert.match(makefile, /^demo-disease-list:.*\n\tnode scripts\/demo-disease-list\.mjs\s*$/m);
  assert.match(makefile, /scripts\/demo-disease-list\.spec\.mjs/);
  const doc = readFileSync(join(root, 'docs/DEMO_DISEASE_LIST.md'), 'utf8');
  assert.match(doc, /make demo-disease-list/);
  assert.match(doc, /CAM-DIS-01/);
  assert.match(doc, /病害列表/);
  assert.match(doc, /病害详情/);
  assert.match(doc, /对照列表/);
  assert.match(doc, /没有符合条件的病害记录/);
  assert.match(doc, /时间/);
  assert.match(doc, /棚区/);
  assert.match(doc, /位置/);
  assert.match(doc, /病害等级/);
  assert.match(doc, /病害图片/);
  assert.doesNotMatch(doc, /假定|假设/);
});
