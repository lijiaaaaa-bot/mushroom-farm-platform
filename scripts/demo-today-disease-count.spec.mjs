import assert from 'node:assert/strict';
import test from 'node:test';
import { readFixture } from './lib/ingest-wire.mjs';
import {
  CLEAN_DISEASE_TOTAL,
  CONTRAST_CAMERA,
  DEMO_FIXTURE,
  DEMO_SHED,
  DISEASE_POINTS,
  assertCameraDay,
  assertContrastEmpty,
  assertOverviewDisease,
  buildTodayDiseaseCountPayloads,
  formatTodayDiseaseCountProof,
  shanghaiDayOf,
  todayDiseaseNote,
  validateTodayDiseaseCountPayloads,
} from './demo-today-disease-count.mjs';

const clocks = [
  new Date('2026-10-16T04:00:00.000Z'),
  new Date('2026-10-15T16:02:00.000Z'),
  new Date('2026-10-16T15:58:00.000Z'),
  new Date('2026-03-01T16:00:00.000Z'),
];

test('two cameras write disease counts inside the Shanghai day without touching the fixture', () => {
  const before = readFixture(DEMO_FIXTURE);
  assert.equal(before.body.cameraCode, 'CAM-DEMO-01');
  assert.equal(before.body.mushroomCount, 12);
  assert.equal(before.body.diseaseCount, 1);
  assert.ok(before.body.snapshotBase64);
  for (const now of clocks) {
    const built = buildTodayDiseaseCountPayloads(now);
    validateTodayDiseaseCountPayloads(built, now);
    const { day, start, end } = shanghaiDayOf(now);
    assert.equal(built.day, day);
    assert.equal(built.points.length, 2);
    assert.equal(
      built.points.reduce((sum, point) => sum + point.diseaseCount, 0),
      CLEAN_DISEASE_TOTAL,
    );
    assert.deepEqual(
      built.points.map((point) => point.body.idempotencyKey),
      DISEASE_POINTS.map((point) => `demo-today-disease-count-${point.cameraCode}-${day}`),
    );
    for (const point of built.points) {
      assert.equal(point.body.shedCode, DEMO_SHED);
      assert.equal(point.body.snapshotBase64, undefined);
      assert.equal(point.body.snapshotUrl, undefined);
      const at = new Date(point.body.recognizedAt).getTime();
      assert.ok(at >= new Date(start).getTime());
      assert.ok(at < new Date(end).getTime());
    }
  }
  const after = readFixture(DEMO_FIXTURE);
  assert.equal(after.body.cameraCode, before.body.cameraCode);
  assert.equal(after.body.diseaseCount, before.body.diseaseCount);
  assert.equal(after.body.snapshotBase64, before.body.snapshotBase64);
});

test('overview note is 当日病害总数 and is at least the two disease fields', () => {
  const cameraRows = DISEASE_POINTS.map((point) => ({
    cameraCode: point.cameraCode,
    items: [
      {
        cameraCode: point.cameraCode,
        mushroomCount: point.mushroomCount,
        diseaseCount: point.diseaseCount,
      },
    ],
  }));
  const counts = assertOverviewDisease({ todayDiseaseCount: 3 }, cameraRows);
  assert.deepEqual(counts, { disease: 3, fieldSum: 3 });
  assert.equal(todayDiseaseNote(3), '当日病害总数 3');
  const proof = formatTodayDiseaseCountProof({
    diseaseCount: 8,
    day: '2026-10-16',
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /^当日病害总数 8/);
  assert.match(proof, /CAM-TDC-01: 病害 2/);
  assert.match(proof, /CAM-TDC-02: 病害 1/);
  assert.match(proof, /字段合计: 2 \+ 1 = 3/);
  assert.match(proof, new RegExp(`对照 ${CONTRAST_CAMERA}: 当日病害 0`));
  assert.match(proof, /总览: http:\/\/127\.0\.0\.1:43123\//);
  assert.match(proof, /大屏: http:\/\/127\.0\.0\.1:43123\/big-screen/);
  assert.equal(assertCameraDay(cameraRows[0].items, DISEASE_POINTS[0]).diseaseCount, 2);
  assert.doesNotThrow(() => assertContrastEmpty([]));
  assert.throws(() => assertContrastEmpty([{ cameraCode: CONTRAST_CAMERA }]), /对照摄像头/);
  assert.throws(() => assertOverviewDisease({ todayDiseaseCount: 2 }, cameraRows), /小于/);
  assert.throws(() => assertOverviewDisease({ todayDiseaseCount: 1.5 }, cameraRows), /非负整数/);
});
