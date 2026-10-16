import assert from 'node:assert/strict';
import test from 'node:test';
import { readFixture } from './lib/ingest-wire.mjs';
import {
  CONTRAST_CAMERA,
  DEMO_CAMERA,
  DEMO_FIXTURE,
  DEMO_SHED,
  RECOG_POINTS,
  assertCameraDay,
  assertContrastEmpty,
  assertOverviewCounts,
  buildTodayRecogCapturePayloads,
  formatTodayRecogCaptureProof,
  shanghaiDayOf,
  todayRecogCaptureNote,
  validateTodayRecogCapturePayloads,
} from './demo-today-recog-capture.mjs';

const clocks = [
  new Date('2026-10-16T04:00:00.000Z'),
  new Date('2026-10-15T16:02:00.000Z'),
  new Date('2026-10-16T15:58:00.000Z'),
  new Date('2026-03-01T16:00:00.000Z'),
];

test('CAM-TRC-01 writes two snapshots and one bare row inside the Shanghai day', () => {
  const before = readFixture(DEMO_FIXTURE);
  assert.equal(before.body.cameraCode, 'CAM-DEMO-01');
  assert.equal(before.body.mushroomCount, 12);
  assert.equal(before.body.diseaseCount, 1);
  assert.ok(before.body.snapshotBase64);
  for (const now of clocks) {
    const built = buildTodayRecogCapturePayloads(now);
    validateTodayRecogCapturePayloads(built, now);
    const { day, start, end } = shanghaiDayOf(now);
    assert.equal(built.day, day);
    assert.equal(built.points.length, 3);
    const shots = built.points.filter((point) => point.withSnapshot);
    const bare = built.points.filter((point) => !point.withSnapshot);
    assert.equal(shots.length, 2);
    assert.equal(bare.length, 1);
    assert.equal(bare[0].mushroomCount, 6);
    assert.equal(bare[0].body.snapshotBase64, undefined);
    assert.equal(bare[0].body.snapshotUrl, undefined);
    for (const point of shots) {
      assert.equal(point.body.snapshotBase64, before.body.snapshotBase64);
    }
    const keys = built.points.map((point) => point.body.idempotencyKey);
    assert.deepEqual(keys, [
      `demo-today-recog-capture-shot-a-${day}`,
      `demo-today-recog-capture-shot-b-${day}`,
      `demo-today-recog-capture-bare-${day}`,
    ]);
    for (const point of built.points) {
      assert.equal(point.body.cameraCode, DEMO_CAMERA);
      assert.equal(point.body.shedCode, DEMO_SHED);
      const at = new Date(point.body.recognizedAt).getTime();
      assert.ok(at >= new Date(start).getTime());
      assert.ok(at < new Date(end).getTime());
    }
  }
  const after = readFixture(DEMO_FIXTURE);
  assert.equal(after.body.cameraCode, before.body.cameraCode);
  assert.equal(after.body.snapshotBase64, before.body.snapshotBase64);
  assert.equal(RECOG_POINTS.filter((point) => point.withSnapshot).length, 2);
});

test('overview note matches the two cards and the bare row is not a capture', () => {
  const rows = [
    { cameraCode: DEMO_CAMERA, mushroomCount: 8, snapshotObjectKey: 'snapshots/a.jpg' },
    { cameraCode: DEMO_CAMERA, mushroomCount: 11, snapshotObjectKey: 'snapshots/b.jpg' },
    { cameraCode: DEMO_CAMERA, mushroomCount: 6, snapshotObjectKey: null, snapshotUrl: null },
  ];
  const counts = assertOverviewCounts(
    { todayRecognitionCount: 3, todayCaptureCount: 2 },
    rows,
  );
  assert.deepEqual(counts, { recognition: 3, capture: 2 });
  assert.equal(todayRecogCaptureNote(3, 2), '今日识别次数 3 · 今日抓拍总量 2');
  const proof = formatTodayRecogCaptureProof({
    recognitionCount: 5,
    captureCount: 2,
    day: '2026-10-16',
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /^今日识别次数 5 · 今日抓拍总量 2/);
  assert.match(proof, /摄像头: CAM-TRC-01/);
  assert.match(proof, /无抓拍: 蘑菇 6/);
  assert.match(proof, new RegExp(`对照 ${CONTRAST_CAMERA}: 今日识别 0 · 今日抓拍 0`));
  assert.match(proof, /总览: http:\/\/127\.0\.0\.1:43123\//);
  assert.match(proof, /大屏: http:\/\/127\.0\.0\.1:43123\/big-screen/);
  assert.equal(assertCameraDay(rows).length, 3);
  assert.doesNotThrow(() => assertContrastEmpty([]));
  assert.throws(() => assertContrastEmpty([{ cameraCode: CONTRAST_CAMERA }]), /对照摄像头/);
  assert.throws(
    () => assertOverviewCounts({ todayRecognitionCount: 2, todayCaptureCount: 3 }, rows),
    /大于/,
  );
  assert.throws(
    () => assertOverviewCounts({ todayRecognitionCount: 3, todayCaptureCount: 1 }, rows),
    /小于这台摄像头的 2 条抓拍/,
  );
});
