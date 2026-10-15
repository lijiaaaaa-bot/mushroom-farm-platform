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

  it('loads the snapshot key fixture', () => {
    const fixture = load('snapshot-key.json');
    const when = new Date(String(fixture.recognizedAt));
    assert.equal(
      buildSnapshotObjectKey(String(fixture.shedCode), String(fixture.cameraCode), when),
      fixture.expect,
    );
  });
});
