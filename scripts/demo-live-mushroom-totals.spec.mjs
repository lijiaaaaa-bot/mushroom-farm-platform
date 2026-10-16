import assert from 'node:assert/strict';
import test from 'node:test';
import { readFixture } from './lib/ingest-wire.mjs';
import {
  CONTRAST_CAMERA,
  CONTROL_SHED,
  DEMO_FIXTURE,
  DEMO_SHED,
  LIVE_POINTS,
  assertCameraDay,
  assertContrastEmpty,
  assertOverviewLive,
  buildLiveMushroomTotalsPayloads,
  cleanLiveTotals,
  formatLiveMushroomTotalsProof,
  shanghaiDayOf,
  validateLiveMushroomTotalsPayloads,
} from './demo-live-mushroom-totals.mjs';

const clocks = [
  new Date('2026-10-16T04:00:00.000Z'),
  new Date('2026-10-15T16:02:00.000Z'),
  new Date('2026-10-16T15:58:00.000Z'),
  new Date('2026-03-01T16:00:00.000Z'),
];

test('two S01 cameras and a zero S02 camera stay inside the Shanghai day', () => {
  const before = readFixture(DEMO_FIXTURE);
  assert.equal(before.body.cameraCode, 'CAM-DEMO-01');
  assert.equal(before.body.mushroomCount, 12);
  assert.equal(before.body.diseaseCount, 1);
  assert.ok(before.body.snapshotBase64);
  const clean = cleanLiveTotals();
  assert.deepEqual(clean, {
    liveMushroomTotal: 30,
    liveMatureTotal: 11,
    liveImmatureTotal: 19,
  });
  for (const now of clocks) {
    const built = buildLiveMushroomTotalsPayloads(now);
    validateLiveMushroomTotalsPayloads(built, now);
    const { day, start, end } = shanghaiDayOf(now);
    assert.equal(built.day, day);
    assert.equal(built.points.length, 3);
    assert.equal(built.points[0].shedCode, DEMO_SHED);
    assert.equal(built.points[2].shedCode, CONTROL_SHED);
    assert.equal(built.points[2].mushroomCount, 0);
    assert.equal(built.points[2].matureCount, 0);
    assert.deepEqual(
      built.points.map((point) => point.body.idempotencyKey),
      LIVE_POINTS.map((point) => `demo-live-mushroom-totals-${point.cameraCode}-${day}`),
    );
    for (const point of built.points) {
      assert.equal(point.body.snapshotBase64, undefined);
      assert.equal(point.body.snapshotUrl, undefined);
      assert.equal(point.body.diseaseCount, 0);
      const at = new Date(point.body.recognizedAt).getTime();
      assert.ok(at >= new Date(start).getTime());
      assert.ok(at < new Date(end).getTime());
    }
  }
  const after = readFixture(DEMO_FIXTURE);
  assert.equal(after.body.cameraCode, before.body.cameraCode);
  assert.equal(after.body.mushroomCount, before.body.mushroomCount);
  assert.equal(after.body.diseaseCount, before.body.diseaseCount);
  assert.equal(after.body.snapshotBase64, before.body.snapshotBase64);
});

test('overview note is the three live totals and matches a clean day', () => {
  const cameraRows = LIVE_POINTS.map((point) => ({
    cameraCode: point.cameraCode,
    items: [
      {
        cameraCode: point.cameraCode,
        mushroomCount: point.mushroomCount,
        matureCount: point.matureCount,
      },
    ],
  }));
  const totals = assertOverviewLive(
    {
      liveMushroomTotal: 30,
      liveMatureTotal: 11,
      liveImmatureTotal: 19,
      todayDiseaseCount: 5,
    },
    cameraRows,
  );
  assert.deepEqual(totals, {
    liveMushroomTotal: 30,
    liveMatureTotal: 11,
    liveImmatureTotal: 19,
  });
  const larger = assertOverviewLive(
    {
      liveMushroomTotal: 40,
      liveMatureTotal: 16,
      liveImmatureTotal: 24,
    },
    cameraRows,
  );
  assert.equal(larger.liveMushroomTotal, 40);
  const proof = formatLiveMushroomTotalsProof({
    totals,
    day: '2026-10-16',
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /^在养蘑菇总数 30 · 成熟可采摘总数 11 · 待成熟数量 19/);
  assert.match(proof, /CAM-LMT-01（S01）: 蘑菇 20 · 成熟 8/);
  assert.match(proof, /CAM-LMT-02（S01）: 蘑菇 10 · 成熟 3/);
  assert.match(proof, /S02 CAM-LMT-ZERO: 蘑菇 0 · 成熟 0 · 待成熟 0/);
  assert.match(proof, new RegExp(`对照 ${CONTRAST_CAMERA}: 当天 0 条`));
  assert.match(proof, /总览: http:\/\/127\.0\.0\.1:43123\//);
  assert.match(proof, /大屏: http:\/\/127\.0\.0\.1:43123\/big-screen/);
  assert.equal(assertCameraDay(cameraRows[0].items, LIVE_POINTS[0]).mushroomCount, 20);
  assert.doesNotThrow(() => assertContrastEmpty([]));
  assert.throws(() => assertContrastEmpty([{ cameraCode: CONTRAST_CAMERA }]), /对照摄像头/);
  assert.throws(
    () =>
      assertOverviewLive(
        { liveMushroomTotal: 29, liveMatureTotal: 11, liveImmatureTotal: 18 },
        cameraRows,
      ),
    /小于/,
  );
  assert.throws(
    () =>
      assertOverviewLive(
        { liveMushroomTotal: 30, liveMatureTotal: 11, liveImmatureTotal: 18 },
        cameraRows,
      ),
    /待成熟数量是 18/,
  );
  assert.throws(
    () => assertOverviewLive({ liveMushroomTotal: 30.5, liveMatureTotal: 11, liveImmatureTotal: 19 }, cameraRows),
    /契约/,
  );
});
