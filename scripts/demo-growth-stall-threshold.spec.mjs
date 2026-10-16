import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { readFixture, repoRoot } from './lib/ingest-wire.mjs';
import {
  CAP_DIAMETER,
  CONTRAST_CAMERA,
  CONTROL_CAMERA,
  DEMO_CAMERA,
  DEMO_FIXTURE,
  EXPECTED_CLEAN_NOTE,
  RULE_METRIC,
  RULE_NAME,
  THRESHOLD,
  assertCameraDay,
  assertContrastEmpty,
  assertOverviewGrowthStall,
  buildGrowthStallPayloads,
  formatGrowthStallProof,
  screenUrl,
  validateGrowthStallPayloads,
} from './demo-growth-stall-threshold.mjs';

const clocks = [
  new Date('2026-10-16T04:00:00.000Z'),
  new Date('2026-10-15T16:02:00.000Z'),
  new Date('2026-10-16T15:58:00.000Z'),
];

test('stall payloads keep three flat cap-diameter days under the seed rules', () => {
  const before = readFixture(DEMO_FIXTURE);
  assert.equal(before.body.cameraCode, 'CAM-DEMO-01');
  assert.equal(before.body.mushroomCount, 12);
  assert.equal(before.body.diseaseCount, 1);
  assert.deepEqual(before.body.capDiameters, [3.2, 4.8, 6.1]);
  assert.ok(before.body.snapshotBase64);
  for (const now of clocks) {
    const built = buildGrowthStallPayloads(now);
    validateGrowthStallPayloads(built, now);
    assert.equal(built.stall.length, 3);
    assert.equal(built.stall[0].cameraCode, DEMO_CAMERA);
    assert.equal(built.stall[0].capDiameter, CAP_DIAMETER);
    assert.equal(built.control.cameraCode, CONTROL_CAMERA);
    assert.equal(built.control.mushroomCount, 0);
    assert.equal(built.control.body.capDiameters, undefined);
    assert.equal(CONTRAST_CAMERA, 'CAM-GST-NONE');
    for (const point of built.stall) {
      assert.equal(point.body.snapshotBase64, undefined);
      assert.equal(point.body.diseaseCount, 0);
      assert.deepEqual(point.body.capDiameters, [CAP_DIAMETER]);
      assert.match(point.body.idempotencyKey, new RegExp(`^demo-growth-stall-threshold-${DEMO_CAMERA}-`));
    }
  }
  const after = readFixture(DEMO_FIXTURE);
  assert.equal(after.body.cameraCode, before.body.cameraCode);
  assert.deepEqual(after.body.capDiameters, before.body.capDiameters);
  assert.equal(after.body.snapshotBase64, before.body.snapshotBase64);
});

test('overview note is the growth warning when stall days meet the threshold', () => {
  const clean = assertOverviewGrowthStall(
    {
      growthStallRuleId: 'rule-stall',
      growthStallShedCode: null,
      growthStallThreshold: 2,
      growthStallCurrent: 2,
      growthStallActive: true,
      growthStallNote: EXPECTED_CLEAN_NOTE,
      maturePickNote: '采摘提醒 成熟≥8 当前8',
    },
    'rule-stall',
  );
  assert.equal(clean.clean, true);
  assert.equal(clean.note, '生长异常预警 停滞≥2 当前2');
  const proof = formatGrowthStallProof({
    note: clean.note,
    clean: true,
    threshold: 2,
    current: 2,
    day: '2026-10-16',
    ruleId: 'rule-stall',
    days: ['2026-10-14', '2026-10-15', '2026-10-16'],
    closed: 1,
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.equal(proof.split('\n')[0], EXPECTED_CLEAN_NOTE);
  assert.match(proof, /CAM-GST-01/);
  assert.match(proof, /CAM-GST-NONE/);
  assert.match(proof, /菌盖直径 4/);
  assert.match(proof, /不按菌盖生长停滞这条规则新开告警行/);
  assert.equal(screenUrl('http://127.0.0.1:43123'), 'http://127.0.0.1:43123/');

  const mixed = assertOverviewGrowthStall(
    {
      growthStallRuleId: 'rule-stall',
      growthStallShedCode: null,
      growthStallThreshold: 2,
      growthStallCurrent: 5,
      growthStallActive: true,
      growthStallNote: '生长异常预警 停滞≥2 当前5',
    },
    'rule-stall',
  );
  assert.equal(mixed.clean, false);
  assert.equal(mixed.note, '生长异常预警 停滞≥2 当前5');

  assert.throws(
    () =>
      assertOverviewGrowthStall(
        {
          growthStallRuleId: 'rule-stall',
          growthStallShedCode: null,
          growthStallThreshold: 2,
          growthStallCurrent: 2,
          growthStallActive: false,
          growthStallNote: '',
        },
        'rule-stall',
      ),
    /没有达到阈值/,
  );
  assertCameraDay(
    [{ cameraCode: 'CAM-GST-01', mushroomCount: 10, matureCount: 2 }],
    { cameraCode: 'CAM-GST-01', mushroomCount: 10, matureCount: 2, day: '2026-10-16' },
  );
  assertContrastEmpty([]);
  assert.throws(() => assertContrastEmpty([{ cameraCode: CONTRAST_CAMERA }]), /对照摄像头/);
});

test('docs name the make target and the clean note', () => {
  const root = repoRoot();
  const demo = readFileSync(join(root, 'docs/DEMO_GROWTH_STALL_THRESHOLD.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  assert.match(demo, /make demo-growth-stall-threshold/);
  assert.match(demo, /生长异常预警 停滞≥2 当前2/);
  assert.match(demo, /CAM-GST-01/);
  assert.match(demo, /CAM-GST-NONE/);
  assert.match(demo, /菌盖直径 4/);
  assert.match(caps, /make demo-growth-stall-threshold/);
  assert.match(caps, /生长异常预警 停滞≥2 当前2/);
  assert.equal(RULE_NAME, '生长异常预警');
  assert.equal(RULE_METRIC, 'live_growth_stall');
  assert.equal(THRESHOLD, 2);
});
