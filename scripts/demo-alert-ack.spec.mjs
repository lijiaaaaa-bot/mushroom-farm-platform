import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { ACK_NOTE, CLOSE_NOTE } from './demo-ack-close-alert.mjs';
import { repoRoot } from './lib/ingest-wire.mjs';
import {
  ACK_LEVEL,
  ACK_SHED,
  ACKED_CAMERA,
  ACKED_STATUS,
  ACKED_TITLE,
  AUTO_ACK_NOTE,
  CLOSED_CAMERA,
  CLOSED_STATUS,
  CLOSED_TITLE,
  OPEN_CAMERA,
  OPEN_STATUS,
  OPEN_TITLE,
  alertMessage,
  formatAlertAckProof,
  isWalkedClosed,
  sendAlertAckDemo,
} from './demo-alert-ack.mjs';

const openId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const ackedId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const closedId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const extraId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
const keptId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function row(id, cameraCode, title, status = 'open', extra = {}) {
  return {
    id,
    shedCode: ACK_SHED,
    cameraCode,
    level: ACK_LEVEL,
    status,
    title,
    message: alertMessage(cameraCode),
    createdAt: '2026-10-14T01:02:03.004Z',
    ackNote: extra.ackNote ?? null,
    closeNote: extra.closeNote ?? null,
    closeReason: extra.closeReason ?? null,
    ackedAt: extra.ackedAt ?? (status === 'acked' || (status === 'closed' && extra.ackNote) ? '2026-10-14T01:00:00.000Z' : null),
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

function nextId(cameraCode, state) {
  if (cameraCode === OPEN_CAMERA) return openId;
  if (cameraCode === ACKED_CAMERA) return ackedId;
  if (cameraCode === CLOSED_CAMERA) {
    if (state.alerts.some((item) => item.id === closedId)) return extraId;
    return closedId;
  }
  throw new Error(`意外的摄像头 ${cameraCode}`);
}

function matches(item, params) {
  if (params.get('shedCode') && item.shedCode !== params.get('shedCode')) return false;
  if (params.get('cameraCode') && item.cameraCode !== params.get('cameraCode')) return false;
  if (params.get('status') && item.status !== params.get('status')) return false;
  const keyword = params.get('q');
  if (keyword && !String(item.title).toLowerCase().includes(keyword.toLowerCase())) return false;
  return true;
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
    if (method === 'POST' && /\/alerts\/[^/]+\/ack$/.test(target.pathname)) {
      const id = decodeURIComponent(target.pathname.split('/').at(-2));
      const found = state.alerts.find((item) => item.id === id);
      if (!found) return jsonResponse(404, { message: '告警不存在' });
      const body = JSON.parse(init.body);
      assert.equal(body.note, ACK_NOTE);
      found.status = 'acked';
      found.ackNote = body.note;
      found.ackedAt = '2026-10-14T01:03:00.000Z';
      state.acked.push(id);
      return jsonResponse(200, { ...found });
    }
    if (method === 'POST' && /\/alerts\/[^/]+\/close$/.test(target.pathname)) {
      const id = decodeURIComponent(target.pathname.split('/').at(-2));
      const found = state.alerts.find((item) => item.id === id);
      if (!found) return jsonResponse(404, { message: '告警不存在' });
      const body = JSON.parse(init.body);
      assert.equal(body.note, CLOSE_NOTE);
      if (!found.ackedAt) {
        found.ackedAt = '2026-10-14T01:04:00.000Z';
        found.ackNote = found.ackNote ?? AUTO_ACK_NOTE;
      }
      found.status = 'closed';
      found.closeNote = body.note;
      found.closeReason = 'resolved';
      state.closed.push(id);
      return jsonResponse(200, { ...found });
    }
    if (method === 'POST' && target.pathname.endsWith('/alerts')) {
      const body = JSON.parse(init.body);
      const id = nextId(body.cameraCode, state);
      const created = row(id, body.cameraCode, body.title, 'open');
      created.message = body.message;
      created.level = body.level;
      state.alerts.push(created);
      state.created.push(id);
      return jsonResponse(201, { ...created });
    }
    if (method === 'GET' && /^\/api\/v1\/alerts\/[^/]+$/.test(target.pathname)) {
      const id = decodeURIComponent(target.pathname.split('/').at(-1));
      const found = state.alerts.find((item) => item.id === id);
      if (!found) return jsonResponse(404, { message: '告警不存在' });
      return jsonResponse(200, { ...found });
    }
    if (method === 'GET' && target.pathname.endsWith('/alerts')) {
      const items = state.alerts.filter((item) => matches(item, target.searchParams));
      return jsonResponse(200, { items, total: items.length });
    }
    return jsonResponse(404, { message: `未桩 ${method} ${target.pathname}` });
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

test('a clean run leaves an open row and walks another open alert through ack then close', async () => {
  const kept = row(keptId, 'CAM-ALERT-01', '温度过高告警');
  const state = { alerts: [kept], created: [], acked: [], closed: [] };
  const installed = installFetch(state);
  try {
    const result = await sendAlertAckDemo();
    assert.equal(result.openRow.id, openId);
    assert.equal(result.openRow.how, 'created');
    assert.equal(result.ackedRow.id, ackedId);
    assert.equal(result.ackedRow.how, 'created');
    assert.equal(result.closedRow.id, closedId);
    assert.equal(result.closedRow.how, 'walked');
    assert.equal(result.openDetail.status, OPEN_STATUS);
    assert.equal(result.openDetail.title, OPEN_TITLE);
    assert.equal(result.ackedDetail.status, ACKED_STATUS);
    assert.equal(result.ackedDetail.ackNote, ACK_NOTE);
    assert.equal(result.ackedDetail.closeReason, null);
    assert.equal(result.closedDetail.status, CLOSED_STATUS);
    assert.equal(result.closedDetail.ackNote, ACK_NOTE);
    assert.equal(result.closedDetail.closeNote, CLOSE_NOTE);
    assert.equal(result.closedDetail.closeReason, 'resolved');
    assert.equal(isWalkedClosed(result.closedDetail), true);
    assert.deepEqual(state.created, [openId, ackedId, closedId]);
    assert.deepEqual(state.acked, [ackedId, closedId]);
    assert.deepEqual(state.closed, [closedId]);
    assert.equal(state.alerts.find((item) => item.id === openId).status, OPEN_STATUS);
    assert.equal(state.alerts.find((item) => item.id === keptId).status, OPEN_STATUS);
    assert.equal(state.acked.includes(openId), false);
    assert.equal(state.closed.includes(openId), false);
    assert.equal(state.closed.includes(ackedId), false);
    const proof = formatAlertAckProof(result);
    assert.match(proof, /走查: 待确认 → 已确认 → 已关闭/);
    assert.match(proof, /确认备注: 已确认/);
    assert.match(proof, /关闭备注: 已关闭/);
    assert.match(proof, /关闭原因: 正常关闭/);
    assert.match(proof, /告警列表: http:\/\/127\.0\.0\.1:43123\/alerts/);
    assert.match(proof, /已关闭: 先确认再关闭/);
  } finally {
    installed.restore();
  }
});

test('rows already in the target state are reused', async () => {
  const state = {
    alerts: [
      row(openId, OPEN_CAMERA, OPEN_TITLE),
      row(ackedId, ACKED_CAMERA, ACKED_TITLE, ACKED_STATUS, { ackNote: ACK_NOTE }),
      row(closedId, CLOSED_CAMERA, CLOSED_TITLE, CLOSED_STATUS, {
        ackNote: ACK_NOTE,
        closeNote: CLOSE_NOTE,
        closeReason: 'resolved',
      }),
      row(keptId, 'CAM-STATUS-01', '待确认筛选告警'),
    ],
    created: [],
    acked: [],
    closed: [],
  };
  const installed = installFetch(state);
  try {
    const result = await sendAlertAckDemo();
    assert.equal(result.openRow.how, 'reused');
    assert.equal(result.ackedRow.how, 'reused');
    assert.equal(result.closedRow.how, 'reused');
    assert.equal(state.created.length, 0);
    assert.deepEqual(state.acked, []);
    assert.deepEqual(state.closed, []);
    assert.equal(state.alerts.find((item) => item.id === keptId).status, OPEN_STATUS);
    assert.equal(state.alerts.find((item) => item.id === ackedId).status, ACKED_STATUS);
    assert.match(formatAlertAckProof(result), /已关闭: 沿用/);
  } finally {
    installed.restore();
  }
});

test('an open walk row is acknowledged before it is closed', async () => {
  const state = {
    alerts: [
      row(openId, OPEN_CAMERA, OPEN_TITLE),
      row(ackedId, ACKED_CAMERA, ACKED_TITLE),
      row(closedId, CLOSED_CAMERA, CLOSED_TITLE),
    ],
    created: [],
    acked: [],
    closed: [],
  };
  const installed = installFetch(state);
  try {
    const result = await sendAlertAckDemo();
    assert.equal(result.openRow.how, 'reused');
    assert.equal(result.ackedRow.how, 'acked');
    assert.equal(result.closedRow.how, 'walked');
    assert.equal(state.created.length, 0);
    assert.deepEqual(state.acked, [ackedId, closedId]);
    assert.deepEqual(state.closed, [closedId]);
    const closed = state.alerts.find((item) => item.id === closedId);
    assert.equal(closed.ackNote, ACK_NOTE);
    assert.notEqual(closed.ackNote, AUTO_ACK_NOTE);
    assert.equal(state.alerts.find((item) => item.id === openId).status, OPEN_STATUS);
    assert.equal(state.alerts.find((item) => item.id === ackedId).status, ACKED_STATUS);
  } finally {
    installed.restore();
  }
});

test('a closed row that skipped acknowledge is not reused', async () => {
  const state = {
    alerts: [
      row(openId, OPEN_CAMERA, OPEN_TITLE),
      row(ackedId, ACKED_CAMERA, ACKED_TITLE, ACKED_STATUS, { ackNote: ACK_NOTE }),
      row(closedId, CLOSED_CAMERA, CLOSED_TITLE, CLOSED_STATUS, {
        ackNote: AUTO_ACK_NOTE,
        closeNote: CLOSE_NOTE,
        closeReason: 'resolved',
        ackedAt: '2026-10-14T01:00:00.000Z',
      }),
    ],
    created: [],
    acked: [],
    closed: [],
  };
  const installed = installFetch(state);
  try {
    const result = await sendAlertAckDemo();
    assert.equal(result.closedRow.how, 'walked');
    assert.equal(result.closedRow.id, extraId);
    assert.equal(result.closedDetail.ackNote, ACK_NOTE);
    assert.equal(state.alerts.find((item) => item.id === closedId).ackNote, AUTO_ACK_NOTE);
    assert.equal(state.alerts.find((item) => item.id === openId).status, OPEN_STATUS);
    assert.deepEqual(state.acked, [extraId]);
    assert.deepEqual(state.closed, [extraId]);
  } finally {
    installed.restore();
  }
});

test('an already acknowledged walk row is only closed', async () => {
  const state = {
    alerts: [
      row(openId, OPEN_CAMERA, OPEN_TITLE),
      row(ackedId, ACKED_CAMERA, ACKED_TITLE, ACKED_STATUS, { ackNote: ACK_NOTE }),
      row(closedId, CLOSED_CAMERA, CLOSED_TITLE, ACKED_STATUS, { ackNote: ACK_NOTE }),
    ],
    created: [],
    acked: [],
    closed: [],
  };
  const installed = installFetch(state);
  try {
    const result = await sendAlertAckDemo();
    assert.equal(result.closedRow.how, 'closed');
    assert.equal(result.closedRow.id, closedId);
    assert.deepEqual(state.acked, []);
    assert.deepEqual(state.closed, [closedId]);
    assert.equal(state.alerts.find((item) => item.id === closedId).ackNote, ACK_NOTE);
    assert.equal(state.alerts.find((item) => item.id === ackedId).status, ACKED_STATUS);
  } finally {
    installed.restore();
  }
});

test('the written steps name this make target and leave the earlier demos alone', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_ALERT_ACK.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  const ackDoc = readFileSync(join(root, 'docs/DEMO_ACK_CLOSE_ALERT.md'), 'utf8');
  const filterDoc = readFileSync(join(root, 'docs/DEMO_ALERT_STATUS_FILTER.md'), 'utf8');
  const ackScript = readFileSync(join(root, 'scripts/demo-ack-close-alert.mjs'), 'utf8');
  const filterScript = readFileSync(join(root, 'scripts/demo-alert-status-filter.mjs'), 'utf8');
  assert.match(doc, /make demo-alert-ack/);
  assert.match(doc, /admin/);
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /\/alerts/);
  assert.match(doc, /待确认操作告警/);
  assert.match(doc, /已确认操作告警/);
  assert.match(doc, /已关闭操作告警/);
  assert.match(doc, /CAM-ACK-01/);
  assert.match(doc, /CAM-ACK-02/);
  assert.match(doc, /CAM-ACK-03/);
  assert.match(doc, /全部/);
  assert.match(doc, /确认/);
  assert.match(doc, /关闭/);
  assert.doesNotMatch(doc, /^# .*详情/m);
  assert.match(caps, /make demo-alert-ack/);
  assert.match(caps, /DEMO_ALERT_ACK\.md/);
  assert.match(readme, /DEMO_ALERT_ACK\.md/);
  assert.match(status, /make demo-alert-ack/);
  assert.doesNotMatch(ackDoc, /demo-alert-ack|CAM-ACK-0/);
  assert.doesNotMatch(filterDoc, /demo-alert-ack|CAM-ACK-0/);
  assert.doesNotMatch(ackScript, /CAM-ACK-0|demo-alert-ack/);
  assert.doesNotMatch(filterScript, /CAM-ACK-0|demo-alert-ack/);
  assert.match(makefile, /^demo-ack-one-alert:.*\n\tnode scripts\/demo-ack-close-alert\.mjs ack\s*$/m);
  assert.match(makefile, /^demo-close-one-alert:.*\n\tnode scripts\/demo-ack-close-alert\.mjs close\s*$/m);
  assert.match(makefile, /^demo-alert-status-filter:.*\n\tnode scripts\/demo-alert-status-filter\.mjs\s*$/m);
  assert.match(makefile, /^demo-alert-ack:.*\n\tnode scripts\/demo-alert-ack\.mjs\s*$/m);
  assert.match(makefile, /scripts\/demo-alert-ack\.spec\.mjs/);
  const added = readme.split('\n').filter((line) => line.includes('DEMO_ALERT_ACK.md'));
  assert.equal(added.length, 1);
});
