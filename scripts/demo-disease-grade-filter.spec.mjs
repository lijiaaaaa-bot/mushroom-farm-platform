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
  CLOSE_NOTE,
  MILD_CAMERA,
  MILD_COUNT,
  MILD_LEVEL,
  SEVERE_CAMERA,
  SEVERE_COUNT,
  SEVERE_LEVEL,
  alertsToClose,
  assertBothGrades,
  assertGradeRow,
  assertGradeSplit,
  assertNoOpenAlerts,
  buildGradePayload,
  formatGradeProof,
  gradeListUrl,
} from './demo-disease-grade-filter.mjs';

const mildAt = new Date('2026-10-15T02:03:04.005Z');
const severeAt = new Date(mildAt.getTime() + 1000);
const mildId = '88888888-8888-4888-8888-888888888881';
const severeId = '88888888-8888-4888-8888-888888888882';

function rowFor(kind, overrides = {}) {
  const at = kind === 'mild' ? mildAt : severeAt;
  const body = buildGradePayload(kind, at);
  return {
    id: kind === 'mild' ? mildId : severeId,
    shedCode: 'S01',
    cameraCode: body.cameraCode,
    recognizedAt: body.recognizedAt,
    diseaseLevel: body.diseaseLevel,
    diseaseCount: body.diseaseCount,
    snapshotObjectKey: 'snapshots/S01/demo.jpg',
    snapshotUrl: null,
    ...overrides,
  };
}

test('payload keeps the fixture file and writes two grades', () => {
  const fixture = readFixture(DEMO_FIXTURE);
  assert.equal(fixture.body.cameraCode, FIXTURE_CAMERA);
  assert.equal(fixture.body.cameraCode, 'CAM-DEMO-01');
  assert.equal(fixture.body.diseaseCount, 1);
  assert.equal(fixture.body.diseaseLevel, 1);
  const mild = buildGradePayload('mild', mildAt);
  const severe = buildGradePayload('severe', severeAt);
  assert.equal(mild.cameraCode, MILD_CAMERA);
  assert.equal(mild.shedCode, 'S01');
  assert.equal(mild.diseaseLevel, MILD_LEVEL);
  assert.equal(mild.diseaseCount, MILD_COUNT);
  assert.equal(mild.recognizedAt, mildAt.toISOString());
  assert.match(mild.idempotencyKey, /^demo-disease-grade-mild-\d+$/);
  assert.equal(severe.cameraCode, SEVERE_CAMERA);
  assert.equal(severe.diseaseLevel, SEVERE_LEVEL);
  assert.equal(severe.diseaseCount, SEVERE_COUNT);
  assert.match(severe.idempotencyKey, /^demo-disease-grade-sev-\d+$/);
  assert.notEqual(mild.idempotencyKey, severe.idempotencyKey);
  assert.equal(mild.temperature, fixture.body.temperature);
  assert.equal(severe.temperature, fixture.body.temperature);
  assert.equal(mild.snapshotBase64, fixture.body.snapshotBase64);
  assert.notEqual(mild.cameraCode, fixture.body.cameraCode);
  assert.notEqual(severe.cameraCode, fixture.body.cameraCode);
  assert.notEqual(severe.diseaseLevel, fixture.body.diseaseLevel);
  assert.ok(mild.diseaseCount < 5);
  assert.ok(severe.diseaseCount < 5);
  assert.ok(mild.diseaseLevel < 2);
  const mildCanonical = validateDemoPayload(mild, mildAt);
  const severeCanonical = validateDemoPayload(severe, severeAt);
  assert.equal(mildCanonical.cameraCode, MILD_CAMERA);
  assert.equal(severeCanonical.diseaseLevel, SEVERE_LEVEL);
  assert.equal(readFixture(DEMO_FIXTURE).body.cameraCode, 'CAM-DEMO-01');
  assert.equal(readFixture(DEMO_FIXTURE).body.diseaseLevel, 1);
});

test('mild and severe lists exclude each other', () => {
  const mildBody = buildGradePayload('mild', mildAt);
  const severeBody = buildGradePayload('severe', severeAt);
  const mildRow = rowFor('mild');
  const severeRow = rowFor('severe');
  const otherMild = rowFor('mild', {
    id: '88888888-8888-4888-8888-888888888883',
    cameraCode: 'CAM-DIS-01',
    diseaseCount: 2,
  });
  assertGradeRow(mildRow, mildBody, MILD_CAMERA, MILD_LEVEL, MILD_COUNT);
  assertGradeRow(severeRow, severeBody, SEVERE_CAMERA, SEVERE_LEVEL, SEVERE_COUNT);
  const split = assertGradeSplit({
    mildPage: { items: [mildRow, otherMild], total: 2 },
    severePage: { items: [severeRow], total: 1 },
    mild: { id: mildId, body: mildBody },
    severe: { id: severeId, body: severeBody },
  });
  assert.equal(split.mildRow.cameraCode, MILD_CAMERA);
  assert.equal(split.severeRow.cameraCode, SEVERE_CAMERA);
  assertBothGrades(
    { items: [severeRow, mildRow, otherMild], total: 3 },
    { id: mildId, body: mildBody },
    { id: severeId, body: severeBody },
  );
  assert.throws(
    () =>
      assertGradeSplit({
        mildPage: { items: [mildRow, severeRow], total: 2 },
        severePage: { items: [severeRow], total: 1 },
        mild: { id: mildId, body: mildBody },
        severe: { id: severeId, body: severeBody },
      }),
    /轻度列表仍有/,
  );
  assert.throws(
    () =>
      assertGradeSplit({
        mildPage: { items: [mildRow], total: 1 },
        severePage: { items: [severeRow, mildRow], total: 2 },
        mild: { id: mildId, body: mildBody },
        severe: { id: severeId, body: severeBody },
      }),
    /严重列表仍有/,
  );
  assert.throws(
    () =>
      assertGradeSplit({
        mildPage: { items: [], total: 0 },
        severePage: { items: [severeRow], total: 1 },
        mild: { id: mildId, body: mildBody },
        severe: { id: severeId, body: severeBody },
      }),
    /轻度列表是空的/,
  );
  assert.throws(
    () =>
      assertBothGrades(
        { items: [mildRow], total: 1 },
        { id: mildId, body: mildBody },
        { id: severeId, body: severeBody },
      ),
    /同时出现/,
  );
});

