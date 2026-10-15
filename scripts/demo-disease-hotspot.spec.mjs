import assert from 'node:assert/strict';
import test from 'node:test';
import { readFixture } from './lib/ingest-wire.mjs';
import { DEMO_CAMERA as FIXTURE_CAMERA, DEMO_FIXTURE as ONE_FIXTURE } from './demo-one-http-recognition.mjs';
import {
  DEMO_FIXTURE,
  DISEASE_LEVEL,
  LOW_COUNT,
  LOW_DAY_CAMERA,
  LOW_HOUR_CAMERA,
  LOW_SHED,
  PEAK_CAMERAS,
  PEAK_EACH,
  PEAK_HOUR_TOTAL,
  PEAK_SHED,
  assertHotspot,
  bucketStartFor,
  buildHotspotPayloads,
  formatHotspotProof,
  hotspotUrl,
  validateHotspotPayloads,
} from './demo-disease-hotspot.mjs';

const now = new Date('2026-10-14T01:02:03.004Z');
const midnight = new Date('2026-10-14T16:30:00.000Z');

function peaksFrom(samples, grain, at) {
  const inHour = (sample) => {
    const end = bucketStartFor(at, 'hour');
    const start = new Date(new Date(end).getTime() - 23 * 60 * 60 * 1000).toISOString();
    const bucket = bucketStartFor(sample.at, 'hour');
    return bucket >= start && bucket <= end;
  };
  const inDay = (sample) => {
    const day = bucketStartFor(sample.at, 'day');
    const from = bucketStartFor(new Date(at.getTime() - 6 * 24 * 60 * 60 * 1000), 'day');
    const to = bucketStartFor(at, 'day');
    return day >= from && day <= to;
  };
  const visible = samples.filter(grain === 'hour' ? inHour : inDay);
  const byTime = new Map();
  const byShed = new Map();
  for (const sample of visible) {
    const bucket = bucketStartFor(sample.at, grain);
    byTime.set(bucket, (byTime.get(bucket) ?? 0) + sample.diseaseCount);
    byShed.set(sample.shedCode, (byShed.get(sample.shedCode) ?? 0) + sample.diseaseCount);
  }
  const times = [...byTime.entries()]
    .map(([bucketStart, diseaseCount]) => ({ bucketStart, diseaseCount }))
    .sort((a, b) => a.bucketStart.localeCompare(b.bucketStart));
  const sheds = [...byShed.entries()]
    .map(([shedCode, diseaseCount]) => ({ shedCode, diseaseCount }))
    .sort((a, b) => b.diseaseCount - a.diseaseCount || a.shedCode.localeCompare(b.shedCode));
  const peak = times.reduce((best, row) => (!best || row.diseaseCount > best.diseaseCount ? row : best), null);
  return { grain, byTime: times, byShed: sheds, peak };
}

test('payload keeps the hotspot fixture and leaves the one-ingest file', () => {
  const before = JSON.stringify(readFixture(DEMO_FIXTURE));
  const fixture = readFixture(DEMO_FIXTURE);
  assert.equal(fixture.body.cameraCode, 'CAM-DH-A');
  assert.equal(fixture.body.shedCode, PEAK_SHED);
  assert.equal(fixture.body.diseaseCount, PEAK_EACH);
  assert.equal(fixture.body.diseaseLevel, DISEASE_LEVEL);
  assert.equal(fixture.temperature, 22.5);
  assert.equal(fixture.mushroomCount, 12);
  assert.equal(fixture.matureCount, 4);
  assert.deepEqual(
    fixture.points.map((point) => [point.role, point.shedCode, point.cameraCode, point.offsetHours, point.diseaseCount]),
    [
      ['peak', PEAK_SHED, 'CAM-DH-A', 0, PEAK_EACH],
      ['peak', PEAK_SHED, 'CAM-DH-B', 0, PEAK_EACH],
      ['peak', PEAK_SHED, 'CAM-DH-C', 0, PEAK_EACH],
      ['low-hour', LOW_SHED, LOW_HOUR_CAMERA, 3, LOW_COUNT],
      ['low-day', PEAK_SHED, LOW_DAY_CAMERA, 48, LOW_COUNT],
    ],
  );
  const one = readFixture(ONE_FIXTURE);
  assert.equal(one.body.cameraCode, FIXTURE_CAMERA);
  assert.equal(one.body.cameraCode, 'CAM-DEMO-01');
  const samples = buildHotspotPayloads(now);
  validateHotspotPayloads(samples, now);
  assert.equal(samples.filter((sample) => sample.role === 'peak').reduce((sum, sample) => sum + sample.diseaseCount, 0), PEAK_HOUR_TOTAL);
  assert.deepEqual(
    samples.filter((sample) => sample.role === 'peak').map((sample) => sample.cameraCode),
    PEAK_CAMERAS,
  );
  assert.equal(bucketStartFor(samples[0].at, 'hour'), bucketStartFor(samples[2].at, 'hour'));
  assert.notEqual(bucketStartFor(samples[3].at, 'hour'), bucketStartFor(samples[0].at, 'hour'));
  const again = buildHotspotPayloads(now);
  assert.deepEqual(
    again.map((sample) => sample.body.idempotencyKey),
    samples.map((sample) => sample.body.idempotencyKey),
  );
  assert.equal(JSON.stringify(readFixture(DEMO_FIXTURE)), before);
  assert.equal(readFixture(ONE_FIXTURE).body.cameraCode, 'CAM-DEMO-01');
  assert.ok(samples.every((sample) => sample.body.diseaseCount < 5));
  assert.ok(samples.every((sample) => sample.body.diseaseLevel < 2));
});

