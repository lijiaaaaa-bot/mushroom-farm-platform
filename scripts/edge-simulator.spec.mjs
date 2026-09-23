import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { planSend } from './edge-simulator.mjs';

const now = new Date('2026-09-23T03:04:05.000Z');

test('mqtt plan sends fixture body bytes, not the clock/expect wrapper', () => {
  const plan = planSend(['--channel', 'mqtt', '--fixture', 'recognition.mqtt.json'], { now });
  assert.equal(plan.topic, 'mushroom/S01/CAM-S01-MQTT/recognition');
  assert.equal(plan.fixture, 'recognition.mqtt.json');
  assert.equal(plan.fixtureLabel, '契约黄金报文');
  const body = JSON.parse(plan.rawUtf8);
  assert.equal(body.idempotencyKey, 'golden-recognition-mqtt-001');
  assert.equal(body.recognizedAt, '2026-09-23T03:04:05.000Z');
  assert.equal(body.mushroomCount, 80);
  assert.equal('clock' in body, false);
  assert.equal('expect' in body, false);
  assert.equal(plan.byteLength, Buffer.byteLength(plan.rawUtf8));
});

test('http plan targets the ingest path', () => {
  const plan = planSend(['--channel', 'http', '--fixture', 'recognition.golden.json'], { now });
  assert.equal(plan.path, '/api/v1/ingest/recognition');
  assert.equal(plan.method, 'POST');
  assert.match(plan.url, /\/ingest\/recognition$/);
  assert.equal(JSON.parse(plan.rawUtf8).cameraCode, 'CAM-S01-01');
});

test('heartbeat plan uses heartbeat.mqtt.json on the heartbeat topic', () => {
  const plan = planSend(['--channel', 'mqtt', '--heartbeat']);
  assert.equal(plan.topic, 'mushroom/S01/EDGE-SIM-BOX/heartbeat');
  assert.equal(plan.fixture, 'heartbeat.mqtt.json');
  assert.deepEqual(JSON.parse(plan.rawUtf8), {
    deviceCode: 'EDGE-SIM-BOX',
    deviceType: 'ai_box',
    online: true,
  });
});

test('raw-utf8-file is sent unchanged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'edge-raw-'));
  const file = join(dir, 'body.json');
  const raw = '{"shedCode":"S01","cameraCode":"CAM-S01-01","recognizedAt":"2020-01-01T00:00:00.000Z"}';
  writeFileSync(file, raw);
  const plan = planSend(
    ['--channel', 'mqtt', '--fixture', 'recognition.golden.json', '--raw-utf8-file', file],
    { now },
  );
  assert.equal(plan.rawUtf8, readFileSync(file, 'utf8'));
  assert.equal(plan.topic, 'mushroom/S01/CAM-S01-01/recognition');
  assert.equal(plan.fixtureLabel, '重放已计时的契约黄金报文字节');
});

test('missing channel fails before any socket', () => {
  assert.throws(() => planSend(['--fixture', 'recognition.mqtt.json']), /channel/);
});
