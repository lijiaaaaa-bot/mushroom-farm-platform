import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  buildSnapshotObjectKey,
  parseAlertNote,
  parseCreateAlert,
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
  });

  it('loads alert transition cases', () => {
    const fixture = load('alert.transitions.json');
    for (const item of fixture.cases || []) {
      const error = transitionError(item.from, item.to);
      assert.equal(error === null, item.ok);
    }
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