test('hour and day peaks keep S03 above S02 and the peak period above the low period', () => {
  for (const at of [now, midnight]) {
    const samples = buildHotspotPayloads(at);
    validateHotspotPayloads(samples, at);
    const hour = peaksFrom(samples, 'hour', at);
    const day = peaksFrom(samples, 'day', at);
    const hourCheck = assertHotspot(hour, samples, 'hour', at);
    const dayCheck = assertHotspot(day, samples, 'day', at);
    assert.equal(hourCheck.peakShed.shedCode, PEAK_SHED);
    assert.equal(hourCheck.peakShed.diseaseCount, PEAK_HOUR_TOTAL);
    assert.equal(hourCheck.lowShed.diseaseCount, LOW_COUNT);
    assert.equal(hourCheck.peakRow.diseaseCount, PEAK_HOUR_TOTAL);
    assert.equal(hourCheck.contrastRow.diseaseCount, LOW_COUNT);
    assert.ok(dayCheck.peakShed.diseaseCount > dayCheck.lowShed.diseaseCount);
    assert.ok(dayCheck.peakRow.diseaseCount > dayCheck.contrastRow.diseaseCount);
    assert.equal(dayCheck.lowShed.shedCode, LOW_SHED);
    assert.throws(() => assertHotspot({ ...hour, grain: 'day' }, samples, 'hour', at), /粒度/);
    const flipped = {
      ...hour,
      byShed: [
        { shedCode: LOW_SHED, diseaseCount: 20 },
        { shedCode: PEAK_SHED, diseaseCount: PEAK_HOUR_TOTAL },
      ],
    };
    assert.throws(() => assertHotspot(flipped, samples, 'hour', at), /没有高于/);
  }
});

test('proof prints both hotspot urls and the shed counts', () => {
  const samples = buildHotspotPayloads(now);
  const hour = peaksFrom(samples, 'hour', now);
  const day = peaksFrom(samples, 'day', now);
  const duplicates = new Map(samples.map((sample) => [sample.body.idempotencyKey, false]));
  duplicates.set(samples[0].body.idempotencyKey, true);
  const proof = formatHotspotProof({
    hour,
    day,
    samples,
    duplicates,
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /病害高发: 小时与日/);
  assert.match(proof, new RegExp(`峰值棚区: ${PEAK_SHED}`));
  assert.match(proof, new RegExp(`对照棚区: ${LOW_SHED}`));
  assert.match(proof, /小时峰值病害数量: 12/);
  assert.match(proof, new RegExp(`小时最高棚区: ${PEAK_SHED}`));
  assert.match(proof, /小时 S03: 12/);
  assert.match(proof, /小时 S02: 1/);
  assert.match(proof, /日 S03: 13/);
  assert.match(proof, /日 S02: 1/);
  assert.match(proof, /CAM-DH-A S03 病害数量 4（沿用）/);
  assert.match(proof, /CAM-DH-LOW S02 病害数量 1（新建）/);
  assert.match(
    proof,
    new RegExp(hotspotUrl('hour', 'http://127.0.0.1:43123').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
  assert.match(
    proof,
    new RegExp(hotspotUrl('day', 'http://127.0.0.1:43123').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
  assert.equal(hotspotUrl('hour', 'http://127.0.0.1:43123'), 'http://127.0.0.1:43123/diseases?grain=hour');
  assert.equal(hotspotUrl('day', 'http://127.0.0.1:43123'), 'http://127.0.0.1:43123/diseases?grain=day');
});
