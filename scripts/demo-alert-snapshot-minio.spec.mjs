import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { DEMO_CAMERA, DEMO_FIXTURE, buildDemoPayload } from './demo-one-http-recognition.mjs';
import { readFixture, repoRoot } from './lib/ingest-wire.mjs';
import {
  SNAP_CAMERA,
  SNAP_SHED,
  SNAP_TEMPERATURE,
  SNAP_TITLE,
  alertDetailUrl,
  assertSnapshotDetail,
  buildSnapshotRecognition,
  formatSnapshotProof,
  isSnapshotAlert,
  sendSnapshotAlertDemo,
} from './demo-alert-snapshot-minio.mjs';

const now = new Date('2026-10-14T01:02:03.004Z');
const recognitionId = '55555555-5555-4555-8555-555555555555';
const alertId = '77777777-7777-4777-8777-777777777777';
const objectKey = 'snapshots/S01/2026-10-14/CAM-SNAP-01/1728867723004.jpg';

function detailBody(overrides = {}) {
  return {
    id: alertId,
    shedCode: SNAP_SHED,
    cameraCode: SNAP_CAMERA,
    level: 'severe',
    status: 'open',
    title: SNAP_TITLE,
    message: `棚区 ${SNAP_SHED} 摄像头 ${SNAP_CAMERA} 温度过高 ${SNAP_TEMPERATURE}，阈值 28`,
    metric: 'temperature_high',
    metricValue: SNAP_TEMPERATURE,
    threshold: 28,
    snapshotObjectKey: objectKey,
    recognitionId,
    createdAt: now.toISOString(),
    ...overrides,
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

function jpegResponse(bytes) {
  return {
    ok: true,
    status: 200,
    async arrayBuffer() {
      return Uint8Array.from(bytes).buffer;
    },
    async text() {
      return '';
    },
  };
}

test('snapshot recognition keeps the sample JPEG and leaves CAM-DEMO-01 on disk', () => {
  const fixture = readFixture(DEMO_FIXTURE);
  assert.equal(fixture.body.cameraCode, DEMO_CAMERA);
  const body = buildSnapshotRecognition(now);
  assert.equal(body.cameraCode, SNAP_CAMERA);
  assert.equal(body.shedCode, SNAP_SHED);
  assert.equal(body.temperature, SNAP_TEMPERATURE);
  assert.equal(body.snapshotBase64, fixture.body.snapshotBase64);
  assert.match(body.idempotencyKey, /^demo-snap-\d+$/);
  assert.equal(readFixture(DEMO_FIXTURE).body.cameraCode, 'CAM-DEMO-01');
  assert.equal(buildDemoPayload(now).cameraCode, 'CAM-DEMO-01');
  assert.equal(buildDemoPayload(now).temperature, 22.5);
  assert.equal(isSnapshotAlert(detailBody()), true);
  assert.equal(isSnapshotAlert({ ...detailBody(), cameraCode: 'CAM-ALERT-01' }), false);
  assert.equal(assertSnapshotDetail(detailBody()), objectKey);
});

test('a stored snapshot is required on the detail and the bytes match the sample', async () => {
  const original = globalThis.fetch;
  const body = buildSnapshotRecognition(now);
  const jpeg = Buffer.from(body.snapshotBase64, 'base64');
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    calls.push(`${init?.method || 'GET'} ${target}`);
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.includes('/alerts?') && target.includes('status=open')) {
      const seen = calls.filter((line) => line.includes('status=open')).length;
      if (seen === 1) return jsonResponse(200, { items: [], total: 0 });
      return jsonResponse(200, { items: [detailBody()], total: 1 });
    }
    if (target.includes('/alerts?') && target.includes('status=acked')) {
      return jsonResponse(200, { items: [], total: 0 });
    }
    if (target.endsWith('/ingest/recognition')) {
      const sent = JSON.parse(init.body);
      assert.equal(sent.cameraCode, SNAP_CAMERA);
      assert.equal(sent.temperature, SNAP_TEMPERATURE);
      assert.equal(sent.snapshotBase64, body.snapshotBase64);
      assert.equal(init.headers['x-ingest-token'], 'dev-ingest-token');
      return jsonResponse(200, {
        accepted: true,
        duplicate: false,
        id: recognitionId,
        snapshotStored: true,
      });
    }
    if (target.endsWith(`/alerts/${alertId}/snapshot`)) {
      assert.equal(init.headers.authorization, 'Bearer tok');
      return jpegResponse(jpeg);
    }
    if (target.endsWith(`/alerts/${alertId}`)) {
      assert.equal(init.headers.authorization, 'Bearer tok');
      return jsonResponse(200, detailBody());
    }
    throw new Error(`unexpected ${target}`);
  };
  try {
    const result = await sendSnapshotAlertDemo({ now });
    assert.equal(result.created, true);
    assert.equal(result.snapshotObjectKey, objectKey);
    assert.match(result.snapshotReadUrl, /\/alerts\/77777777-7777-4777-8777-777777777777\/snapshot$/);
    const proof = formatSnapshotProof({ ...result, webOrigin: 'http://127.0.0.1:43123' });
    assert.match(proof, /抓拍对象键: snapshots\/S01\/2026-10-14\/CAM-SNAP-01\/1728867723004\.jpg/);
    assert.match(proof, /告警抓拍: .+\/alerts\/77777777-7777-4777-8777-777777777777\/snapshot/);
    assert.match(proof, /告警详情: http:\/\/127\.0\.0\.1:43123\/alerts\/77777777-7777-4777-8777-777777777777/);
    assert.equal(alertDetailUrl(alertId, 'http://127.0.0.1:43123'), `http://127.0.0.1:43123/alerts/${alertId}`);
    assert.doesNotMatch(proof, /CAM-DEMO-01/);
    assert.doesNotMatch(proof, /CAM-ALERT-01/);
    assert.equal(
      calls.filter((line) => line.startsWith('POST') && line.endsWith('/ingest/recognition')).length,
      1,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('an open alert is reused when its snapshot still matches the sample JPEG', async () => {
  const original = globalThis.fetch;
  const jpeg = Buffer.from(buildSnapshotRecognition(now).snapshotBase64, 'base64');
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.includes('/alerts?')) return jsonResponse(200, { items: [detailBody()], total: 1 });
    if (target.endsWith('/ingest/recognition')) {
      return jsonResponse(200, { accepted: true, id: recognitionId, snapshotStored: true });
    }
    if (target.endsWith(`/alerts/${alertId}/snapshot`)) return jpegResponse(jpeg);
    if (target.endsWith(`/alerts/${alertId}`)) return jsonResponse(200, detailBody());
    throw new Error(`unexpected ${target}`);
  };
  try {
    const result = await sendSnapshotAlertDemo({ now });
    assert.equal(result.created, false);
    assert.match(formatSnapshotProof(result), /告警: 沿用未闭合/);
    assert.equal(result.snapshotObjectKey, objectKey);
  } finally {
    globalThis.fetch = original;
  }
});

test('missing object storage or a missing alert key fails the demo', async () => {
  const original = globalThis.fetch;
  const jpeg = Buffer.from(buildSnapshotRecognition(now).snapshotBase64, 'base64');
  async function run(mode) {
    globalThis.fetch = async (url) => {
      const target = String(url);
      if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
      if (target.includes('/alerts?')) {
        return jsonResponse(200, { items: mode === 'before-empty' ? [] : [detailBody({ snapshotObjectKey: null })], total: 1 });
      }
      if (target.endsWith('/ingest/recognition')) {
        return jsonResponse(200, {
          accepted: true,
          id: recognitionId,
          snapshotStored: mode !== 'not-stored',
        });
      }
      if (target.endsWith(`/alerts/${alertId}`)) {
        return jsonResponse(200, detailBody({ snapshotObjectKey: null }));
      }
      if (target.endsWith(`/alerts/${alertId}/snapshot`)) return jpegResponse(jpeg);
      throw new Error(`unexpected ${target}`);
    };
    await sendSnapshotAlertDemo({ now });
  }
  try {
    await assert.rejects(run('not-stored'), /没有写入对象存储/);
    await assert.rejects(run('no-key'), /抓拍对象键/);
  } finally {
    globalThis.fetch = original;
  }
});

test('the written steps name the make target, MinIO, and the detail image', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_ALERT_SNAPSHOT_MINIO.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  const earlier = [
    'docs/DEMO_ONE_INGEST.md',
    'docs/DEMO_REGISTER_AND_INGEST.md',
    'docs/DEMO_REGISTER_AND_HEARTBEAT.md',
    'docs/DEMO_ONE_ALERT.md',
    'docs/DEMO_ACK_CLOSE_ALERT.md',
    'docs/DEMO_THRESHOLD_ALERT.md',
    'docs/DEMO_ALERT_CAMERA_FILTER.md',
    'docs/DEMO_ALERT_STATUS_FILTER.md',
    'docs/DEMO_ALERT_TITLE_SEARCH.md',
    'docs/DEMO_ALERT_HANDLE_NOTE.md',
    'scripts/demo-one-alert.mjs',
    'scripts/demo-ack-close-alert.mjs',
    'scripts/demo-threshold-alert.mjs',
    'scripts/demo-alert-camera-filter.mjs',
    'scripts/demo-alert-status-filter.mjs',
    'scripts/demo-alert-title-search.mjs',
    'scripts/demo-alert-handle-note.mjs',
  ];
  assert.match(doc, /make demo-alert-snapshot-minio/);
  assert.match(doc, /admin/);
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /CAM-SNAP-01/);
  assert.match(doc, /MinIO|对象存储/);
  assert.match(doc, /打开抓拍/);
  assert.match(doc, /\/alerts/);
  assert.match(caps, /make demo-alert-snapshot-minio/);
  assert.match(caps, /DEMO_ALERT_SNAPSHOT_MINIO\.md/);
  assert.match(caps, /GET \/api\/v1\/alerts\/:id\/snapshot/);
  assert.match(status, /make demo-alert-snapshot-minio/);
  assert.match(readme, /DEMO_ALERT_SNAPSHOT_MINIO\.md/);
  for (const rel of earlier) {
    const text = readFileSync(join(root, rel), 'utf8');
    assert.doesNotMatch(text, /demo-alert-snapshot-minio|CAM-SNAP-01/);
  }
  assert.match(
    makefile,
    /^demo-alert-snapshot-minio:.*\n\tnode scripts\/demo-alert-snapshot-minio\.mjs\s*$/m,
  );
  assert.match(makefile, /scripts\/demo-alert-snapshot-minio\.spec\.mjs/);
  assert.match(makefile, /^demo-one-alert:.*\n\tnode scripts\/demo-one-alert\.mjs\s*$/m);
  assert.match(makefile, /^demo-alert-handle-note:.*\n\tnode scripts\/demo-alert-handle-note\.mjs\s*$/m);
  const added = readme.split('\n').filter((line) => line.includes('DEMO_ALERT_SNAPSHOT_MINIO.md'));
  assert.equal(added.length, 1);
});
