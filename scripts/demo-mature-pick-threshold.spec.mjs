import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { readFixture, repoRoot } from './lib/ingest-wire.mjs';
import {
  CONTRAST_CAMERA,
  DEMO_FIXTURE,
  EXPECTED_CLEAN_NOTE,
  PICK_POINTS,
  RULE_METRIC,
  RULE_NAME,
  THRESHOLD,
  assertCameraDay,
  assertContrastEmpty,
  assertOverviewMaturePick,
  buildMaturePickPayloads,
  formatMaturePickProof,
  screenUrl,
  validateMaturePickPayloads,
} from './demo-mature-pick-threshold.mjs';

const clocks = [
  new Date('2026-10-16T04:00:00.000Z'),
  new Date('2026-10-15T16:02:00.000Z'),
  new Date('2026-10-16T15:58:00.000Z'),
];

test('pick payloads stay under the seed disease and maturity rules', () => {
  const before = readFixture(DEMO_FIXTURE);
  assert.equal(before.body.cameraCode, 'CAM-DEMO-01');
  assert.equal(before.body.mushroomCount, 12);
  assert.equal(before.body.diseaseCount, 1);
  assert.ok(before.body.snapshotBase64);
  for (const now of clocks) {
    const built = buildMaturePickPayloads(now);
    validateMaturePickPayloads(built, now);
    assert.equal(built.points[0].cameraCode, 'CAM-MPT-01');
    assert.equal(built.points[0].matureCount, THRESHOLD);
    assert.equal(built.points[1].cameraCode, 'CAM-MPT-ZERO');
    assert.equal(built.points[1].matureCount, 0);
    assert.equal(CONTRAST_CAMERA, 'CAM-MPT-NONE');
    for (const point of built.points) {
      assert.equal(point.body.snapshotBase64, undefined);
      assert.equal(point.body.diseaseCount, 0);
      assert.match(point.body.idempotencyKey, new RegExp(`^demo-mature-pick-threshold-${point.cameraCode}-`));
    }
  }
  const after = readFixture(DEMO_FIXTURE);
  assert.equal(after.body.cameraCode, before.body.cameraCode);
  assert.equal(after.body.snapshotBase64, before.body.snapshotBase64);
  assert.equal(PICK_POINTS.length, 2);
});

test('overview note is the pick reminder when mature meets the threshold', () => {
  const clean = assertOverviewMaturePick(
    {
      maturePickRuleId: 'rule-pick',
      maturePickShedCode: null,
      maturePickThreshold: 8,
      maturePickMatureCount: 8,
      maturePickActive: true,
      maturePickNote: EXPECTED_CLEAN_NOTE,
      liveMatureTotal: 11,
    },
    'rule-pick',
  );
  assert.equal(clean.clean, true);
  assert.equal(clean.note, '采摘提醒 成熟≥8 当前8');
  const proof = formatMaturePickProof({
    note: clean.note,
    clean: true,
    threshold: 8,
    matureCount: 8,
    day: '2026-10-16',
    ruleId: 'rule-pick',
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.equal(proof.split('\n')[0], EXPECTED_CLEAN_NOTE);
  assert.match(proof, /CAM-MPT-01/);
  assert.match(proof, /CAM-MPT-NONE/);
  assert.match(proof, /不新开告警行/);
  assert.equal(screenUrl('http://127.0.0.1:43123'), 'http://127.0.0.1:43123/');

  const mixed = assertOverviewMaturePick(
    {
      maturePickRuleId: 'rule-pick',
      maturePickShedCode: null,
      maturePickThreshold: 8,
      maturePickMatureCount: 19,
      maturePickActive: true,
      maturePickNote: '采摘提醒 成熟≥8 当前19',
    },
    'rule-pick',
  );
  assert.equal(mixed.clean, false);
  assert.equal(mixed.note, '采摘提醒 成熟≥8 当前19');

  assert.throws(
    () =>
      assertOverviewMaturePick(
        {
          maturePickRuleId: 'rule-pick',
          maturePickShedCode: null,
          maturePickThreshold: 8,
          maturePickMatureCount: 8,
          maturePickActive: false,
          maturePickNote: '',
        },
        'rule-pick',
      ),
    /没有达到阈值/,
  );
  assertCameraDay(
    [{ cameraCode: 'CAM-MPT-01', mushroomCount: 20, matureCount: 8 }],
    PICK_POINTS[0],
  );
  assertContrastEmpty([]);
  assert.throws(() => assertContrastEmpty([{ cameraCode: CONTRAST_CAMERA }]), /对照摄像头/);
});

test('docs name the make target and the clean note', () => {
  const root = repoRoot();
  const demo = readFileSync(join(root, 'docs/DEMO_MATURE_PICK_THRESHOLD.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  assert.match(demo, /make demo-mature-pick-threshold/);
  assert.match(demo, /采摘提醒 成熟≥8 当前8/);
  assert.match(demo, /CAM-MPT-01/);
  assert.match(demo, /CAM-MPT-NONE/);
  assert.match(caps, /make demo-mature-pick-threshold/);
  assert.match(caps, /采摘提醒 成熟≥8 当前8/);
  assert.equal(RULE_NAME, '采摘提醒');
  assert.equal(RULE_METRIC, 'live_mature_pick');
});
