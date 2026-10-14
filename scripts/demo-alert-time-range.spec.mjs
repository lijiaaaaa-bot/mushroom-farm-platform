import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { repoRoot } from './lib/ingest-wire.mjs';
import {
  INSIDE_NOW_CAMERA,
  INSIDE_OLDER_CAMERA,
  OUTSIDE_CAMERA,
  TIME_LEVEL,
  TIME_SHED,
  TITLE_QUERY,
  alertMessage,
  assertWindow,
  demoWindows,
  formatTimeProof,
  inWindow,
  rangedListUrl,
  sendTimeRangeDemo,
  timeSpecs,
} from './demo-alert-time-range.mjs';

const outsideId = '11111111-1111-4111-8111-111111111111';
const olderId = '22222222-2222-4222-8222-222222222222';
const nowId = '33333333-3333-4333-8333-333333333333';
const otherId = '44444444-4444-4444-8444-444444444444';

const ids = {
  [OUTSIDE_CAMERA]: outsideId,
  [INSIDE_OLDER_CAMERA]: olderId,
  [INSIDE_NOW_CAMERA]: nowId,
};

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
      assert.equal(body.shedCode, TIME_SHED);
      assert.equal(body.level, TIME_LEVEL);
      assert.equal(init.headers.authorization, 'Bearer tok');
      assert.equal(typeof body.createdAt, 'string');
      const existing = state.alerts.find(
        (item) =>
          item.cameraCode === body.cameraCode &&
          item.title === body.title &&
          item.shedCode === body.shedCode,
      );
      if (existing) {
        existing.createdAt = body.createdAt;
        existing.message = body.message;
        state.reused.push(body);
        return jsonResponse(201, existing);
      }
      const created = {
        id: ids[body.cameraCode],
        shedCode: body.shedCode,
        cameraCode: body.cameraCode,
        level: body.level,
        status: 'open',
        title: body.title,
        message: body.message,
        createdAt: body.createdAt,
      };
      state.alerts.push(created);
      state.created.push(body);
      return jsonResponse(201, created);
    }
    if (method === 'GET' && /\/alerts\/[^/]+$/.test(target.pathname)) {
      const id = decodeURIComponent(target.pathname.split('/').pop());
      const found = state.alerts.find((item) => item.id === id);
      if (!found) return jsonResponse(404, { message: '告警不存在' });
      return jsonResponse(200, found);
    }
    if (method === 'GET' && target.pathname.endsWith('/alerts')) {
      const camera = (target.searchParams.get('cameraCode') || '').trim();
      const shed = target.searchParams.get('shedCode');
      const q = (target.searchParams.get('q') || '').trim().toLowerCase();
      const status = target.searchParams.get('status');
      const from = target.searchParams.get('from');
      const to = target.searchParams.get('to');
      let items = state.alerts;
      if (shed) items = items.filter((item) => item.shedCode === shed);
      if (camera) items = items.filter((item) => item.cameraCode === camera);
      if (q) items = items.filter((item) => String(item.title || '').toLowerCase().includes(q));
      if (status) items = items.filter((item) => item.status === status);
      if (from) items = items.filter((item) => new Date(item.createdAt).getTime() >= new Date(from).getTime());
      if (to) items = items.filter((item) => new Date(item.createdAt).getTime() <= new Date(to).getTime());
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

test('a narrow window drops the older alert and keeps the two inside it', () => {
  const now = new Date('2026-10-14T08:00:00.000Z');
  const clock = demoWindows(now);
  const specs = timeSpecs(clock);
  assert.equal(specs[0].cameraCode, OUTSIDE_CAMERA);
  assert.equal(inWindow(clock.outsideAt, clock.wideFrom, clock.to), true);
  assert.equal(inWindow(clock.outsideAt, clock.narrowFrom, clock.to), false);
  assert.equal(inWindow(clock.insideOlderAt, clock.narrowFrom, clock.to), true);
  assert.equal(inWindow(clock.insideNowAt, clock.narrowFrom, clock.to), true);
  assert.doesNotThrow(() =>
    assertWindow(
      [
        { id: olderId, createdAt: clock.insideOlderAt.toISOString() },
        { id: nowId, createdAt: clock.insideNowAt.toISOString() },
      ],
      {
        from: clock.narrowFrom,
        to: clock.to,
        requiredIds: [olderId, nowId],
        forbiddenIds: [outsideId],
      },
    ),
  );
  assert.throws(
    () =>
      assertWindow([{ id: outsideId, createdAt: clock.outsideAt.toISOString() }], {
        from: clock.narrowFrom,
        to: clock.to,
        requiredIds: [olderId],
        forbiddenIds: [],
      }),
    /没有告警/,
  );
  assert.throws(
    () =>
      assertWindow(
        [
          { id: olderId, createdAt: clock.insideOlderAt.toISOString() },
          { id: outsideId, createdAt: clock.outsideAt.toISOString() },
        ],
        {
          from: clock.narrowFrom,
          to: clock.to,
          requiredIds: [olderId],
          forbiddenIds: [outsideId],
        },
      ),
    /窗外/,
  );
});

test('proof prints the wide and narrow list urls and a smaller narrow count', () => {
  const now = new Date('2026-10-14T08:00:00.000Z');
  const clock = demoWindows(now);
  const proof = formatTimeProof({
    seeded: timeSpecs(clock).map((spec, index) => ({
      cameraCode: spec.cameraCode,
      title: spec.title,
      id: [outsideId, olderId, nowId][index],
      createdAt: spec.createdAt.toISOString(),
      created: index === 0,
    })),
    clock,
    wideCount: 3,
    narrowCount: 2,
    detail: {
      title: '时间窗内当前告警',
      createdAt: clock.insideNowAt.toISOString(),
      level: TIME_LEVEL,
      status: 'open',
    },
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /留下 3 条告警/);
  assert.match(proof, /createdAt/);
  assert.match(proof, /宽窗口条数: 3/);
  assert.match(proof, /窄窗口条数: 2/);
  assert.match(proof, /窄窗口少于宽窗口: 是/);
  assert.match(proof, /状态下拉: 全部/);
  assert.match(proof, /时间窗外告警/);
  assert.match(proof, /时间窗内较早告警/);
  assert.match(proof, /时间窗内当前告警/);
  const wide = rangedListUrl(clock.wideFrom, clock.to, 'http://127.0.0.1:43123');
  const narrow = rangedListUrl(clock.narrowFrom, clock.to, 'http://127.0.0.1:43123');
  assert.match(proof, new RegExp(`宽窗口列表: ${wide.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(proof, new RegExp(`窄窗口列表: ${narrow.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.equal(wide.includes('status='), false);
  assert.equal(narrow.includes('status='), false);
  assert.match(wide, new RegExp(`q=${encodeURIComponent(TITLE_QUERY)}`));
});

test('the command seeds three times and the narrow list is smaller', async () => {
  const now = new Date('2026-10-14T08:00:00.000Z');
  const state = {
    alerts: [
      {
        id: otherId,
        shedCode: TIME_SHED,
        cameraCode: 'CAM-ALERT-01',
        level: 'severe',
        status: 'open',
        title: '温度过高告警',
        message: '保持不动',
        createdAt: now.toISOString(),
      },
    ],
    created: [],
    reused: [],
  };
  const installed = installFetch(state);
  try {
    const result = await sendTimeRangeDemo(now);
    assert.deepEqual(
      result.seeded.map((item) => item.cameraCode),
      [OUTSIDE_CAMERA, INSIDE_OLDER_CAMERA, INSIDE_NOW_CAMERA],
    );
    assert.equal(result.seeded.every((item) => item.created), true);
    assert.equal(result.wideCount, 3);
    assert.equal(result.narrowCount, 2);
    assert.equal(result.detail.id, nowId);
    assert.equal(result.detail.title, '时间窗内当前告警');
    assert.equal(state.created.length, 3);
    assert.equal(state.alerts.find((item) => item.id === otherId).title, '温度过高告警');
    assert.equal(installed.calls.some((line) => line.includes('/ack') || line.includes('/close')), false);
    assert.match(formatTimeProof(result), /窄窗口条数: 2/);
    assert.match(alertMessage(OUTSIDE_CAMERA), /CAM-TIME-01/);
  } finally {
    installed.restore();
  }
});

test('the same camera and title keeps its id and takes the new createdAt', async () => {
  const now = new Date('2026-10-14T08:00:00.000Z');
  const clock = demoWindows(now);
  const state = {
    alerts: timeSpecs(clock).map((spec) => ({
      id: ids[spec.cameraCode],
      shedCode: TIME_SHED,
      cameraCode: spec.cameraCode,
      level: TIME_LEVEL,
      status: 'open',
      title: spec.title,
      message: alertMessage(spec.cameraCode),
      createdAt: '2020-01-01T00:00:00.000Z',
    })),
    created: [],
    reused: [],
  };
  const installed = installFetch(state);
  try {
    const result = await sendTimeRangeDemo(now);
    assert.equal(result.seeded.every((item) => item.created), false);
    assert.equal(state.created.length, 0);
    assert.equal(state.reused.length, 3);
    assert.equal(state.alerts.find((item) => item.id === outsideId).createdAt, clock.outsideAt.toISOString());
    assert.equal(result.wideCount, 3);
    assert.equal(result.narrowCount, 2);
    assert.equal(result.seeded.find((item) => item.place === 'outside').id, outsideId);
  } finally {
    installed.restore();
  }
});

test('the written steps name both list views and leave the status demo alone', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_ALERT_TIME_RANGE.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  const statusDoc = readFileSync(join(root, 'docs/DEMO_ALERT_STATUS_FILTER.md'), 'utf8');
  const statusScript = readFileSync(join(root, 'scripts/demo-alert-status-filter.mjs'), 'utf8');
  const ackScript = readFileSync(join(root, 'scripts/demo-alert-ack.mjs'), 'utf8');
  assert.match(doc, /make demo-alert-time-range/);
  assert.match(doc, /admin/);
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /createdAt/);
  assert.match(doc, /开始时间/);
  assert.match(doc, /结束时间/);
  assert.match(doc, /时间窗外告警/);
  assert.match(doc, /时间窗内较早告警/);
  assert.match(doc, /时间窗内当前告警/);
  assert.match(doc, /宽窗口列表/);
  assert.match(doc, /窄窗口列表/);
  assert.match(doc, /全部/);
  assert.match(doc, /截图/);
  assert.match(doc, /CAM-TIME-01/);
  assert.match(caps, /make demo-alert-time-range/);
  assert.match(caps, /DEMO_ALERT_TIME_RANGE\.md/);
  assert.match(caps, /createdAt/);
  assert.match(status, /make demo-alert-time-range/);
  assert.match(readme, /DEMO_ALERT_TIME_RANGE\.md/);
  assert.match(statusDoc, /make demo-alert-status-filter/);
  assert.doesNotMatch(statusScript, /CAM-TIME-0|demo-alert-time-range/);
  assert.doesNotMatch(ackScript, /CAM-TIME-0|demo-alert-time-range/);
  assert.match(
    makefile,
    /^demo-alert-status-filter:.*\n\tnode scripts\/demo-alert-status-filter\.mjs\s*$/m,
  );
  assert.match(
    makefile,
    /^demo-alert-time-range:.*\n\tnode scripts\/demo-alert-time-range\.mjs\s*$/m,
  );
  assert.match(makefile, /scripts\/demo-alert-time-range\.spec\.mjs/);
  const added = readme.split('\n').filter((line) => line.includes('DEMO_ALERT_TIME_RANGE.md'));
  assert.equal(added.length, 1);
});
