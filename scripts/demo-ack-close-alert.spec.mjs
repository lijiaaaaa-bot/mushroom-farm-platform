import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { repoRoot } from './lib/ingest-wire.mjs';
import { ALERT_CAMERA, ALERT_SHED, ALERT_TITLE } from './demo-one-alert.mjs';
import {
  ACK_NOTE,
  CLOSE_NOTE,
  assertDisposed,
  disposeAlertDemo,
  formatDisposeProof,
  parseAction,
} from './demo-ack-close-alert.mjs';

const now = new Date('2026-10-14T01:02:03.004Z');
const recognitionId = '55555555-5555-4555-8555-555555555555';
const alertId = '66666666-6666-4666-8666-666666666666';

function detailBody(status) {
  return {
    id: alertId,
    shedCode: ALERT_SHED,
    cameraCode: ALERT_CAMERA,
    level: 'severe',
    status,
    title: ALERT_TITLE,
    message: `棚区 ${ALERT_SHED} 摄像头 ${ALERT_CAMERA} 温度过高 30，阈值 28`,
    metric: 'temperature_high',
    metricValue: 30,
    threshold: 28,
    createdAt: now.toISOString(),
    ackNote: status === 'open' ? null : ACK_NOTE,
    closeReason: status === 'closed' ? 'resolved' : null,
    closeNote: status === 'closed' ? CLOSE_NOTE : null,
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

function installFetch(phase) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    const method = init?.method || 'GET';
    calls.push(`${method} ${target}`);
    if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.endsWith('/ingest/recognition')) {
      const body = JSON.parse(init.body);
      assert.equal(body.cameraCode, ALERT_CAMERA);
      assert.equal(body.temperature, 30);
      if (phase.current === 'empty') phase.current = 'open';
      return jsonResponse(200, { accepted: true, duplicate: false, id: recognitionId });
    }
    if (method === 'POST' && target.endsWith(`/alerts/${alertId}/ack`)) {
      assert.equal(JSON.parse(init.body).note, ACK_NOTE);
      assert.equal(init.headers.authorization, 'Bearer tok');
      phase.current = 'acked';
      return jsonResponse(201, detailBody('acked'));
    }
    if (method === 'POST' && target.endsWith(`/alerts/${alertId}/close`)) {
      assert.equal(JSON.parse(init.body).note, CLOSE_NOTE);
      phase.current = 'closed';
      return jsonResponse(201, detailBody('closed'));
    }
    if (target.endsWith(`/alerts/${alertId}`)) {
      return jsonResponse(200, detailBody(phase.current));
    }
    if (target.includes('/alerts?')) {
      const status = new URL(target).searchParams.get('status');
      const items = status === phase.current ? [detailBody(phase.current)] : [];
      return jsonResponse(200, { items, total: items.length });
    }
    throw new Error(`unexpected ${method} ${target}`);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

test('parseAction only accepts ack or close', () => {
  assert.equal(parseAction(['ack']), 'ack');
  assert.equal(parseAction(['close']), 'close');
  assert.throws(() => parseAction([]), /ack 或 close/);
  assert.throws(() => parseAction(['ack', 'close']), /ack 或 close/);
  assertDisposed(detailBody('acked'), 'ack');
  assertDisposed(detailBody('closed'), 'close');
  assert.throws(() => assertDisposed(detailBody('open'), 'ack'), /应为已确认/);
  assert.throws(() => assertDisposed(detailBody('acked'), 'close'), /应为已关闭/);
});

test('proof names the refreshed status on the alert list', () => {
  const acked = formatDisposeProof({
    action: 'ack',
    detail: detailBody('acked'),
    seeded: false,
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(acked, /确认了 1 条告警/);
  assert.match(acked, /来源: 沿用未闭合/);
  assert.match(acked, new RegExp(`告警 id: ${alertId}`));
  assert.match(acked, /刷新后状态: 已确认/);
  assert.match(acked, /确认备注: 已确认/);
  assert.match(acked, /告警列表: http:\/\/127\.0\.0\.1:43123\/alerts$/m);
  assert.match(acked, /刷新告警列表后/);
  assert.doesNotMatch(acked, /CAM-DEMO-01/);

  const closed = formatDisposeProof({
    action: 'close',
    detail: detailBody('closed'),
    seeded: true,
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(closed, /关闭了 1 条告警/);
  assert.match(closed, /来源: 本次补了一条识别/);
  assert.match(closed, /刷新后状态: 已关闭/);
  assert.match(closed, /关闭原因: 正常关闭/);
  assert.match(closed, /关闭备注: 已关闭/);
});

test('ack re-reads the pending temperature alert as 已确认', async () => {
  const phase = { current: 'open' };
  const installed = installFetch(phase);
  try {
    const result = await disposeAlertDemo({ action: 'ack', now });
    assert.equal(result.seeded, false);
    assert.equal(result.detail.status, 'acked');
    assert.equal(result.detail.ackNote, ACK_NOTE);
    assert.equal(
      installed.calls.filter((line) => line.includes('/ingest/recognition')).length,
      0,
    );
    assert.equal(installed.calls.filter((line) => line.includes('/ack')).length, 1);
    assert.match(formatDisposeProof(result), /刷新后状态: 已确认/);
  } finally {
    installed.restore();
  }
});

test('ack refuses when the temperature alert is already 已确认', async () => {
  const phase = { current: 'acked' };
  const installed = installFetch(phase);
  try {
    await assert.rejects(
      () => disposeAlertDemo({ action: 'ack', now }),
      /已经是已确认/,
    );
    assert.equal(installed.calls.filter((line) => line.includes('/ack')).length, 0);
    assert.equal(
      installed.calls.filter((line) => line.includes('/ingest/recognition')).length,
      0,
    );
    assert.equal(phase.current, 'acked');
  } finally {
    installed.restore();
  }
});

test('ack seeds one recognition when no temperature alert is open', async () => {
  const phase = { current: 'empty' };
  const installed = installFetch(phase);
  try {
    const result = await disposeAlertDemo({ action: 'ack', now });
    assert.equal(result.seeded, true);
    assert.equal(result.detail.status, 'acked');
    assert.equal(
      installed.calls.filter((line) => line.startsWith('POST') && line.endsWith('/ingest/recognition'))
        .length,
      1,
    );
    assert.match(formatDisposeProof(result), /来源: 本次补了一条识别/);
  } finally {
    installed.restore();
  }
});

test('close re-reads the alert as 已关闭 and drops it from the open list', async () => {
  const phase = { current: 'open' };
  const installed = installFetch(phase);
  try {
    const result = await disposeAlertDemo({ action: 'close', now });
    assert.equal(result.seeded, false);
    assert.equal(result.detail.status, 'closed');
    assert.equal(result.detail.closeReason, 'resolved');
    assert.equal(result.detail.closeNote, CLOSE_NOTE);
    assert.equal(installed.calls.filter((line) => line.includes('/close')).length, 1);
    assert.match(formatDisposeProof(result), /刷新后状态: 已关闭/);
  } finally {
    installed.restore();
  }
});

test('close seeds one recognition when nothing is still open or acked', async () => {
  const phase = { current: 'empty' };
  const installed = installFetch(phase);
  try {
    const result = await disposeAlertDemo({ action: 'close', now });
    assert.equal(result.seeded, true);
    assert.equal(result.detail.status, 'closed');
    assert.equal(
      installed.calls.filter((line) => line.endsWith('/ingest/recognition')).length,
      1,
    );
  } finally {
    installed.restore();
  }
});

test('the written steps name both make targets and leave the earlier demos alone', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_ACK_CLOSE_ALERT.md'), 'utf8');
  const alertDoc = readFileSync(join(root, 'docs/DEMO_ONE_ALERT.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const one = readFileSync(join(root, 'docs/DEMO_ONE_INGEST.md'), 'utf8');
  const registerDoc = readFileSync(join(root, 'docs/DEMO_REGISTER_AND_INGEST.md'), 'utf8');
  const heartbeatDoc = readFileSync(join(root, 'docs/DEMO_REGISTER_AND_HEARTBEAT.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  const alertScript = readFileSync(join(root, 'scripts/demo-one-alert.mjs'), 'utf8');
  assert.match(doc, /make demo-one-alert/);
  assert.match(doc, /make demo-ack-one-alert/);
  assert.match(doc, /make demo-close-one-alert/);
  assert.match(doc, /admin/);
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /待确认/);
  assert.match(doc, /确认/);
  assert.match(doc, /关闭/);
  assert.match(doc, /刷新/);
  assert.match(doc, /已确认/);
  assert.match(doc, /已关闭/);
  assert.match(alertDoc, /DEMO_ACK_CLOSE_ALERT\.md/);
  assert.match(caps, /make demo-ack-one-alert/);
  assert.match(caps, /make demo-close-one-alert/);
  assert.match(caps, /DEMO_ACK_CLOSE_ALERT\.md/);
  assert.match(status, /make demo-ack-one-alert/);
  assert.match(status, /make demo-close-one-alert/);
  assert.match(readme, /DEMO_ACK_CLOSE_ALERT\.md/);
  assert.doesNotMatch(one, /demo-ack-one-alert/);
  assert.doesNotMatch(one, /demo-close-one-alert/);
  assert.doesNotMatch(registerDoc, /demo-ack-one-alert/);
  assert.doesNotMatch(heartbeatDoc, /demo-close-one-alert/);
  assert.doesNotMatch(alertScript, /demo-ack-close-alert/);
  assert.match(makefile, /^demo-one-alert:.*\n\tnode scripts\/demo-one-alert\.mjs\s*$/m);
  assert.match(makefile, /^demo-ack-one-alert:.*\n\tnode scripts\/demo-ack-close-alert\.mjs ack\s*$/m);
  assert.match(
    makefile,
    /^demo-close-one-alert:.*\n\tnode scripts\/demo-ack-close-alert\.mjs close\s*$/m,
  );
  assert.match(makefile, /scripts\/demo-ack-close-alert\.spec\.mjs/);
  const added = readme.split('\n').filter((line) => line.includes('DEMO_ACK_CLOSE_ALERT.md'));
  assert.equal(added.length, 1);
});