test('only this demo cameras have their open alerts closed', () => {
  const own = { id: 'a1', cameraCode: SEVERE_CAMERA, status: 'open' };
  const acked = { id: 'a2', cameraCode: MILD_CAMERA, status: 'acked' };
  const other = { id: 'a3', cameraCode: 'CAM-ALERT-01', status: 'open' };
  const closed = { id: 'a4', cameraCode: SEVERE_CAMERA, status: 'closed' };
  assert.deepEqual(
    alertsToClose([own, acked, other, closed], SEVERE_CAMERA).map((item) => item.id),
    ['a1'],
  );
  assert.deepEqual(alertsToClose([own, acked, other, closed], MILD_CAMERA).map((item) => item.id), [
    'a2',
  ]);
  assertNoOpenAlerts({ items: [] }, SEVERE_CAMERA);
  assert.throws(() => assertNoOpenAlerts({ items: [own] }, SEVERE_CAMERA), /未闭合告警/);
  assert.equal(CLOSE_NOTE, '病害等级筛选演示后关闭');
});

test('proof prints the mild list, the severe list, and the unfiltered list', () => {
  const mildBody = buildGradePayload('mild', mildAt);
  const severeBody = buildGradePayload('severe', severeAt);
  const proof = formatGradeProof({
    mild: { id: mildId, body: mildBody },
    severe: { id: severeId, body: severeBody },
    closed: 2,
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /轻度: 新建/);
  assert.match(proof, /严重: 新建/);
  assert.match(proof, new RegExp(`轻度 id: ${mildId}`));
  assert.match(proof, new RegExp(`严重 id: ${severeId}`));
  assert.match(proof, /棚区: S01/);
  assert.match(proof, /轻度位置: CAM-DG-MILD/);
  assert.match(proof, /严重位置: CAM-DG-SEV/);
  assert.match(proof, /轻度等级: 1/);
  assert.match(proof, /严重等级: 3/);
  assert.match(proof, /轻度数量: 1/);
  assert.match(proof, /严重数量: 2/);
  assert.match(proof, /关闭告警: 2/);
  assert.match(
    proof,
    new RegExp(
      gradeListUrl({ diseaseLevel: MILD_LEVEL }, 'http://127.0.0.1:43123').replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&',
      ),
    ),
  );
  assert.match(proof, /轻度列表: http:\/\/127\.0\.0\.1:43123\/diseases\?diseaseLevel=1$/m);
  assert.match(proof, /严重列表: http:\/\/127\.0\.0\.1:43123\/diseases\?diseaseLevel=3$/m);
  assert.match(proof, /全部等级: http:\/\/127\.0\.0\.1:43123\/diseases$/m);
  assert.doesNotMatch(proof, /CAM-DEMO-01/);
  assert.doesNotMatch(proof, /CAM-DIS-01/);
});

test('make target and the demo doc name the two grades', () => {
  const root = repoRoot();
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  assert.match(
    makefile,
    /^demo-disease-grade-filter:.*\n\tnode scripts\/demo-disease-grade-filter\.mjs\s*$/m,
  );
  assert.match(makefile, /scripts\/demo-disease-grade-filter\.spec\.mjs/);
  assert.match(makefile, /scripts\/demo-disease-list\.spec\.mjs/);
  const doc = readFileSync(join(root, 'docs/DEMO_DISEASE_GRADE_FILTER.md'), 'utf8');
  assert.match(doc, /make demo-disease-grade-filter/);
  assert.match(doc, /CAM-DG-MILD/);
  assert.match(doc, /CAM-DG-SEV/);
  assert.match(doc, /diseaseLevel=1/);
  assert.match(doc, /diseaseLevel=3/);
  assert.match(doc, /轻度/);
  assert.match(doc, /严重/);
  assert.match(doc, /docs\/evidence\/demo-disease-grade-filter\/mild\.png/);
  assert.match(doc, /docs\/evidence\/demo-disease-grade-filter\/severe\.png/);
  assert.match(doc, /docs\/evidence\/demo-disease-grade-filter\/contrast\.png/);
  assert.match(doc, /make demo-disease-list/);
  assert.match(doc, /CAM-DIS-01/);
  const listDoc = readFileSync(join(root, 'docs/DEMO_DISEASE_LIST.md'), 'utf8');
  assert.match(listDoc, /CAM-DIS-01/);
  assert.match(listDoc, /diseaseLevel=3/);
  assert.match(listDoc, /没有符合条件的病害记录/);
  assert.doesNotMatch(listDoc, /CAM-DG-MILD/);
  assert.doesNotMatch(doc, /假定|假设/);
});
