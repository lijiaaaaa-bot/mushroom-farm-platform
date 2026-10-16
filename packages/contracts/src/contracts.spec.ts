import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  buildSnapshotObjectKey,
  shanghaiHourStart,
  shiftShanghaiDate,
  parseAlertFalsePositive,
  parseAlertNote,
  parseCreateAlert,
  parseBackupStatus,
  parsePatchSystemParams,
  parseSystemParams,
  parseSystemParamsPatchResult,
  formatSystemParamChange,
  SYSTEM_PARAM_DEFAULTS,
  IMAGE_RETENTION_DAYS,
  ALERT_UNREAD_POLL_SECONDS,
  parseChangeOwnPassword,
  parseSetUserEnabled,
  parseUserListItem,
  LIMITS,
  parseEnvironmentIngress,
  parseHeartbeatIngress,
  parseRecognitionIngress,
  parseLiveMushroomTotals,
  MATURE_PICK_METRIC,
  MATURE_PICK_THRESHOLD_ERROR,
  evaluateMaturePickReminder,
  formatMaturePickConfig,
  formatMaturePickNote,
  maturePickThresholdInteger,
  parseMaturePickReminder,
  DISEASE_RATIO_METRIC,
  DISEASE_RATIO_THRESHOLD_ERROR,
  DISEASE_SEVERE_METRIC,
  DISEASE_SEVERE_THRESHOLD_ERROR,
  DISEASE_WARN_LABEL,
  diseaseRatioPercent,
  diseaseWarnFromOverview,
  diseaseWarnOverviewFields,
  diseaseWarnThresholdInteger,
  evaluateDiseaseWarning,
  formatDiseaseWarnConfig,
  formatDiseaseWarnRatioNote,
  formatDiseaseWarnSevereNote,
  parseDiseaseWarning,
  GROWTH_STALL_LABEL,
  GROWTH_STALL_METRIC,
  GROWTH_STALL_THRESHOLD_ERROR,
  evaluateGrowthStallWarning,
  formatGrowthStallConfig,
  formatGrowthStallNote,
  growthStallFromOverview,
  growthStallOverviewFields,
  growthStallThresholdInteger,
  parseGrowthStallWarning,
  trailingStallDays,
  pendingLiveCount,
  sumShedLiveMushroomTotals,
  formatLiveMushroomTotalsNote,
  LIVE_MUSHROOM_TOTAL_LABEL,
  DEVICE_ONLINE_BY_TYPE_LABEL,
  ENV_ANOMALY_POINT_LABEL,
  ENV_MEAN_LABEL,
  countDevicesOnlineByType,
  countEnvAnomalyPoints,
  formatDeviceOnlineByTypeNote,
  formatDeviceOnlineRatio,
  formatEnvAnomalyPointNote,
  formatEnvMeanNote,
  formatEnvMeanValue,
  meanFarmEnvironment,
  parseDeviceOnlineByType,
  parseEnvAnomalyPointCount,
  parseFarmEnvMeans,
  sensorIsEnvAnomaly,
  TIMESERIES_RETENTION_DAYS,
  transitionError,
} from './index';

const fixturesDir = join(__dirname, '..', 'fixtures');

function load(name: string): {
  clock?: string;
  expect: string;
  body?: unknown;
  cases?: { from: string; to: 'open' | 'acked' | 'closed'; ok: boolean }[];
  shedCode?: string;
  cameraCode?: string;
  recognizedAt?: string;
} {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as never;
}

