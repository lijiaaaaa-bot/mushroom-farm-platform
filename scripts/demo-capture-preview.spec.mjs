import assert from 'node:assert/strict';
import test from 'node:test';
import { readFixture } from './lib/ingest-wire.mjs';
import { DEMO_CAMERA as ONE_CAMERA, DEMO_FIXTURE as ONE_FIXTURE } from './demo-one-http-recognition.mjs';
import { DEMO_CAMERA as HIST_CAMERA } from './demo-recognition-history.mjs';
import {
  CAPTURE_POINTS,
  CONTRAST_CAMERA,
  DEMO_CAMERA,
  DEMO_FIXTURE,
  DEMO_SHED,
  assertCaptureEmpty,
  assertCaptureTimeline,
  buildCapturePayloads,
  capturePreviewUrl,
  formatCaptureProof,
  timelineNote,
  validateCapturePayloads,
} from './demo-capture-preview.mjs';

const clocks = [
  new Date('2026-10-16T04:00:00.000Z'),
  new Date('2026-10-05T01:00:00.000Z'),
  new Date('2026-03-01T02:00:00.000Z'),
];

test('CAM-CP-01 writes three snapshots at different times', () => {
  const before = readFixture(DEMO_FIXTURE);
  assert.equal(before.body.cameraCode, 'CAM-DEMO-01');
  assert.equal(before.body.cameraCode, ONE_CAMERA);
  assert.equal(before.body.mushroomCount, 12);
  assert.equal(DEMO_FIXTURE, ONE_FIXTURE);
  assert.equal(DEMO_CAMERA, 'CAM-CP-01');
  assert.equal(DEMO_SHED, 'S01');
  assert.equal(CONTRAST_CAMERA, 'CAM-CP-NONE');
  assert.equal(CAPTURE_POINTS.length, 3);
  assert.notEqual(DEMO_CAMERA, ONE_CAMERA);
  assert.notEqual(DEMO_CAMERA, HIST_CAMERA);
  for (const now of clocks) {
    const sample = buildCapturePayloads(now);
    const again = buildCapturePayloads(now);
    assert.equal(again.stamp, sample.stamp);
    assert.deepEqual(
      again.points.map((point) => point.body.idempotencyKey),
      sample.points.map((point) => point.body.idempotencyKey),
    );
    const checked = validateCapturePayloads(sample, now);
    assert.equal(checked.points.length, 3);
    assert.deepEqual(
      checked.points.map((point) => point.mushroomCount),
      [8, 10, 12],
    );
    assert.deepEqual(
      checked.points.map((point) => point.matureCount),
      [2, 4, 5],
    );
    assert.ok(checked.points.every((point) => point.diseaseCount === 1));
    assert.ok(checked.points.every((point) => point.cameraCode === DEMO_CAMERA));
    assert.ok(sample.points.every((point) => point.body.snapshotBase64 === before.body.snapshotBase64));
  }
  const after = readFixture(DEMO_FIXTURE);
  assert.equal(after.body.cameraCode, 'CAM-DEMO-01');
  assert.equal(after.body.mushroomCount, 12);
  assert.equal(after.body.snapshotBase64, before.body.snapshotBase64);
});

test('proof names the original, the annotation, and three timeline points', () => {
  const now = clocks[0];
  const sample = buildCapturePayloads(now);
  const checked = validateCapturePayloads(sample, now);
  const proof = formatCaptureProof({
    points: checked.points,
    window: checked.window,
    listedCount: 3,
    webOrigin: 'http://127.0.0.1:43123',
  });
  const url = capturePreviewUrl(
    { cameraCode: DEMO_CAMERA, from: checked.window.from, to: checked.window.to },
    'http://127.0.0.1:43123',
  );
  const contrast = capturePreviewUrl(
    { cameraCode: CONTRAST_CAMERA, from: checked.window.from, to: checked.window.to },
    'http://127.0.0.1:43123',
  );
  assert.equal(timelineNote(3), '原始 · 标注 · 时间轴 3 点');
  assert.match(proof, /原始: 抓拍/);
  assert.match(proof, /标注: AI标注/);
  assert.match(proof, /时间轴 3 点/);
  assert.match(proof, /蘑菇数 8/);
  assert.match(proof, /蘑菇数 10/);
  assert.match(proof, /蘑菇数 12/);
  assert.match(url, /\/capture-preview\?/);
  assert.match(url, /cameraCode=CAM-CP-01/);
  assert.match(contrast, /cameraCode=CAM-CP-NONE/);
  assert.doesNotMatch(url, /\/recognitions\?/);
  assert.doesNotMatch(url, /\/big-screen/);
  assert.match(proof, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const items = checked.points.map((point, index) => ({
    id: `id-${index}`,
    cameraCode: point.cameraCode,
    recognizedAt: point.recognizedAt,
    mushroomCount: point.mushroomCount,
    snapshotObjectKey: `snapshots/S01/${index}.jpg`,
  }));
  const found = assertCaptureTimeline(items, { points: checked.points, window: checked.window });
  assert.equal(found.length, 3);
  assertCaptureEmpty([]);
  assert.throws(() => assertCaptureTimeline(items.slice(0, 2), { points: checked.points, window: checked.window }), /至少要 3/);
  assert.throws(() => assertCaptureEmpty([{ id: 'x' }]), /对照摄像头/);
});
