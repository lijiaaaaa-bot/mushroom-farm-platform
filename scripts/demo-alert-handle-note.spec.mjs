import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { repoRoot } from './lib/ingest-wire.mjs';
import {
  HANDLE_NOTE,
  NOTE_CAMERA,
  NOTE_LEVEL,
  NOTE_SHED,
  NOTE_TITLE,
  alertDetailUrl,
  alertMessage,
  assertNoted,
  formatHandleProof,
  pickOpen,
  sendHandleNoteDemo,
} from './demo-alert-handle-note.mjs';

const noteId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';

function row(id, overrides = {}) {
  return {
    id,
    shedCode: NOTE_SHED,
    cameraCode: NOTE_CAMERA,
    level: NOTE_LEVEL,
    status: 'open',
    title: NOTE_TITLE,
    message: alertMessage(),
    ackNote: null,
    closeNote: null,
    createdAt: '2026-10-14T01:02:03.004Z',
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
    if (method === 'POST' && target.pathname.endsWith('/alerts')) {
      const body = JSON.parse(init.body);
      assert.equal(body.shedCode, NOTE_SHED);
      assert.equal(body.cameraCode, NOTE_CAMERA);
      assert.equal(body.title, NOTE_TITLE);
      assert.equal(body.level, NOTE_LEVEL);
      assert.equal(init.headers.authorization, 'Bearer tok');
      const created = row(noteId);
      created.message = body.message;
      state.alerts.push(created);
      state.created.push(body);
      return jsonResponse(201, created);
    }
    if (method === 'POST' && /\/alerts\/[^/]+\/ack$/.test(target.pathname)) {
      const parts = target.pathname.split('/');
      const id = decodeURIComponent(parts[parts.length - 2]);
      const body = JSON.parse(init.body);
      assert.equal(body.note, HANDLE_NOTE);
      const found = state.alerts.find((item) => item.id === id);
      if (!found || found.status !== 'open') return jsonResponse(400, { message: '不能确认' });
      found.status = 'acked';
      found.ackNote = body.note;
      state.acked.push(id);
      return jsonResponse(201, found);
    }
    if (method === 'GET' && /\/alerts\/[^/]+$/.test(target.pathname)) {
      const parts = target.pathname.split('/');
      const id = decodeURIComponent(parts[parts.length - 1]);
      const found = state.alerts.find((item) => item.id === id);
      if (!found) return jsonResponse(404, { message: '告警不存在' });
      state.reads.push(id);
      return jsonResponse(200, { ...found });
    }
    if (method === 'GET' && target.pathname.endsWith('/alerts')) {
      const shed = target.searchParams.get('shedCode');
      let items = state.alerts;
      if (shed) items = items.filter((item) => item.shedCode === shed);
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

test('an open handling-note alert can be picked out of other rows', () => {
  const open = row(noteId);
  const closed = row(otherId, { status: 'closed', closeNote: '已关闭' });
  const temperature = row('33333333-3333-4333-8333-333333333333', {
    cameraCode: 'CAM-ALERT-01',
    title: '温度过高告警',
    level: 'severe',
  });
  assert.equal(pickOpen([closed, temperature, open])?.id, noteId);
  assert.equal(pickOpen([closed, temperature]), null);
  assert.equal(pickOpen([row(noteId, { status: 'acked', ackNote: HANDLE_NOTE })]), null);
  assert.doesNotThrow(() => assertNoted({ ...open, status: 'acked', ackNote: HANDLE_NOTE }, noteId));
  assert.throws(() => assertNoted({ ...open, status: 'acked', ackNote: '已确认' }, noteId), /处理说明/);
  assert.throws(() => assertNoted({ ...open, status: 'open', ackNote: HANDLE_NOTE }, noteId), /应为已确认/);
});

test('proof names the note and the detail address', () => {
  const detail = { ...row(noteId), status: 'acked', ackNote: HANDLE_NOTE };
  const proof = formatHandleProof({
    created: true,
    detail,
    refreshed: detail,
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /来源: 新建一条待确认告警/);
  assert.match(proof, new RegExp(`告警 id: ${noteId}`));
  assert.match(proof, /标题: 处理说明告警/);
  assert.match(proof, /摄像头编号: CAM-NOTE-01/);
  assert.match(proof, /动作: 确认/);
  assert.match(proof, /处理说明: 现场已开窗通风/);
  assert.match(proof, /刷新后状态: 已确认/);
  assert.match(proof, /再读一次处理说明: 现场已开窗通风/);
  assert.match(proof, new RegExp(`告警详情: ${alertDetailUrl(noteId, 'http://127.0.0.1:43123')}`));
});

test('the command acks one pending alert and reads the note twice', async () => {
  const state = {
    alerts: [
      row(otherId, {
        cameraCode: 'CAM-ALERT-01',
        title: '温度过高告警',
        level: 'severe',
      }),
    ],
    created: [],
    acked: [],
    reads: [],
  };
  const installed = installFetch(state);
  try {
    const result = await sendHandleNoteDemo();
    assert.equal(result.created, true);
    assert.equal(result.detail.id, noteId);
    assert.equal(result.detail.ackNote, HANDLE_NOTE);
    assert.equal(result.refreshed.ackNote, HANDLE_NOTE);
    assert.equal(result.detail.status, 'acked');
    assert.equal(state.created.length, 1);
    assert.deepEqual(state.acked, [noteId]);
    assert.deepEqual(state.reads, [noteId, noteId]);
    assert.equal(state.alerts[0].status, 'open');
    assert.equal(state.alerts[0].title, '温度过高告警');
  } finally {
    installed.restore();
  }
});

test('an existing pending alert is acked without creating another', async () => {
  const state = {
    alerts: [row(noteId), row(otherId, { cameraCode: 'CAM-TITLE-01', title: '东侧标题搜索告警' })],
    created: [],
    acked: [],
    reads: [],
  };
  const installed = installFetch(state);
  try {
    const result = await sendHandleNoteDemo();
    assert.equal(result.created, false);
    assert.equal(result.detail.id, noteId);
    assert.equal(result.refreshed.status, 'acked');
    assert.equal(result.refreshed.ackNote, HANDLE_NOTE);
    assert.equal(state.created.length, 0);
    assert.deepEqual(state.acked, [noteId]);
    assert.equal(state.alerts[1].status, 'open');
    assert.equal(state.alerts[1].title, '东侧标题搜索告警');
  } finally {
    installed.restore();
  }
});

test('the written steps name the make target and leave the earlier demos alone', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_ALERT_HANDLE_NOTE.md'), 'utf8');
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
    'scripts/demo-one-alert.mjs',
    'scripts/demo-ack-close-alert.mjs',
    'scripts/demo-threshold-alert.mjs',
    'scripts/demo-alert-camera-filter.mjs',
    'scripts/demo-alert-status-filter.mjs',
    'scripts/demo-alert-title-search.mjs',
  ];
  assert.match(doc, /make demo-alert-handle-note/);
  assert.match(doc, /admin/);
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /处理说明告警/);
  assert.match(doc, /CAM-NOTE-01/);
  assert.match(doc, /现场已开窗通风/);
  assert.match(doc, /处理说明/);
  assert.match(doc, /确认/);
  assert.match(doc, /关闭/);
  assert.match(doc, /\/alerts/);
  assert.match(caps, /make demo-alert-handle-note/);
  assert.match(caps, /DEMO_ALERT_HANDLE_NOTE\.md/);
  assert.match(status, /make demo-alert-handle-note/);
  assert.match(readme, /DEMO_ALERT_HANDLE_NOTE\.md/);
  for (const rel of earlier) {
    const text = readFileSync(join(root, rel), 'utf8');
    assert.doesNotMatch(text, /demo-alert-handle-note|CAM-NOTE-0/);
  }
  assert.match(
    makefile,
    /^demo-alert-handle-note:.*\n\tnode scripts\/demo-alert-handle-note\.mjs\s*$/m,
  );
  assert.match(makefile, /scripts\/demo-alert-handle-note\.spec\.mjs/);
  assert.match(makefile, /^demo-one-alert:.*\n\tnode scripts\/demo-one-alert\.mjs\s*$/m);
  assert.match(makefile, /^demo-ack-one-alert:.*\n\tnode scripts\/demo-ack-close-alert\.mjs ack\s*$/m);
  assert.match(
    makefile,
    /^demo-close-one-alert:.*\n\tnode scripts\/demo-ack-close-alert\.mjs close\s*$/m,
  );
  assert.match(makefile, /^demo-alert-title-search:.*\n\tnode scripts\/demo-alert-title-search\.mjs\s*$/m);
  const added = readme.split('\n').filter((line) => line.includes('DEMO_ALERT_HANDLE_NOTE.md'));
  assert.equal(added.length, 1);
});
