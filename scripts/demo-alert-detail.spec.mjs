import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { repoRoot } from './lib/ingest-wire.mjs';
import {
  ALERT_CAMERA,
  ALERT_SHED,
  ALERT_TEMPERATURE,
  ALERT_THRESHOLD,
  ALERT_TITLE,
} from './demo-one-alert.mjs';
import { formatDetailProof, sendAlertDetailDemo } from './demo-alert-detail.mjs';

const now = new Date('2026-10-14T01:02:03.004Z');
const recognitionId = '55555555-5555-4555-8555-555555555555';
const alertId = '66666666-6666-4666-8666-666666666666';

function detailBody(id = alertId) {
  return {
    id,
    shedCode: ALERT_SHED,
    cameraCode: ALERT_CAMERA,
    level: 'severe',
    status: 'open',
    title: ALERT_TITLE,
    message: `棚区 ${ALERT_SHED} 摄像头 ${ALERT_CAMERA} 温度过高 ${ALERT_TEMPERATURE}，阈值 ${ALERT_THRESHOLD}`,
    metric: 'temperature_high',
    metricValue: ALERT_TEMPERATURE,
    threshold: ALERT_THRESHOLD,
    createdAt: now.toISOString(),
    claimedBy: null,
    claimedAt: null,
    ackedBy: null,
    ackedAt: null,
    closeReason: null,
    closedBy: null,
    closedAt: null,
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

test('proof prints the detail path and the fields on that page', () => {
  const proof = formatDetailProof({
    created: true,
    detail: detailBody(),
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /告警: 新建/);
  assert.match(proof, new RegExp(`告警 id: ${alertId}`));
  assert.match(proof, new RegExp(`告警详情: http://127\\.0\\.0\\.1:43123/alerts/${alertId}`));
  assert.match(proof, /标题: 温度过高告警/);
  assert.match(proof, /说明: 棚区 S01 摄像头 CAM-ALERT-01 温度过高 30，阈值 28/);
  assert.match(proof, /级别: 严重/);
  assert.match(proof, /状态: 待确认/);
  assert.match(proof, /棚区: S01/);
  assert.match(proof, /摄像头: CAM-ALERT-01/);
  assert.match(proof, new RegExp(`发生时间: ${now.toISOString()}`));
  assert.match(proof, /指标: 温度过高/);
  assert.match(proof, /当前值: 30℃/);
  assert.match(proof, /阈值: 28℃/);
  assert.match(proof, /认领人: —/);
  assert.match(proof, /认领时间: —/);
  assert.match(proof, /确认人: —/);
  assert.match(proof, /确认时间: —/);
  assert.match(proof, /关闭原因: —/);
  assert.match(proof, /关闭人: —/);
  assert.match(proof, /关闭时间: —/);
  assert.match(proof, /登录: admin \/ Admin@123456/);
  assert.doesNotMatch(proof, /告警列表:/);
  assert.doesNotMatch(proof, /CAM-DEMO-01/);
  assert.throws(() => formatDetailProof({ created: true, detail: { ...detailBody(), id: '' } }));
});

test('one hot recognition is enough and the detail url is /alerts/<id>', async () => {
  const original = globalThis.fetch;
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
      const body = JSON.parse(init.body);
      assert.equal(body.cameraCode, ALERT_CAMERA);
      assert.equal(body.temperature, ALERT_TEMPERATURE);
      return jsonResponse(200, { accepted: true, duplicate: false, id: recognitionId });
    }
    if (target.endsWith(`/alerts/${alertId}`)) return jsonResponse(200, detailBody());
    throw new Error(`unexpected ${target}`);
  };
  try {
    const result = await sendAlertDetailDemo({ now });
    assert.equal(result.created, true);
    assert.equal(result.detail.id, alertId);
    assert.equal(
      calls.filter((line) => line.startsWith('POST') && line.endsWith('/ingest/recognition')).length,
      1,
    );
    const proof = formatDetailProof({ ...result, webOrigin: 'http://127.0.0.1:43123' });
    assert.match(proof, new RegExp(`/alerts/${alertId}`));
  } finally {
    globalThis.fetch = original;
  }
});

test('an open temperature alert is reused and the same detail url is printed', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.includes('/alerts?')) return jsonResponse(200, { items: [detailBody()], total: 1 });
    if (target.endsWith('/ingest/recognition')) {
      return jsonResponse(200, { accepted: true, duplicate: false, id: recognitionId });
    }
    if (target.endsWith(`/alerts/${alertId}`)) return jsonResponse(200, detailBody());
    throw new Error(`unexpected ${target}`);
  };
  try {
    const result = await sendAlertDetailDemo({ now });
    assert.equal(result.created, false);
    assert.match(
      formatDetailProof({ ...result, webOrigin: 'http://127.0.0.1:43123' }),
      /告警: 沿用未闭合/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('the written steps name this make target and leave earlier demos alone', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_ALERT_DETAIL.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  const earlier = [
    'docs/DEMO_ONE_ALERT.md',
    'docs/DEMO_ACK_CLOSE_ALERT.md',
    'docs/DEMO_ALERT_ACK.md',
    'docs/DEMO_ALERT_CAMERA_FILTER.md',
    'docs/DEMO_ALERT_STATUS_FILTER.md',
    'docs/DEMO_ALERT_TITLE_SEARCH.md',
    'docs/DEMO_ALERT_HANDLE_NOTE.md',
    'docs/DEMO_ALERT_SNAPSHOT_MINIO.md',
    'docs/DEMO_CAMERA_DETAIL.md',
    'scripts/demo-one-alert.mjs',
    'scripts/demo-ack-close-alert.mjs',
    'scripts/demo-alert-ack.mjs',
  ];
  assert.match(doc, /make demo-alert-detail/);
  assert.match(doc, /admin/);
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /CAM-ALERT-01/);
  assert.match(doc, /温度过高告警/);
  assert.match(doc, /\/alerts\/<告警 id>/);
  assert.match(doc, /标题/);
  assert.match(doc, /说明/);
  assert.match(doc, /级别/);
  assert.match(doc, /状态/);
  assert.match(doc, /棚区/);
  assert.match(doc, /摄像头/);
  assert.match(doc, /发生时间/);
  assert.match(doc, /指标/);
  assert.match(doc, /当前值/);
  assert.match(doc, /阈值/);
  assert.match(doc, /30℃/);
  assert.match(doc, /28℃/);
  assert.match(doc, /确认人/);
  assert.match(doc, /关闭人/);
  assert.doesNotMatch(doc, /时间范围/);
  assert.match(caps, /make demo-alert-detail/);
  assert.match(caps, /DEMO_ALERT_DETAIL\.md/);
  assert.match(status, /make demo-alert-detail/);
  assert.match(readme, /DEMO_ALERT_DETAIL\.md/);
  for (const rel of earlier) {
    const text = readFileSync(join(root, rel), 'utf8');
    assert.doesNotMatch(text, /demo-alert-detail/);
  }
  assert.match(makefile, /^demo-alert-detail:.*\n\tnode scripts\/demo-alert-detail\.mjs\s*$/m);
  assert.match(makefile, /scripts\/demo-alert-detail\.spec\.mjs/);
  assert.match(makefile, /^demo-one-alert:.*\n\tnode scripts\/demo-one-alert\.mjs\s*$/m);
  assert.match(makefile, /^demo-ack-one-alert:.*\n\tnode scripts\/demo-ack-close-alert\.mjs ack\s*$/m);
  assert.match(
    makefile,
    /^demo-close-one-alert:.*\n\tnode scripts\/demo-ack-close-alert\.mjs close\s*$/m,
  );
  assert.match(makefile, /^demo-alert-ack:.*\n\tnode scripts\/demo-alert-ack\.mjs\s*$/m);
  const added = readme.split('\n').filter((line) => line.includes('DEMO_ALERT_DETAIL.md'));
  assert.equal(added.length, 1);
});
