import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { readFixture, repoRoot } from './lib/ingest-wire.mjs';
import { DEMO_CAMERA as FIXTURE_CAMERA, DEMO_FIXTURE as RECOGNITION_FIXTURE } from './demo-one-http-recognition.mjs';
import {
  DEMO_CAMERA,
  DEMO_COUNT,
  DEMO_FIXTURE,
  DEMO_LEVEL,
  DEMO_SENSOR,
  DEMO_SHED,
  EMPTY_WINDOW_COPY,
  INSIDE_NOW_READING,
  INSIDE_OLDER_READING,
  OUTSIDE_READING,
  assertDiseaseDetail,
  assertEmptyWindow,
  assertSameScreenEnvironment,
  buildDiseasePayload,
  buildEnvironmentPayloads,
  diseaseDetailUrl,
  formatDiseaseEnvProof,
  validateDemoPayloads,
  windowMinutes,
} from './demo-disease-env-detail.mjs';

const now = new Date('2026-10-15T01:02:03.004Z');
const id = '88888888-8888-4888-8888-888888888888';

test('payload keeps both fixture files and only changes this request', () => {
  const recognitionFile = readFixture(RECOGNITION_FIXTURE);
  assert.equal(recognitionFile.body.cameraCode, FIXTURE_CAMERA);
  assert.equal(recognitionFile.body.cameraCode, 'CAM-DEMO-01');
  assert.equal(recognitionFile.body.diseaseCount, 1);
  assert.equal(recognitionFile.body.temperature, 22.5);
  const envFile = readFixture(DEMO_FIXTURE);
  assert.equal(envFile.body.sensorCode, DEMO_SENSOR);
  assert.equal(envFile.body.temperature, INSIDE_NOW_READING.temperature);
  assert.equal(envFile.older.temperature, INSIDE_OLDER_READING.temperature);
  assert.equal(envFile.outside.temperature, OUTSIDE_READING.temperature);
  const recognition = buildDiseasePayload(now);
  const payloads = validateDemoPayloads(buildEnvironmentPayloads(now), recognition, now);
  assert.equal(recognition.cameraCode, DEMO_CAMERA);
  assert.equal(recognition.shedCode, DEMO_SHED);
  assert.equal(recognition.diseaseCount, DEMO_COUNT);
  assert.equal(recognition.diseaseLevel, DEMO_LEVEL);
  assert.equal(recognition.temperature, 22.5);
  assert.match(recognition.idempotencyKey, /^demo-disease-env-\d+$/);
  assert.equal(payloads.minutes, windowMinutes());
  assert.equal(payloads.minutes, 30);
  assert.equal(payloads.older.temperature, 23.8);
  assert.equal(payloads.latest.humidity, 86);
  assert.equal(payloads.latest.co2, 710);
  assert.equal(payloads.older.substrateMoisture, 73);
  assert.equal(payloads.outside.temperature, 16.8);
  assert.notEqual(payloads.latest.temperature, recognition.temperature);
  assert.equal(readFixture(RECOGNITION_FIXTURE).body.cameraCode, 'CAM-DEMO-01');
  assert.equal(readFixture(DEMO_FIXTURE).body.temperature, 24.1);
  assert.equal(readFixture('environment.golden.json').body.sensorCode !== DEMO_SENSOR, true);
});

