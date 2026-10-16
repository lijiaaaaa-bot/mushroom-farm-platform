import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { readFixture, repoRoot } from './lib/ingest-wire.mjs';
import {
  CONTRAST_CAMERA,
  DEMO_FIXTURE,
  DISEASE_POINTS,
  EXPECTED_CLEAN_RATIO_NOTE,
  EXPECTED_CLEAN_SEVERE_NOTE,
  RATIO_METRIC,
  RATIO_RULE_NAME,
  RATIO_THRESHOLD,
  SEVERE_METRIC,
  SEVERE_RULE_NAME,
  SEVERE_THRESHOLD,
  assertCameraDay,
  assertContrastEmpty,
  assertOverviewDiseaseWarn,
  buildDiseaseWarnPayloads,
  formatDiseaseWarnProof,
  screenUrl,
  validateDiseaseWarnPayloads,
} from './demo-disease-ratio-threshold.mjs';

const clocks = [
  new Date('2026-10-16T04:00:00.000Z'),
  new Date('2026-10-15T16:02:00.000Z'),
  new Date('2026-10-16T15:58:00.000Z'),
];

test('disease payloads stay under the seed count and maturity rules', () => {
  const before = readFixture(DEMO_FIXTURE);
  assert.equal(before.body.cameraCode, 'CAM-DEMO-01');
  assert.equal(before.body.mushroomCount, 12);
  assert.equal(before.body.diseaseCount, 1);
  assert.equal(before.body.diseaseLevel, 1);
  assert.ok(before.body.snapshotBase64);
  for (const now of clocks) {
    const built = buildDiseaseWarnPayloads(now);
    validateDiseaseWarnPayloads(built, now);
    assert.equal(built.points[0].cameraCode, 'CAM-DRT-01');
    assert.equal(built.points[0].diseaseCount, 4);
    assert.equal(built.points[0].diseaseLevel, 3);
    assert.equal(built.points[0].mushroomCount, 20);
    assert.equal(built.points[1].cameraCode, 'CAM-DRT-ZERO');
    assert.equal(built.points[1].diseaseLevel, 0);
    assert.equal(CONTRAST_CAMERA, 'CAM-DRT-NONE');
    for (const point of built.points) {
      assert.equal(point.body.snapshotBase64, undefined);
      assert.ok(point.body.diseaseCount < 5);
      assert.match(point.body.idempotencyKey, new RegExp(`^demo-disease-ratio-threshold-${point.cameraCode}-`));
    }
  }
  const after = readFixture(DEMO_FIXTURE);
  assert.equal(after.body.cameraCode, before.body.cameraCode);
  assert.equal(after.body.snapshotBase64, before.body.snapshotBase64);
  assert.equal(after.body.diseaseLevel, before.body.diseaseLevel);
  assert.equal(DISEASE_POINTS.length, 2);
});

