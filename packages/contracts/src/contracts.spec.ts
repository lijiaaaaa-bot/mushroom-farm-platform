import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  buildSnapshotObjectKey,
  shiftShanghaiDate,
  parseAlertFalsePositive,
  parseAlertNote,
  parseCreateAlert,
  parseEnvironmentIngress,
  parseHeartbeatIngress,
  parseRecognitionIngress,
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
    const extra = load('alert.unknown-field.json');
    const rejected = parseCreateAlert(extra.body);
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.equal(rejected.code, extra.expect);
    const note = load('alert.ack.json');
    const acked = parseAlertNote(note.body);
    assert.equal(acked.ok, note.expect === 'ok');
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
    for (const name of ['environment.golden.json', 'environment.unknown-field.json']) {
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

  it('loads the snapshot key fixture', () => {
    const fixture = load('snapshot-key.json');
    const when = new Date(String(fixture.recognizedAt));
    assert.equal(
      buildSnapshotObjectKey(String(fixture.shedCode), String(fixture.cameraCode), when),
      fixture.expect,
    );
  });
});