test('same-screen contract keeps in-window numbers and rejects the empty and outside paths', () => {
  const recognition = buildDiseasePayload(now);
  const payloads = validateDemoPayloads(buildEnvironmentPayloads(now), recognition, now);
  const env = {
    recognition: {
      id,
      shedCode: DEMO_SHED,
      cameraCode: DEMO_CAMERA,
      recognizedAt: recognition.recognizedAt,
      diseaseLevel: DEMO_LEVEL,
      diseaseCount: DEMO_COUNT,
    },
    window: {
      start: new Date(now.getTime() - 30 * 60_000).toISOString(),
      end: new Date(now.getTime() + 30 * 60_000).toISOString(),
      beforeMinutes: 30,
      afterMinutes: 30,
    },
    alignment: { shedCode: DEMO_SHED, sensorCode: null },
    readings: [
      {
        id: 'older',
        shedCode: DEMO_SHED,
        sensorCode: DEMO_SENSOR,
        observedAt: payloads.older.observedAt,
        ...INSIDE_OLDER_READING,
      },
      {
        id: 'latest',
        shedCode: DEMO_SHED,
        sensorCode: DEMO_SENSOR,
        observedAt: payloads.latest.observedAt,
        ...INSIDE_NOW_READING,
      },
    ],
    empty: false,
    emptyReason: null,
  };
  assertSameScreenEnvironment(env, recognition);
  assertDiseaseDetail(
    {
      id,
      shedCode: DEMO_SHED,
      cameraCode: DEMO_CAMERA,
      recognizedAt: recognition.recognizedAt,
      diseaseLevel: DEMO_LEVEL,
      diseaseCount: DEMO_COUNT,
      snapshotObjectKey: 'snapshots/S01/demo.jpg',
    },
    recognition,
  );
  assert.throws(
    () =>
      assertSameScreenEnvironment(
        {
          ...env,
          readings: [
            ...env.readings,
            {
              id: 'outside',
              shedCode: DEMO_SHED,
              sensorCode: DEMO_SENSOR,
              observedAt: payloads.outside.observedAt,
              ...OUTSIDE_READING,
            },
          ],
        },
        recognition,
      ),
    /窗外/,
  );
  assertEmptyWindow({
    recognition: env.recognition,
    window: env.window,
    readings: [],
    empty: true,
    emptyReason: EMPTY_WINDOW_COPY,
  });
  assert.throws(
    () =>
      assertEmptyWindow({
        empty: true,
        emptyReason: '暂无',
        readings: [],
      }),
    /空窗说明/,
  );
  assert.throws(
    () =>
      assertEmptyWindow({
        empty: true,
        emptyReason: EMPTY_WINDOW_COPY,
        readings: [{ temperature: 22.5 }],
      }),
    /空窗/,
  );
});

test('proof prints the detail url and the in-window numbers', () => {
  const recognition = buildDiseasePayload(now);
  const payloads = validateDemoPayloads(buildEnvironmentPayloads(now), recognition, now);
  const proof = formatDiseaseEnvProof({
    id,
    recognition,
    older: payloads.older,
    latest: payloads.latest,
    outside: payloads.outside,
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /病害详情: 新建/);
  assert.match(proof, /位置: CAM-DED-01/);
  assert.match(proof, /棚区: S01/);
  assert.match(proof, /病害等级: 1/);
  assert.match(proof, /病害数量: 2/);
  assert.match(proof, /传感器: SENSOR-DED-01/);
  assert.match(proof, /23\.8℃/);
  assert.match(proof, /湿度 84%/);
  assert.match(proof, /CO₂ 640/);
  assert.match(proof, /基质含水率 73%/);
  assert.match(proof, /24\.1℃/);
  assert.match(proof, /湿度 86%/);
  assert.match(proof, /CO₂ 710/);
  assert.match(proof, /基质含水率 75%/);
  assert.match(proof, /窗外不显示: 16\.8℃/);
  assert.match(proof, /该时间窗内无环境读数/);
  assert.match(
    proof,
    new RegExp(diseaseDetailUrl(id, 'http://127.0.0.1:43123').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
  assert.match(proof, /\/diseases\/88888888-8888-4888-8888-888888888888/);
  assert.doesNotMatch(proof, /CAM-DEMO-01/);
});

test('make target and the demo doc name the same-screen readings', () => {
  const root = repoRoot();
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  assert.match(makefile, /^demo-disease-env-detail:.*\n\tnode scripts\/demo-disease-env-detail\.mjs\s*$/m);
  assert.match(makefile, /scripts\/demo-disease-env-detail\.spec\.mjs/);
  const doc = readFileSync(join(root, 'docs/DEMO_DISEASE_ENV_DETAIL.md'), 'utf8');
  assert.match(doc, /make demo-disease-env-detail/);
  assert.match(doc, /CAM-DED-01/);
  assert.match(doc, /SENSOR-DED-01/);
  assert.match(doc, /23\.8/);
  assert.match(doc, /24\.1/);
  assert.match(doc, /16\.8/);
  assert.match(doc, /该时间窗内无环境读数/);
  assert.match(doc, /温度/);
  assert.match(doc, /湿度/);
  assert.match(doc, /CO₂/);
  assert.match(doc, /基质含水率/);
  assert.match(doc, /\/diseases\//);
  assert.doesNotMatch(doc, /假定|假设/);
});
