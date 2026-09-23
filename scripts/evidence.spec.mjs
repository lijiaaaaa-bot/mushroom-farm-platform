import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openEvidence } from './lib/evidence.mjs';

test('evidence summary keeps channel, fixture bytes, and outcome', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ingest-evidence-'));
  const evidence = openEvidence(dir);
  const rawUtf8 = '{"idempotencyKey":"golden-recognition-mqtt-001"}';
  evidence.addStep({
    id: 'mqtt-golden',
    timestamp: '2026-09-23T03:00:00.000Z',
    channel: 'mqtt',
    topic: 'mushroom/S01/CAM-S01-MQTT/recognition',
    fixture: 'recognition.mqtt.json',
    fixtureLabel: '契约黄金报文',
    rawBody: { idempotencyKey: 'golden-recognition-mqtt-001' },
    rawUtf8,
    responseStatus: undefined,
    pass: true,
    proof: { recognitionId: 'rec-1', source: 'mqtt' },
  });
  const summary = evidence.finish({
    pass: true,
    startedAt: '2026-09-23T03:00:00.000Z',
    mqttUrl: 'mqtt://127.0.0.1:1883',
    apiBase: 'http://127.0.0.1:41821/api/v1',
  });
  assert.equal(summary.kind, 'contract-golden-fixture-smoke');
  assert.equal(summary.pass, true);
  assert.equal(summary.steps.length, 1);
  const step = summary.steps[0];
  for (const key of ['timestamp', 'channel', 'topic', 'fixture', 'rawBody', 'pass']) {
    assert.ok(step[key] !== undefined && step[key] !== null, key);
  }
  assert.equal(step.proof.recognitionId, 'rec-1');
  assert.equal(readFileSync(join(dir, step.wireBytesFile), 'utf8'), rawUtf8);
  const onDisk = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
  assert.equal(onDisk.steps[0].topic, 'mushroom/S01/CAM-S01-MQTT/recognition');
});

test('evidence rejects a step without a topic or path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ingest-evidence-'));
  const evidence = openEvidence(dir);
  assert.throws(() =>
    evidence.addStep({
      timestamp: '2026-09-23T03:00:00.000Z',
      channel: 'http',
      fixture: 'recognition.golden.json',
      rawBody: {},
      pass: true,
    }),
  );
});