describe('golden fixtures', () => {
  it('loads every recognition fixture instead of inline payloads', () => {
    const names = readdirSync(fixturesDir).filter((name) => name.startsWith('recognition.'));
    assert.ok(names.length >= 4);
    for (const name of names) {
      const fixture = load(name);
      if (!fixture.clock) throw new Error(`${name} 缺少 clock`);
      const result = parseRecognitionIngress(fixture.body, new Date(fixture.clock));
      if (fixture.expect === 'ok') {
        assert.equal(result.ok, true, name);
      } else {
        assert.equal(result.ok, false, name);
        if (!result.ok) assert.equal(result.code, fixture.expect, name);
      }
    }
  });

  it('loads alert fixtures', () => {
    const created = load('alert.create.json');
    const parsed = parseCreateAlert(created.body);
    assert.equal(parsed.ok, created.expect === 'ok');
    const timed = parseCreateAlert({
      ...(created.body as Record<string, unknown>),
      createdAt: '2026-10-14T01:02:03.000Z',
    });
    assert.equal(timed.ok, true);
    if (timed.ok) assert.equal(timed.value.createdAt, '2026-10-14T01:02:03.000Z');
    const extra = load('alert.unknown-field.json');
    const rejected = parseCreateAlert(extra.body);
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.equal(rejected.code, extra.expect);
    const note = load('alert.ack.json');
    const acked = parseAlertNote(note.body);
    assert.equal(acked.ok, note.expect === 'ok');
    const padded = parseAlertNote({ note: '  现场已开窗通风  ' });
    assert.equal(padded.ok, true);
    if (padded.ok) assert.equal(padded.value.note, '现场已开窗通风');
    const blankNote = parseAlertNote({ note: '   ' });
    assert.equal(blankNote.ok, true);
    if (blankNote.ok) assert.equal(blankNote.value.note, '');
    const falsePositive = load('alert.false-positive.json');
    const closed = parseAlertFalsePositive(falsePositive.body);
    assert.equal(closed.ok, falsePositive.expect === 'ok');
    if (closed.ok) assert.equal(closed.value.note, '传感器抖动，现场无异常');
    const missing = parseAlertFalsePositive({});
    assert.equal(missing.ok, false);
    const blank = parseAlertFalsePositive({ note: '   ' });
    assert.equal(blank.ok, false);
  });

  it('loads alert transition cases', () => {
    const fixture = load('alert.transitions.json');
    for (const item of fixture.cases || []) {
      const error = transitionError(item.from, item.to);
      assert.equal(error === null, item.ok);
    }
  });

  it('parses environment fixtures apart from recognition payloads', () => {
    for (const name of [
      'environment.golden.json',
      'environment.unknown-field.json',
      'environment.demo-latest.json',
      'environment.demo-history.json',
      'environment.demo-env-filter.json',
      'environment.demo-disease-env-detail.json',
      'environment.demo-telemetry-threshold.json',
    ]) {
      const fixture = load(name);
      const result = parseEnvironmentIngress(fixture.body, new Date(String(fixture.clock)));
      if (fixture.expect === 'ok') {
        assert.equal(result.ok, true, name);
      } else {
        assert.equal(result.ok, false, name);
        if (!result.ok) assert.equal(result.code, fixture.expect, name);
      }
      const asRecognition = parseRecognitionIngress(fixture.body, new Date(String(fixture.clock)));
      assert.equal(asRecognition.ok, false, name);
    }
  });

  it('loads heartbeat fixtures', () => {
    const mqtt = load('heartbeat.mqtt.json');
    const fromTopic = parseHeartbeatIngress({
      ...(mqtt.body as Record<string, unknown>),
      shedCode: mqtt.shedCode,
    });
    assert.equal(fromTopic.ok, true);
    if (fromTopic.ok) {
      assert.equal(fromTopic.value.shedCode, 'S01');
      assert.equal(fromTopic.value.deviceCode, 'EDGE-SIM-BOX');
      assert.equal(fromTopic.value.deviceType, 'ai_box');
      assert.equal(fromTopic.value.online, true);
    }
    const http = load('heartbeat.http.json');
    const parsed = parseHeartbeatIngress(http.body);
    assert.equal(parsed.ok, http.expect === 'ok');
    const extra = load('heartbeat.unknown-field.json');
    const rejected = parseHeartbeatIngress(extra.body);
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.equal(rejected.code, extra.expect);
  });

  it('shifts Shanghai calendar dates by whole days', () => {
    assert.equal(shiftShanghaiDate('2026-09-30', 1), '2026-10-01');
    assert.equal(shiftShanghaiDate('2026-03-01', -1), '2026-02-28');
  });

  it('keeps the recognition and environment replay window at 90 days', () => {
    assert.equal(LIMITS.recognizedAtPastDays, 90);
    assert.equal(LIMITS.recognizedAtPastDays, TIMESERIES_RETENTION_DAYS);
    const now = new Date('2026-09-23T12:00:00.000Z');
    const dayMs = 24 * 60 * 60 * 1000;
    const inside = new Date(now.getTime() - 90 * dayMs).toISOString();
    const historical = new Date(now.getTime() - 8 * dayMs).toISOString();
    const outside = new Date(now.getTime() - 90 * dayMs - 1).toISOString();
    const recognition = (recognizedAt: string) =>
      parseRecognitionIngress(
        {
          shedCode: 'S01',
          cameraCode: 'CAM-S01-01',
          recognizedAt,
          mushroomCount: 1,
          matureCount: 0,
        },
        now,
      );
    assert.equal(recognition(historical).ok, true);
    assert.equal(recognition(inside).ok, true);
    const staleRecognition = recognition(outside);
    assert.equal(staleRecognition.ok, false);
    if (!staleRecognition.ok) {
      assert.equal(staleRecognition.code, 'VALIDATION_FAILED');
      assert.ok(staleRecognition.errors.includes('识别时间超出补传窗口'));
    }
    const environment = (observedAt: string) =>
      parseEnvironmentIngress(
        {
          shedCode: 'S01',
          sensorCode: 'SENSOR-S01',
          observedAt,
          temperature: 20,
          humidity: 80,
        },
        now,
      );
    assert.equal(environment(historical).ok, true);
    assert.equal(environment(inside).ok, true);
    const staleEnvironment = environment(outside);
    assert.equal(staleEnvironment.ok, false);
    if (!staleEnvironment.ok) {
      assert.ok(staleEnvironment.errors.includes('观测时间超出补传窗口'));
    }
  });

  it('truncates a timestamp to the Shanghai hour', () => {
    assert.equal(
      shanghaiHourStart(new Date('2026-09-20T03:15:00.000Z')).toISOString(),
      '2026-09-20T03:00:00.000Z',
    );
    assert.equal(
      shanghaiHourStart(new Date('2026-09-19T16:00:00.000Z')).toISOString(),
      '2026-09-19T16:00:00.000Z',
    );
    assert.equal(
      shanghaiHourStart(new Date('2026-09-20T15:59:00.000Z')).toISOString(),
      '2026-09-20T15:00:00.000Z',
    );
  });

  it('demo-one sample covers the received recognition fields', () => {
    const fixture = load('recognition.demo-one.json');
    const result = parseRecognitionIngress(fixture.body, new Date(String(fixture.clock)));
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    const value = result.value;
    assert.equal(value.shedCode, 'S01');
    assert.ok(value.cameraCode);
    assert.ok(value.recognizedAt);
    assert.equal(Number.isInteger(value.mushroomCount), true);
    assert.equal(Number.isInteger(value.matureCount), true);
    assert.ok(value.capDiameters.length > 0);
    assert.equal(Number.isInteger(value.diseaseCount), true);
    assert.equal(Number.isInteger(value.diseaseLevel), true);
    assert.ok(value.snapshotBase64 || value.snapshotUrl);
    assert.equal(typeof value.temperature, 'number');
    assert.equal(typeof value.humidity, 'number');
    assert.equal(typeof value.co2, 'number');
    assert.equal(typeof value.substrateMoisture, 'number');
  });

  it('accepts a user list row and a boolean enable body', () => {
    const row = parseUserListItem({
      id: 'user-enable',
      username: 'user-enable-demo',
      displayName: '启停演示',
      role: 'viewer',
      shedCodes: ['S01'],
      enabled: true,
      createdAt: '2026-10-15T00:00:00.000Z',
    });
    assert.equal(row.ok, true);
    if (row.ok) assert.equal(row.value.enabled, true);
    const off = parseSetUserEnabled({ enabled: false });
    assert.equal(off.ok, true);
    if (off.ok) assert.equal(off.value.enabled, false);
    const on = parseSetUserEnabled({ enabled: true });
    assert.equal(on.ok, true);
    const textFlag = parseSetUserEnabled({ enabled: 'false' });
    assert.equal(textFlag.ok, false);
    if (!textFlag.ok) assert.equal(textFlag.code, 'VALIDATION_FAILED');
    const extra = parseSetUserEnabled({ enabled: false, password: 'x' });
    assert.equal(extra.ok, false);
    if (!extra.ok) assert.equal(extra.code, 'UNKNOWN_FIELD');
    const secret = parseUserListItem({
      id: 'user-enable',
      username: 'user-enable-demo',
      displayName: '启停演示',
      role: 'viewer',
      shedCodes: ['S01'],
      enabled: false,
      passwordHash: 'secret',
    });
    assert.equal(secret.ok, false);
    if (!secret.ok) assert.equal(secret.code, 'UNKNOWN_FIELD');
  });

  it('accepts only the current password and a new password', () => {
    const ok = parseChangeOwnPassword({
      currentPassword: 'PwdOld@123456',
      newPassword: 'PwdNew@123456',
    });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.value.currentPassword, 'PwdOld@123456');
      assert.equal(ok.value.newPassword, 'PwdNew@123456');
    }
    const short = parseChangeOwnPassword({
      currentPassword: 'PwdOld@123456',
      newPassword: 'short',
    });
    assert.equal(short.ok, false);
    if (!short.ok) assert.equal(short.code, 'VALIDATION_FAILED');
    const extra = parseChangeOwnPassword({
      currentPassword: 'PwdOld@123456',
      newPassword: 'PwdNew@123456',
      username: 'admin',
    });
    assert.equal(extra.ok, false);
    if (!extra.ok) assert.equal(extra.code, 'UNKNOWN_FIELD');
  });

  it('accepts a backup status and rejects a secret field', () => {
    const empty = parseBackupStatus({
      lastSuccessAt: null,
      lastRunAt: null,
      lastStatus: 'never',
      lastFileName: null,
      lastBytes: null,
      lastError: null,
      triggeredBy: null,
    });
    assert.equal(empty.ok, true);
    if (empty.ok) assert.equal(empty.value.lastStatus, 'never');
    const done = parseBackupStatus({
      lastSuccessAt: '2026-10-15T03:00:00.000Z',
      lastRunAt: '2026-10-15T03:00:00.000Z',
      lastStatus: 'success',
      lastFileName: 'mushroom-20261015T030000Z.sql',
      lastBytes: 128,
      lastError: null,
      triggeredBy: 'admin',
    });
    assert.equal(done.ok, true);
    if (done.ok) assert.equal(done.value.lastBytes, 128);
    const extra = parseBackupStatus({
      lastSuccessAt: null,
      lastRunAt: null,
      lastStatus: 'never',
      lastFileName: null,
      lastBytes: null,
      lastError: null,
      triggeredBy: null,
      password: 'secret',
    });
    assert.equal(extra.ok, false);
    if (!extra.ok) assert.equal(extra.code, 'UNKNOWN_FIELD');
    const badState = parseBackupStatus({
      lastSuccessAt: null,
      lastRunAt: null,
      lastStatus: 'ok',
      lastFileName: null,
      lastBytes: null,
      lastError: null,
      triggeredBy: null,
    });
    assert.equal(badState.ok, false);
  });

  it('accepts system params and rejects an empty or secret patch', () => {
    assert.equal(SYSTEM_PARAM_DEFAULTS.imageRetentionDays, IMAGE_RETENTION_DAYS);
    assert.equal(SYSTEM_PARAM_DEFAULTS.timeseriesRetentionDays, TIMESERIES_RETENTION_DAYS);
    assert.equal(SYSTEM_PARAM_DEFAULTS.alertUnreadPollSeconds, ALERT_UNREAD_POLL_SECONDS);
    const current = parseSystemParams({
      imageRetentionDays: 30,
      timeseriesRetentionDays: 90,
      alertUnreadPollSeconds: 15,
      updatedAt: null,
      updatedBy: null,
    });
    assert.equal(current.ok, true);
    const patched = parseSystemParamsPatchResult({
      imageRetentionDays: 30,
      timeseriesRetentionDays: 90,
      alertUnreadPollSeconds: 45,
      updatedAt: '2026-10-15T03:00:00.000Z',
      updatedBy: 'admin',
      changes: [
        {
          key: 'alertUnreadPollSeconds',
          label: '告警未读轮询',
          beforeText: '15 秒',
          afterText: '45 秒',
        },
      ],
    });
    assert.equal(patched.ok, true);
    if (patched.ok) {
      assert.equal(
        formatSystemParamChange(patched.value.changes[0]),
        '告警未读轮询：15 秒 → 45 秒',
      );
    }
    const empty = parsePatchSystemParams({});
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.match(empty.errors.join(' '), /至少改一项/);
    const extra = parsePatchSystemParams({ alertUnreadPollSeconds: 45, password: 'secret' });
    assert.equal(extra.ok, false);
    if (!extra.ok) assert.equal(extra.code, 'UNKNOWN_FIELD');
    const low = parsePatchSystemParams({ alertUnreadPollSeconds: 1 });
    assert.equal(low.ok, false);
    if (!low.ok) assert.equal(low.code, 'VALIDATION_FAILED');
  });

  it('sums shed live mushroom totals after each shed immature count', () => {
    assert.equal(pendingLiveCount(20, 8), 12);
    assert.equal(pendingLiveCount(0, 3), 0);
    assert.equal(pendingLiveCount(4, 10), 0);
    const clean = sumShedLiveMushroomTotals([
      { mushroomCount: 20 + 10, matureCount: 8 + 3 },
      { mushroomCount: 0, matureCount: 0 },
    ]);
    assert.deepEqual(clean, {
      liveMushroomTotal: 30,
      liveMatureTotal: 11,
      liveImmatureTotal: 19,
    });
    const clamped = sumShedLiveMushroomTotals([
      { mushroomCount: 30, matureCount: 11 },
      { mushroomCount: 4, matureCount: 10 },
    ]);
    assert.deepEqual(clamped, {
      liveMushroomTotal: 34,
      liveMatureTotal: 21,
      liveImmatureTotal: 19,
    });
    assert.deepEqual(sumShedLiveMushroomTotals([]), {
      liveMushroomTotal: 0,
      liveMatureTotal: 0,
      liveImmatureTotal: 0,
    });
    assert.equal(
      formatLiveMushroomTotalsNote(clean),
      '在养蘑菇总数 30 · 成熟可采摘总数 11 · 待成熟数量 19',
    );
    assert.equal(LIVE_MUSHROOM_TOTAL_LABEL.liveMushroomTotal, '在养蘑菇总数');
    assert.equal(LIVE_MUSHROOM_TOTAL_LABEL.liveMatureTotal, '成熟可采摘总数');
    assert.equal(LIVE_MUSHROOM_TOTAL_LABEL.liveImmatureTotal, '待成熟数量');
    const parsed = parseLiveMushroomTotals({
      ...clean,
      todayDiseaseCount: 5,
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.deepEqual(parsed.value, clean);
    const missing = parseLiveMushroomTotals({ liveMushroomTotal: 30 });
    assert.equal(missing.ok, false);
    const fraction = parseLiveMushroomTotals({
      liveMushroomTotal: 1.5,
      liveMatureTotal: 1,
      liveImmatureTotal: 0,
    });
    assert.equal(fraction.ok, false);
  });

  it('reminds to pick when live mature meets the configured integer threshold', () => {
    assert.equal(maturePickThresholdInteger(8), 8);
    assert.equal(maturePickThresholdInteger('0'), 0);
    assert.equal(maturePickThresholdInteger(8.5), null);
    assert.equal(maturePickThresholdInteger(-1), null);
    assert.equal(MATURE_PICK_METRIC, 'live_mature_pick');
    const sheds = [
      { shedCode: 'S01', matureCount: 8 },
      { shedCode: 'S02', matureCount: 0 },
    ];
    const quiet = evaluateMaturePickReminder(
      [{ id: 'rule-pick', metric: MATURE_PICK_METRIC, threshold: 9, enabled: true, shedCode: null }],
      sheds,
    );
    assert.equal(quiet.active, false);
    assert.equal(quiet.matureCount, 8);
    assert.equal(quiet.note, '');
    assert.equal(formatMaturePickConfig(quiet), '成熟菇数量阈值 9 · 全场 · 当前成熟 8');
    const active = evaluateMaturePickReminder(
      [
        { id: 'rule-pick', metric: MATURE_PICK_METRIC, threshold: 8, enabled: true, shedCode: null },
        { id: 'rule-shed', metric: MATURE_PICK_METRIC, threshold: 1, enabled: true, shedCode: 'S02' },
        { id: 'rule-temp', metric: 'temperature_high', threshold: 28, enabled: true, shedCode: null },
      ],
      sheds,
    );
    assert.equal(active.ruleId, 'rule-pick');
    assert.equal(active.shedCode, null);
    assert.equal(active.threshold, 8);
    assert.equal(active.matureCount, 8);
    assert.equal(active.active, true);
    assert.equal(formatMaturePickNote(active), '采摘提醒 成熟≥8 当前8');
    assert.equal(active.note, '采摘提醒 成熟≥8 当前8');
    const shedOnly = evaluateMaturePickReminder(
      [{ id: 'rule-s01', metric: MATURE_PICK_METRIC, threshold: 8, enabled: true, shedCode: 'S01' }],
      sheds,
    );
    assert.equal(shedOnly.note, '采摘提醒 棚区 S01 成熟≥8 当前8');
    const missing = evaluateMaturePickReminder([], sheds);
    assert.equal(missing.threshold, null);
    assert.equal(formatMaturePickConfig(missing), '尚未配置成熟菇数量阈值');
    const parsed = parseMaturePickReminder({
      maturePickRuleId: 'rule-pick',
      maturePickShedCode: null,
      maturePickThreshold: 8,
      maturePickMatureCount: 8,
      maturePickActive: true,
      maturePickNote: '采摘提醒 成熟≥8 当前8',
      liveMatureTotal: 8,
    });
    assert.equal(parsed.ok, true);
    const mismatched = parseMaturePickReminder({
      maturePickRuleId: 'rule-pick',
      maturePickShedCode: null,
      maturePickThreshold: 8,
      maturePickMatureCount: 8,
      maturePickActive: true,
      maturePickNote: '采摘提醒 成熟≥8 当前9',
    });
    assert.equal(mismatched.ok, false);
    assert.equal(parseMaturePickReminder({}).ok, false);
    assert.match(MATURE_PICK_THRESHOLD_ERROR, /大于等于 0 的整数/);
  });

  it('warns when the disease ratio or the severe count meets its threshold', () => {
    assert.equal(diseaseWarnThresholdInteger(20), 20);
    assert.equal(diseaseWarnThresholdInteger('4'), 4);
    assert.equal(diseaseWarnThresholdInteger(20.5), null);
    assert.equal(diseaseWarnThresholdInteger(-1), null);
    assert.equal(diseaseRatioPercent(4, 20), 20);
    assert.equal(diseaseRatioPercent(1, 3), 33.3);
    assert.equal(diseaseRatioPercent(2, 0), 0);
    assert.equal(DISEASE_RATIO_METRIC, 'live_disease_ratio');
    assert.equal(DISEASE_SEVERE_METRIC, 'live_disease_severe');
    const sheds = [
      { shedCode: 'S01', mushroomCount: 20, diseaseCount: 4, severeCount: 4 },
      { shedCode: 'S02', mushroomCount: 0, diseaseCount: 0, severeCount: 0 },
    ];
    const quiet = evaluateDiseaseWarning(
      [
        { id: 'rule-ratio', metric: DISEASE_RATIO_METRIC, threshold: 21, enabled: true, shedCode: null },
        { id: 'rule-severe', metric: DISEASE_SEVERE_METRIC, threshold: 5, enabled: true, shedCode: null },
      ],
      sheds,
    );
    assert.equal(quiet.ratio.active, false);
    assert.equal(quiet.ratio.percent, 20);
    assert.equal(quiet.ratio.note, '');
    assert.equal(quiet.severe.active, false);
    assert.equal(quiet.severe.severeCount, 4);
    assert.equal(
      formatDiseaseWarnConfig(quiet),
      '病害比例阈值 21% · 全场 · 当前比例 20% · 重度病害数量阈值 5 · 全场 · 当前重度 4',
    );
    const active = evaluateDiseaseWarning(
      [
        { id: 'rule-ratio', metric: DISEASE_RATIO_METRIC, threshold: 20, enabled: true, shedCode: null },
        { id: 'rule-shed', metric: DISEASE_RATIO_METRIC, threshold: 1, enabled: true, shedCode: 'S02' },
        { id: 'rule-severe', metric: DISEASE_SEVERE_METRIC, threshold: 4, enabled: true, shedCode: null },
        { id: 'rule-severe-shed', metric: DISEASE_SEVERE_METRIC, threshold: 1, enabled: true, shedCode: 'S02' },
        { id: 'rule-temp', metric: 'temperature_high', threshold: 28, enabled: true, shedCode: null },
      ],
      sheds,
    );
    assert.equal(active.ratio.ruleId, 'rule-ratio');
    assert.equal(active.ratio.note, '病害预警 比例≥20% 当前20%');
    assert.equal(formatDiseaseWarnRatioNote(active.ratio), '病害预警 比例≥20% 当前20%');
    assert.equal(active.severe.ruleId, 'rule-severe');
    assert.equal(active.severe.note, '病害预警 重度≥4 当前4');
    assert.equal(formatDiseaseWarnSevereNote(active.severe), '病害预警 重度≥4 当前4');
    const shedOnly = evaluateDiseaseWarning(
      [
        { id: 'rule-s01', metric: DISEASE_RATIO_METRIC, threshold: 20, enabled: true, shedCode: 'S01' },
        { id: 'rule-sev', metric: DISEASE_SEVERE_METRIC, threshold: 4, enabled: true, shedCode: 'S01' },
      ],
      sheds,
    );
    assert.equal(shedOnly.ratio.note, '病害预警 棚区 S01 比例≥20% 当前20%');
    assert.equal(shedOnly.severe.note, '病害预警 棚区 S01 重度≥4 当前4');
    const missing = evaluateDiseaseWarning([], sheds);
    assert.equal(missing.ratio.threshold, null);
    assert.equal(missing.severe.threshold, null);
    assert.equal(formatDiseaseWarnConfig(missing), DISEASE_WARN_LABEL.unset);
    assert.equal(formatDiseaseWarnConfig(missing), '尚未配置病害比例/重度阈值');
    const ratioOnly = evaluateDiseaseWarning(
      [{ id: 'rule-ratio', metric: DISEASE_RATIO_METRIC, threshold: 20, enabled: true, shedCode: null }],
      sheds,
    );
    assert.match(formatDiseaseWarnConfig(ratioOnly), /尚未配置重度病害数量阈值/);
    const parsed = parseDiseaseWarning({
      ...diseaseWarnOverviewFields(active),
      todayDiseaseCount: 4,
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      const back = diseaseWarnFromOverview(parsed.value);
      assert.equal(back.ratio.note, '病害预警 比例≥20% 当前20%');
      assert.equal(back.severe.note, '病害预警 重度≥4 当前4');
    }
    const mismatched = parseDiseaseWarning({
      ...diseaseWarnOverviewFields(active),
      diseaseWarnRatioNote: '病害预警 比例≥20% 当前21%',
    });
    assert.equal(mismatched.ok, false);
    assert.equal(parseDiseaseWarning({}).ok, false);
    assert.match(DISEASE_RATIO_THRESHOLD_ERROR, /大于等于 0 的整数/);
    assert.match(DISEASE_SEVERE_THRESHOLD_ERROR, /大于等于 0 的整数/);
  });

  it('warns when trailing cap-diameter stall days meet the integer threshold', () => {
    assert.equal(growthStallThresholdInteger(2), 2);
    assert.equal(growthStallThresholdInteger('0'), 0);
    assert.equal(growthStallThresholdInteger(2.5), null);
    assert.equal(growthStallThresholdInteger(-1), null);
    assert.equal(GROWTH_STALL_METRIC, 'live_growth_stall');
    const today = '2026-10-16';
    const flat = [
      { shedCode: 'S01', cameraCode: 'CAM-GST-01', day: '2026-10-14', capDiameterMean: 4 },
      { shedCode: 'S01', cameraCode: 'CAM-GST-01', day: '2026-10-15', capDiameterMean: 4 },
      { shedCode: 'S01', cameraCode: 'CAM-GST-01', day: '2026-10-16', capDiameterMean: 4 },
      { shedCode: 'S02', cameraCode: 'CAM-GST-ZERO', day: '2026-10-16', capDiameterMean: 4 },
      { shedCode: 'S01', cameraCode: '', day: '2026-10-16', capDiameterMean: 9 },
    ];
    assert.equal(
      trailingStallDays(
        flat.filter((point) => point.cameraCode === 'CAM-GST-01'),
        today,
      ),
      2,
    );
    assert.equal(
      trailingStallDays(
        [
          { day: '2026-10-15', capDiameterMean: 4 },
          { day: '2026-10-16', capDiameterMean: 4.2 },
        ],
        today,
      ),
      0,
    );
    assert.equal(trailingStallDays([{ day: '2026-10-16', capDiameterMean: 4 }], today), 0);
    assert.equal(
      trailingStallDays(
        [
          { day: '2026-10-14', capDiameterMean: 4 },
          { day: '2026-10-16', capDiameterMean: 4 },
        ],
        today,
      ),
      0,
    );
    assert.equal(
      trailingStallDays(
        [
          { day: '2026-10-15', capDiameterMean: 4.2 },
          { day: '2026-10-16', capDiameterMean: 4 },
        ],
        today,
      ),
      1,
    );
    const quiet = evaluateGrowthStallWarning(
      [{ id: 'rule-stall', metric: GROWTH_STALL_METRIC, threshold: 3, enabled: true, shedCode: null }],
      flat,
      today,
    );
    assert.equal(quiet.active, false);
    assert.equal(quiet.current, 2);
    assert.equal(quiet.note, '');
    assert.equal(formatGrowthStallConfig(quiet), '菌盖生长停滞阈值 3 · 全场 · 当前停滞 2');
    const active = evaluateGrowthStallWarning(
      [
        { id: 'rule-stall', metric: GROWTH_STALL_METRIC, threshold: 2, enabled: true, shedCode: null },
        { id: 'rule-shed', metric: GROWTH_STALL_METRIC, threshold: 1, enabled: true, shedCode: 'S02' },
        { id: 'rule-seed', metric: 'growth_stall', threshold: 0.05, enabled: true, shedCode: null },
      ],
      flat,
      today,
    );
    assert.equal(active.ruleId, 'rule-stall');
    assert.equal(active.shedCode, null);
    assert.equal(active.threshold, 2);
    assert.equal(active.current, 2);
    assert.equal(active.active, true);
    assert.equal(formatGrowthStallNote(active), '生长异常预警 停滞≥2 当前2');
    assert.equal(active.note, '生长异常预警 停滞≥2 当前2');
    const shedOnly = evaluateGrowthStallWarning(
      [{ id: 'rule-s01', metric: GROWTH_STALL_METRIC, threshold: 2, enabled: true, shedCode: 'S01' }],
      flat,
      today,
    );
    assert.equal(shedOnly.note, '生长异常预警 棚区 S01 停滞≥2 当前2');
    const missing = evaluateGrowthStallWarning([], flat, today);
    assert.equal(missing.threshold, null);
    assert.equal(missing.current, 2);
    assert.equal(missing.active, false);
    assert.equal(formatGrowthStallConfig(missing), GROWTH_STALL_LABEL.unset);
    assert.equal(formatGrowthStallConfig(missing), '尚未配置菌盖生长停滞阈值');
    const parsed = parseGrowthStallWarning({
      ...growthStallOverviewFields(active),
      liveMatureTotal: 8,
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(growthStallFromOverview(parsed.value).note, '生长异常预警 停滞≥2 当前2');
    }
    const mismatched = parseGrowthStallWarning({
      ...growthStallOverviewFields(active),
      growthStallNote: '生长异常预警 停滞≥2 当前3',
    });
    assert.equal(mismatched.ok, false);
    assert.equal(parseGrowthStallWarning({}).ok, false);
    assert.match(GROWTH_STALL_THRESHOLD_ERROR, /大于等于 0 的整数/);
  });

  it('averages farm environment means per sensor and formats the note', () => {
    const clean = meanFarmEnvironment([
      { temperature: 22, humidity: 78, co2: 620, substrateMoisture: 68 },
      { temperature: 26, humidity: 92, co2: 980, substrateMoisture: 78 },
    ]);
    assert.deepEqual(clean, {
      envMeanTemperature: 24,
      envMeanHumidity: 85,
      envMeanCo2: 800,
      envMeanSubstrateMoisture: 73,
    });
    const partial = meanFarmEnvironment([
      { temperature: 22, humidity: 78, co2: 620, substrateMoisture: 68 },
      { temperature: 26, humidity: null, co2: 980, substrateMoisture: 78 },
      { temperature: 20, co2: null },
    ]);
    assert.equal(partial.envMeanTemperature, 22.7);
    assert.equal(partial.envMeanHumidity, 78);
    assert.equal(partial.envMeanCo2, 800);
    assert.equal(partial.envMeanSubstrateMoisture, 73);
    assert.deepEqual(meanFarmEnvironment([]), {
      envMeanTemperature: null,
      envMeanHumidity: null,
      envMeanCo2: null,
      envMeanSubstrateMoisture: null,
    });
    assert.equal(
      formatEnvMeanNote(clean),
      '全园环境参数均值 温度 24℃ · 湿度 85% · CO₂ 800ppm · 基质含水率 73%',
    );
    assert.equal(
      formatEnvMeanNote(meanFarmEnvironment([])),
      '全园环境参数均值 温度 — · 湿度 — · CO₂ — · 基质含水率 —',
    );
    assert.equal(ENV_MEAN_LABEL.title, '全园环境参数均值');
    assert.equal(formatEnvMeanValue(22.66, '℃'), '22.7℃');
    assert.equal(formatEnvMeanValue(null, '℃'), '—');
    const parsed = parseFarmEnvMeans({
      ...clean,
      liveMushroomTotal: 30,
      env: { avgTemp: 1 },
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.deepEqual(parsed.value, clean);
    const missing = parseFarmEnvMeans({});
    assert.equal(missing.ok, true);
    if (missing.ok) {
      assert.equal(missing.value.envMeanTemperature, null);
    }
    const text = parseFarmEnvMeans({
      envMeanTemperature: '24',
      envMeanHumidity: 85,
      envMeanCo2: 800,
      envMeanSubstrateMoisture: 73,
    });
    assert.equal(text.ok, false);
  });

  it('counts distinct sensors outside enabled env thresholds', () => {
    const seed = [
      { metric: 'temperature_high', threshold: 28, enabled: true, shedCode: null },
      { metric: 'temperature_low', threshold: 12, enabled: true, shedCode: null },
      { metric: 'humidity_low', threshold: 70, enabled: true, shedCode: null },
      { metric: 'humidity_high', threshold: 98, enabled: true, shedCode: null },
      { metric: 'co2_high', threshold: 2000, enabled: true, shedCode: null },
      { metric: 'substrate_moisture_low', threshold: 50, enabled: true, shedCode: null },
      { metric: 'disease_count', threshold: 1, enabled: true, shedCode: null },
    ];
    const hotAndDry = {
      shedCode: 'S01',
      sensorCode: 'SENSOR-EAC-01',
      temperature: 32,
      humidity: 55,
      co2: 800,
      substrateMoisture: 65,
    };
    const drySubstrate = {
      shedCode: 'S02',
      sensorCode: 'SENSOR-EAC-02',
      temperature: 22,
      humidity: 80,
      co2: 900,
      substrateMoisture: 40,
    };
    const normal = {
      shedCode: 'S01',
      sensorCode: 'SENSOR-EAC-OK',
      temperature: 22,
      humidity: 80,
      co2: 800,
      substrateMoisture: 65,
    };
    const edge = {
      shedCode: 'S01',
      sensorCode: 'SENSOR-EAC-EDGE',
      temperature: 28,
      humidity: 70,
      co2: 2000,
      substrateMoisture: 50,
    };
    assert.equal(sensorIsEnvAnomaly(hotAndDry, seed), true);
    assert.equal(sensorIsEnvAnomaly(drySubstrate, seed), true);
    assert.equal(sensorIsEnvAnomaly(normal, seed), false);
    assert.equal(sensorIsEnvAnomaly(edge, seed), false);
    assert.equal(
      countEnvAnomalyPoints(
        [
          hotAndDry,
          drySubstrate,
          normal,
          edge,
          { ...hotAndDry, humidity: 40 },
          { shedCode: 'S01', sensorCode: '', temperature: 40, humidity: 40, co2: 3000, substrateMoisture: 10 },
        ],
        seed,
      ),
      2,
    );
    assert.equal(countEnvAnomalyPoints([], seed), 0);
    assert.equal(countEnvAnomalyPoints([hotAndDry], []), 0);
    assert.equal(
      countEnvAnomalyPoints([hotAndDry], [{ ...seed[0], enabled: false }]),
      0,
    );
    const shedTight = [
      { metric: 'temperature_high', threshold: 28, enabled: true, shedCode: null },
      { metric: 'temperature_high', threshold: 20, enabled: true, shedCode: 'S01' },
    ];
    const warm = {
      shedCode: 'S01',
      sensorCode: 'SENSOR-WARM',
      temperature: 22,
      humidity: 80,
      co2: 800,
      substrateMoisture: 65,
    };
    assert.equal(sensorIsEnvAnomaly(warm, shedTight), true);
    assert.equal(
      sensorIsEnvAnomaly({ ...warm, shedCode: 'S02', sensorCode: 'SENSOR-WARM-S02' }, shedTight),
      false,
    );
    assert.equal(ENV_ANOMALY_POINT_LABEL, '异常环境点位数');
    assert.equal(formatEnvAnomalyPointNote(2), '异常环境点位数 2');
    assert.equal(formatEnvAnomalyPointNote(0), '异常环境点位数 0');
    const parsed = parseEnvAnomalyPointCount({
      envAnomalyPointCount: 2,
      envMeanTemperature: 24,
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.deepEqual(parsed.value, { envAnomalyPointCount: 2 });
    assert.equal(parseEnvAnomalyPointCount({}).ok, false);
    assert.equal(parseEnvAnomalyPointCount({ envAnomalyPointCount: 1.5 }).ok, false);
    assert.equal(parseEnvAnomalyPointCount({ envAnomalyPointCount: -1 }).ok, false);
  });

  it('counts online devices by type and formats the note', () => {
    const devices = [
      { type: 'camera', onlineStatus: 'online' },
      { type: 'camera', onlineStatus: 'offline' },
      { type: 'camera', onlineStatus: 'offline' },
      { type: 'ai_box', onlineStatus: 'online' },
      { type: 'ai_box', onlineStatus: 'offline' },
      { type: 'sensor', onlineStatus: 'online' },
      { type: 'sensor', onlineStatus: 'offline' },
      { type: 'other', onlineStatus: 'online' },
      { type: 'camera', onlineStatus: 'asleep' },
    ];
    const counts = countDevicesOnlineByType(devices);
    assert.deepEqual(counts, {
      cameraOnline: 1,
      cameraTotal: 4,
      aiBoxOnline: 1,
      aiBoxTotal: 2,
      sensorOnline: 1,
      sensorTotal: 2,
    });
    assert.equal(countDevicesOnlineByType([]).cameraTotal, 0);
    assert.equal(DEVICE_ONLINE_BY_TYPE_LABEL.title, '全局设备在线');
    assert.equal(DEVICE_ONLINE_BY_TYPE_LABEL.aiBox, 'AI盒子');
    assert.equal(formatDeviceOnlineRatio(1, 6), '1/6');
    assert.equal(
      formatDeviceOnlineByTypeNote({
        cameraOnline: 1,
        cameraTotal: 6,
        aiBoxOnline: 1,
        aiBoxTotal: 4,
        sensorOnline: 1,
        sensorTotal: 4,
      }),
      '摄像头 1/6 · AI盒子 1/4 · 传感器 1/4',
    );
    const parsed = parseDeviceOnlineByType({
      cameraOnline: 1,
      cameraTotal: 6,
      aiBoxOnline: 1,
      aiBoxTotal: 4,
      sensorOnline: 1,
      sensorTotal: 4,
      deviceOnline: 3,
      envAnomalyPointCount: 2,
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(formatDeviceOnlineByTypeNote(parsed.value), '摄像头 1/6 · AI盒子 1/4 · 传感器 1/4');
    }
    assert.equal(parseDeviceOnlineByType({}).ok, false);
    assert.equal(parseDeviceOnlineByType({ cameraOnline: 1.5, cameraTotal: 2, aiBoxOnline: 0, aiBoxTotal: 0, sensorOnline: 0, sensorTotal: 0 }).ok, false);
    assert.equal(
      parseDeviceOnlineByType({
        cameraOnline: 3,
        cameraTotal: 2,
        aiBoxOnline: 0,
        aiBoxTotal: 0,
        sensorOnline: 0,
        sensorTotal: 0,
      }).ok,
      false,
    );
  });

  it('loads the snapshot key fixture', () => {
    const fixture = load('snapshot-key.json');
    const when = new Date(String(fixture.recognizedAt));
    assert.equal(
      buildSnapshotObjectKey(String(fixture.shedCode), String(fixture.cameraCode), when),
      fixture.expect,
    );
  });
});
