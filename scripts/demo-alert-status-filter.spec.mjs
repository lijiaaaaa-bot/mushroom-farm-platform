import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { CLOSE_NOTE } from './demo-ack-close-alert.mjs';
import { repoRoot } from './lib/ingest-wire.mjs';
import {
  CLOSED_CAMERA,
  CLOSED_STATUS,
  OPEN_CAMERA,
  OPEN_STATUS,
  STATUS_LEVEL,
  STATUS_ROWS,
  STATUS_SHED,
  alertMessage,
  assertBothPresent,
  assertDetail,
  assertOnlyStatus,
  formatStatusProof,
  pickClosable,
  pickClosed,
  pickOpen,
  sendStatusFilterDemo,
} from './demo-alert-status-filter.mjs';

const openId = '11111111-1111-4111-8111-111111111111';
const closedId = '22222222-2222-4222-8222-222222222222';
const keptId = '33333333-3333-4333-8333-333333333333';

function row(id, cameraCode, title, status = 'open') {
  const spec = STATUS_ROWS.find((item) => item.cameraCode === cameraCode);
  return {
    id,
    shedCode: STATUS_SHED,
    cameraCode,
    level: STATUS_LEVEL,
    status,
    title: title || spec.title,
    message: alertMessage(cameraCode),
    createdAt: '2026-10-14T01:02:03.004Z',
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

function installFetch(state) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const target = new URL(String(url));
    const method = init?.method || 'GET';
    calls.push(`${method} ${target.pathname}${target.search}`);
    if (target.pathname.endsWith('/auth/login')) {
      assert.deepEqual(JSON.parse(init.body), { username: 'admin', password: 'Admin@123456' });
      return jsonResponse(200, { accessToken: 'tok' });
    }
    if (method === 'POST' && /\/alerts\/[^/]+\/close$/.test(target.pathname)) {
      const id = decodeURIComponent(target.pathname.split('/').slice(-2)[0]);
      const found = state.alerts.find((item) => item.id === id);
      if (!found) return jsonResponse(404, { message: '告警不存在' });
      const body = JSON.parse(init.body);
      assert.equal(body.note, CLOSE_NOTE);
      assert.equal(init.headers.authorization, 'Bearer tok');
      found.status = CLOSED_STATUS;
      found.closeNote = body.note;
      found.closeReason = 'resolved';
      state.closed.push(id);
      return jsonResponse(201, { ...found });
    }
    if (method === 'POST' && target.pathname.endsWith('/alerts')) {
      const body = JSON.parse(init.body);
      assert.equal(body.shedCode, STATUS_SHED);
      assert.equal(body.level, STATUS_LEVEL);
      assert.equal(init.headers.authorization, 'Bearer tok');
      const created = row(
        body.cameraCode === CLOSED_CAMERA ? closedId : openId,
        body.cameraCode,
        body.title,
      );
      created.message = body.message;
      state.alerts.push(created);
      state.created.push(body);
      return jsonResponse(201, { ...created });
    }
    if (method === 'GET' && /\/alerts\/[^/]+$/.test(target.pathname)) {
      const id = decodeURIComponent(target.pathname.split('/').pop());
      const found = state.alerts.find((item) => item.id === id);
      if (!found) return jsonResponse(404, { message: '告警不存在' });
      return jsonResponse(200, { ...found });
    }
    if (method === 'GET' && target.pathname.endsWith('/alerts')) {
      const status = target.searchParams.get('status');
      const shed = target.searchParams.get('shedCode');
      const camera = (target.searchParams.get('cameraCode') || '').trim();
      let items = state.alerts;
      if (shed) items = items.filter((item) => item.shedCode === shed);
      if (status) items = items.filter((item) => item.status === status);
      if (camera) items = items.filter((item) => item.cameraCode === camera);
      return jsonResponse(200, { items, total: items.length, page: 1, pageSize: 100 });
    }
    return jsonResponse(404, { message: `未模拟 ${method} ${target.pathname}` });
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

test('open and closed stay on their own sides of the status filter', () => {
  const pending = row(openId, OPEN_CAMERA);
  const finished = row(closedId, CLOSED_CAMERA, '已关闭筛选告警', CLOSED_STATUS);
  const acked = { ...finished, id: 'acked', status: 'acked' };
  assert.equal(pickOpen([pending, finished])?.id, openId);
  assert.equal(pickOpen([{ ...pending, status: CLOSED_STATUS }, finished]), null);
  assert.equal(pickClosed([pending, finished])?.id, closedId);
  assert.equal(pickClosed([pending, acked]), null);
  assert.equal(pickClosable([pending, acked])?.id, 'acked');
  assert.equal(pickClosable([pending, finished]), null);
  assert.doesNotThrow(() => assertOnlyStatus([pending], OPEN_STATUS, openId, closedId));
  assert.throws(
    () => assertOnlyStatus([pending, { ...pending, id: 'other', status: 'acked' }], OPEN_STATUS, openId, closedId),
    /其他状态/,
  );
  assert.throws(() => assertOnlyStatus([pending, finished], OPEN_STATUS, openId, closedId), /另一条/);
  assert.throws(() => assertOnlyStatus([finished], OPEN_STATUS, openId, closedId), /没有告警/);
  assert.throws(() => assertOnlyStatus([pending, finished], CLOSED_STATUS, closedId, openId), /另一条/);
  assert.doesNotThrow(() =>
    assertBothPresent([pending, finished, row(keptId, 'CAM-ALERT-01', '温度过高告警')], [openId, closedId]),
  );
  assert.throws(() => assertBothPresent([pending], [openId, closedId]), /缺少/);
  assertDetail(finished, {
    id: closedId,
    cameraCode: CLOSED_CAMERA,
    title: '已关闭筛选告警',
    status: CLOSED_STATUS,
  });
});

test('proof names both statuses and the filtered lists', () => {
  const proof = formatStatusProof({
    openRow: { ...STATUS_ROWS[0], id: openId, how: 'created' },
    closedRow: { ...STATUS_ROWS[1], id: closedId, how: 'reused' },
    openCount: 2,
    closedCount: 1,
    openDetail: row(openId, OPEN_CAMERA),
    closedDetail: row(closedId, CLOSED_CAMERA, '已关闭筛选告警', CLOSED_STATUS),
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /留下 2 条告警/);
  assert.match(proof, new RegExp(`待确认: 新建 ${openId}`));
  assert.match(proof, new RegExp(`已关闭: 沿用 ${closedId}`));
  assert.match(proof, /筛选待确认条数: 2/);
  assert.match(proof, /筛选后已关闭: 无/);
  assert.match(proof, /待确认详情可打开: 是/);
  assert.match(proof, /待确认详情状态: 待确认/);
  assert.match(proof, /筛选已关闭条数: 1/);
  assert.match(proof, /筛选后待确认: 无/);
  assert.match(proof, /已关闭详情可打开: 是/);
  assert.match(proof, /已关闭详情状态: 已关闭/);
  assert.match(proof, /全部仍含这两条: 是/);
  assert.match(proof, /告警列表: http:\/\/127\.0\.0\.1:43123\/alerts$/m);
  assert.match(proof, /待确认: http:\/\/127\.0\.0\.1:43123\/alerts\?status=open/);
  assert.match(proof, /已关闭: http:\/\/127\.0\.0\.1:43123\/alerts\?status=closed/);
  assert.match(
    proof,
    new RegExp(`待确认详情: http://127\\.0\\.0\\.1:43123/alerts/${openId}\\?status=open`),
  );
  assert.match(
    proof,
    new RegExp(`已关闭详情: http://127\\.0\\.0\\.1:43123/alerts/${closedId}\\?status=closed`),
  );
});

test('the command leaves one pending and one closed alert', async () => {
  const state = {
    alerts: [row(keptId, 'CAM-ALERT-01', '温度过高告警', 'open')],
    created: [],
    closed: [],
  };
  const installed = installFetch(state);
  try {
    const result = await sendStatusFilterDemo();
    assert.equal(result.openRow.id, openId);
    assert.equal(result.openRow.how, 'created');
    assert.equal(result.closedRow.id, closedId);
    assert.equal(result.closedRow.how, 'created');
    assert.equal(result.openDetail.status, OPEN_STATUS);
    assert.equal(result.closedDetail.status, CLOSED_STATUS);
    assert.equal(result.openCount, 2);
    assert.equal(result.closedCount, 1);
    assert.equal(state.created.length, 2);
    assert.deepEqual(state.closed, [closedId]);
    assert.equal(state.alerts.find((item) => item.id === keptId).status, OPEN_STATUS);
    assert.equal(installed.calls.filter((line) => line.includes('/ack')).length, 0);
    assert.equal(
      installed.calls.filter((line) => line.includes('/close') && line.includes(keptId)).length,
      0,
    );
    assert.match(formatStatusProof(result), /筛选后已关闭: 无/);
    assert.match(formatStatusProof(result), /已关闭: 新建并关闭/);
  } finally {
    installed.restore();
  }
});

test('an existing open alert and an existing closed alert are reused', async () => {
  const state = {
    alerts: [
      row(openId, OPEN_CAMERA),
      row(closedId, CLOSED_CAMERA, '已关闭筛选告警', CLOSED_STATUS),
      row(keptId, 'CAM-THRESH-01', 'CO₂过高告警'),
    ],
    created: [],
    closed: [],
  };
  const installed = installFetch(state);
  try {
    const result = await sendStatusFilterDemo();
    assert.equal(result.openRow.how, 'reused');
    assert.equal(result.closedRow.how, 'reused');
    assert.equal(state.created.length, 0);
    assert.deepEqual(state.closed, []);
    assert.equal(result.openCount, 2);
    assert.equal(result.closedCount, 1);
    assert.equal(state.alerts.find((item) => item.id === keptId).status, OPEN_STATUS);
  } finally {
    installed.restore();
  }
});

test('an unclosed row with the closed title is closed instead of creating another', async () => {
  const state = {
    alerts: [
      row(openId, OPEN_CAMERA),
      { ...row(closedId, CLOSED_CAMERA, '已关闭筛选告警'), status: 'acked' },
    ],
    created: [],
    closed: [],
  };
  const installed = installFetch(state);
  try {
    const result = await sendStatusFilterDemo();
    assert.equal(result.openRow.how, 'reused');
    assert.equal(result.closedRow.how, 'closed');
    assert.equal(result.closedRow.id, closedId);
    assert.equal(state.created.length, 0);
    assert.deepEqual(state.closed, [closedId]);
    assert.equal(state.alerts.find((item) => item.id === closedId).closeNote, CLOSE_NOTE);
    assert.match(formatStatusProof(result), /已关闭: 关闭/);
  } finally {
    installed.restore();
  }
});

test('the written steps name the make target and leave the earlier demos alone', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_ALERT_STATUS_FILTER.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  const one = readFileSync(join(root, 'docs/DEMO_ONE_INGEST.md'), 'utf8');
  const registerDoc = readFileSync(join(root, 'docs/DEMO_REGISTER_AND_INGEST.md'), 'utf8');
  const heartbeatDoc = readFileSync(join(root, 'docs/DEMO_REGISTER_AND_HEARTBEAT.md'), 'utf8');
  const alertDoc = readFileSync(join(root, 'docs/DEMO_ONE_ALERT.md'), 'utf8');
  const ackDoc = readFileSync(join(root, 'docs/DEMO_ACK_CLOSE_ALERT.md'), 'utf8');
  const thresholdDoc = readFileSync(join(root, 'docs/DEMO_THRESHOLD_ALERT.md'), 'utf8');
  const cameraDoc = readFileSync(join(root, 'docs/DEMO_ALERT_CAMERA_FILTER.md'), 'utf8');
  const alertScript = readFileSync(join(root, 'scripts/demo-one-alert.mjs'), 'utf8');
  const ackScript = readFileSync(join(root, 'scripts/demo-ack-close-alert.mjs'), 'utf8');
  const thresholdScript = readFileSync(join(root, 'scripts/demo-threshold-alert.mjs'), 'utf8');
  const cameraScript = readFileSync(join(root, 'scripts/demo-alert-camera-filter.mjs'), 'utf8');
  assert.match(doc, /make demo-alert-status-filter/);
  assert.match(doc, /admin/);
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /待确认/);
  assert.match(doc, /已关闭/);
  assert.match(doc, /全部/);
  assert.match(doc, /CAM-STATUS-01/);
  assert.match(doc, /CAM-STATUS-02/);
  assert.match(doc, /status=open/);
  assert.match(doc, /status=closed/);
  assert.match(caps, /make demo-alert-status-filter/);
  assert.match(caps, /DEMO_ALERT_STATUS_FILTER\.md/);
  assert.match(status, /make demo-alert-status-filter/);
  assert.match(readme, /DEMO_ALERT_STATUS_FILTER\.md/);
  assert.doesNotMatch(one, /demo-alert-status-filter|CAM-STATUS-0/);
  assert.doesNotMatch(registerDoc, /demo-alert-status-filter|CAM-STATUS-0/);
  assert.doesNotMatch(heartbeatDoc, /demo-alert-status-filter|CAM-STATUS-0/);
  assert.doesNotMatch(alertDoc, /demo-alert-status-filter|CAM-STATUS-0/);
  assert.doesNotMatch(ackDoc, /demo-alert-status-filter|CAM-STATUS-0/);
  assert.doesNotMatch(thresholdDoc, /demo-alert-status-filter|CAM-STATUS-0/);
  assert.doesNotMatch(cameraDoc, /demo-alert-status-filter|CAM-STATUS-0/);
  assert.doesNotMatch(alertScript, /CAM-STATUS-0/);
  assert.doesNotMatch(ackScript, /CAM-STATUS-0|demo-alert-status-filter/);
  assert.doesNotMatch(thresholdScript, /CAM-STATUS-0/);
  assert.doesNotMatch(cameraScript, /CAM-STATUS-0|demo-alert-status-filter/);
  assert.match(makefile, /^demo-one-alert:.*\n\tnode scripts\/demo-one-alert\.mjs\s*$/m);
  assert.match(makefile, /^demo-ack-one-alert:.*\n\tnode scripts\/demo-ack-close-alert\.mjs ack\s*$/m);
  assert.match(
    makefile,
    /^demo-close-one-alert:.*\n\tnode scripts\/demo-ack-close-alert\.mjs close\s*$/m,
  );
  assert.match(
    makefile,
    /^demo-alert-camera-filter:.*\n\tnode scripts\/demo-alert-camera-filter\.mjs\s*$/m,
  );
  assert.match(
    makefile,
    /^demo-alert-status-filter:.*\n\tnode scripts\/demo-alert-status-filter\.mjs\s*$/m,
  );
  assert.match(makefile, /scripts\/demo-alert-status-filter\.spec\.mjs/);
  const added = readme.split('\n').filter((line) => line.includes('DEMO_ALERT_STATUS_FILTER.md'));
  assert.equal(added.length, 1);
});