test('overview notes are the disease warnings when both thresholds are met', () => {
  const clean = assertOverviewDiseaseWarn(
    {
      diseaseWarnRatioRuleId: 'rule-ratio',
      diseaseWarnRatioShedCode: null,
      diseaseWarnRatioThreshold: 20,
      diseaseWarnRatioPercent: 20,
      diseaseWarnRatioActive: true,
      diseaseWarnRatioNote: EXPECTED_CLEAN_RATIO_NOTE,
      diseaseWarnSevereRuleId: 'rule-severe',
      diseaseWarnSevereShedCode: null,
      diseaseWarnSevereThreshold: 4,
      diseaseWarnSevereCount: 4,
      diseaseWarnSevereActive: true,
      diseaseWarnSevereNote: EXPECTED_CLEAN_SEVERE_NOTE,
      todayDiseaseCount: 5,
    },
    { ratioId: 'rule-ratio', severeId: 'rule-severe' },
  );
  assert.equal(clean.clean, true);
  assert.equal(clean.ratioNote, '病害预警 比例≥20% 当前20%');
  assert.equal(clean.severeNote, '病害预警 重度≥4 当前4');
  const proof = formatDiseaseWarnProof({
    ratioNote: clean.ratioNote,
    severeNote: clean.severeNote,
    clean: true,
    ratioPercent: 20,
    severeCount: 4,
    day: '2026-10-16',
    ratioId: 'rule-ratio',
    severeId: 'rule-severe',
    closed: 2,
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.equal(proof.split('\n')[0], EXPECTED_CLEAN_RATIO_NOTE);
  assert.equal(proof.split('\n')[1], EXPECTED_CLEAN_SEVERE_NOTE);
  assert.match(proof, /CAM-DRT-01/);
  assert.match(proof, /CAM-DRT-NONE/);
  assert.match(proof, /不新开告警行/);
  assert.equal(screenUrl('http://127.0.0.1:43123'), 'http://127.0.0.1:43123/');

  const mixed = assertOverviewDiseaseWarn({
    diseaseWarnRatioRuleId: 'rule-ratio',
    diseaseWarnRatioShedCode: null,
    diseaseWarnRatioThreshold: 20,
    diseaseWarnRatioPercent: 33.3,
    diseaseWarnRatioActive: true,
    diseaseWarnRatioNote: '病害预警 比例≥20% 当前33.3%',
    diseaseWarnSevereRuleId: 'rule-severe',
    diseaseWarnSevereShedCode: null,
    diseaseWarnSevereThreshold: 4,
    diseaseWarnSevereCount: 9,
    diseaseWarnSevereActive: true,
    diseaseWarnSevereNote: '病害预警 重度≥4 当前9',
  });
  assert.equal(mixed.clean, false);
  assert.equal(mixed.ratioNote, '病害预警 比例≥20% 当前33.3%');

  assert.throws(
    () =>
      assertOverviewDiseaseWarn({
        diseaseWarnRatioRuleId: 'rule-ratio',
        diseaseWarnRatioShedCode: null,
        diseaseWarnRatioThreshold: 20,
        diseaseWarnRatioPercent: 20,
        diseaseWarnRatioActive: false,
        diseaseWarnRatioNote: '',
        diseaseWarnSevereRuleId: 'rule-severe',
        diseaseWarnSevereShedCode: null,
        diseaseWarnSevereThreshold: 4,
        diseaseWarnSevereCount: 4,
        diseaseWarnSevereActive: true,
        diseaseWarnSevereNote: EXPECTED_CLEAN_SEVERE_NOTE,
      }),
    /没有达到阈值/,
  );
  assertCameraDay(
    [{ cameraCode: 'CAM-DRT-01', mushroomCount: 20, diseaseCount: 4, diseaseLevel: 3 }],
    DISEASE_POINTS[0],
  );
  assertContrastEmpty([]);
  assert.throws(() => assertContrastEmpty([{ cameraCode: CONTRAST_CAMERA }]), /对照摄像头/);
});

test('docs name the make target and the clean notes', () => {
  const root = repoRoot();
  const demo = readFileSync(join(root, 'docs/DEMO_DISEASE_RATIO_THRESHOLD.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  assert.match(demo, /make demo-disease-ratio-threshold/);
  assert.match(demo, /病害预警 比例≥20% 当前20%/);
  assert.match(demo, /病害预警 重度≥4 当前4/);
  assert.match(demo, /CAM-DRT-01/);
  assert.match(demo, /CAM-DRT-NONE/);
  assert.match(caps, /make demo-disease-ratio-threshold/);
  assert.match(caps, /病害预警 比例≥20% 当前20%/);
  assert.match(caps, /病害预警 重度≥4 当前4/);
  assert.equal(RATIO_RULE_NAME, '病害比例预警');
  assert.equal(SEVERE_RULE_NAME, '重度病害预警');
  assert.equal(RATIO_METRIC, 'live_disease_ratio');
  assert.equal(SEVERE_METRIC, 'live_disease_severe');
  assert.equal(RATIO_THRESHOLD, 20);
  assert.equal(SEVERE_THRESHOLD, 4);
});
