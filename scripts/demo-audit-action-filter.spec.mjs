import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { repoRoot } from './lib/ingest-wire.mjs';
import {
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  DEMO_ACTION,
  NEW_DETAIL,
  NEW_RESOURCE,
  NEW_USERNAME,
  OLD_DETAIL,
  OLD_RESOURCE,
  OLD_USERNAME,
  TOKEN_USER_AGENT,
  assertAuditSelection,
  auditPageUrl,
  demoWindows,
  formatAuditActionProof,
  inWindow,
  matureMark,
  showAuditActionFilter,
} from './demo-audit-action-filter.mjs';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

function page(items, { page = 1, pageSize = 100 } = {}) {
  const start = (page - 1) * pageSize;
  const slice = items.slice(start, start + pageSize);
  return { items: slice, total: items.length, page, pageSize };
}

function memoryDb(rows) {
  return {
    async query(sql, params) {
      if (sql.includes('SELECT id FROM audit_logs')) {
        const [username, resource] = params;
        const matched = rows
          .filter((item) => item.username === username && item.resource === resource)
          .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
        return { rows: matched.map((item) => ({ id: item.id })) };
      }
      if (sql.includes('INSERT INTO audit_logs')) {
        const [username, action, resource, detail, createdAt] = params;
        const id = `audit-${rows.length + 1}`;
        rows.push({
          id,
          username,
          action,
          resource,
          detail: JSON.parse(detail),
          createdAt: new Date(createdAt).toISOString(),
        });
        return { rows: [{ id }], rowCount: 1 };
      }
      if (sql.includes('UPDATE audit_logs')) {
        const [createdAt, action, detail, id] = params;
        const row = rows.find((item) => item.id === id);
        if (!row) return { rowCount: 0 };
        row.createdAt = new Date(createdAt).toISOString();
        row.action = action;
        row.detail = JSON.parse(detail);
        return { rowCount: 1 };
      }
      if (sql.includes('DELETE FROM audit_logs')) {
        const [username, resource, id] = params;
        const before = rows.length;
        const kept = rows.filter(
          (item) => !(item.username === username && item.resource === resource && item.id !== id),
        );
        rows.splice(0, rows.length, ...kept);
        return { rowCount: before - rows.length };
      }
      throw new Error(`unexpected sql ${sql}`);
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
    assert.doesNotMatch(target.pathname, /ingest|heartbeat|alerts|recognition|mqtt|devices|login-logs/);
    if (target.pathname.endsWith('/auth/login')) {
      const body = JSON.parse(init.body);
      assert.equal(body.username, ADMIN_USERNAME);
      assert.equal(body.password, ADMIN_PASSWORD);
      assert.equal(init.headers['user-agent'], TOKEN_USER_AGENT);
      return jsonResponse(201, {
        accessToken: 'tok-admin',
        user: { username: ADMIN_USERNAME, role: 'super_admin' },
      });
    }
    assert.equal(init.headers.authorization, 'Bearer tok-admin');
    if (target.pathname.endsWith('/audit-logs')) {
      const username = target.searchParams.get('username');
      const from = target.searchParams.get('from');
      const to = target.searchParams.get('to');
      if ((from && Number.isNaN(Date.parse(from))) || (to && Number.isNaN(Date.parse(to)))) {
        return jsonResponse(400, { message: from && Number.isNaN(Date.parse(from)) ? '开始时间无效' : '结束时间无效' });
      }
      if (from && to && Date.parse(from) > Date.parse(to)) {
        return jsonResponse(400, { message: '时间筛选无效' });
      }
      const pageNo = Number(target.searchParams.get('page') || '1');
      const pageSize = Number(target.searchParams.get('pageSize') || '100');
      let items = [...state.audits].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
      if (username) items = items.filter((item) => item.username === username);
      if (from) items = items.filter((item) => Date.parse(item.createdAt) >= Date.parse(from));
      if (to) items = items.filter((item) => Date.parse(item.createdAt) <= Date.parse(to));
      return jsonResponse(200, page(items, { page: pageNo, pageSize }));
    }
    throw new Error(`unexpected ${method} ${target.pathname}`);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

test('windows put the older action outside the narrow range and inside the wide range', () => {
  const now = new Date('2026-10-15T04:00:00.000Z');
  const clock = demoWindows(now);
  assert.equal(inWindow(clock.outsideAt, clock.wideFrom, clock.to), true);
  assert.equal(inWindow(clock.outsideAt, clock.narrowFrom, clock.to), false);
  assert.equal(inWindow(clock.insideNowAt, clock.narrowFrom, clock.to), true);
  assert.equal(matureMark(OLD_DETAIL), '1→2');
  assert.equal(matureMark(NEW_DETAIL), '3→4');
});

test('selection check rejects a window that still contains the older action', () => {
  const now = new Date('2026-10-15T04:00:00.000Z');
  const clock = demoWindows(now);
  assert.throws(
    () =>
      assertAuditSelection(
        [{ id: 'old', createdAt: clock.outsideAt.toISOString(), username: OLD_USERNAME }],
        { from: clock.narrowFrom, to: clock.to, forbidden: ['old'] },
      ),
    /old/,
  );
  assert.throws(
    () =>
      assertAuditSelection(
        [
          { id: 'old', createdAt: clock.outsideAt.toISOString(), username: OLD_USERNAME },
          { id: 'new', createdAt: clock.insideNowAt.toISOString(), username: NEW_USERNAME },
        ],
        { username: OLD_USERNAME, required: ['old'] },
      ),
    /audit-action-new/,
  );
});

test('proof names both actions, the empty filter, and the audit page', () => {
  const now = new Date('2026-10-15T04:00:00.000Z');
  const clock = demoWindows(now);
  const proof = formatAuditActionProof({
    older: { id: 'old', createdAt: clock.outsideAt.toISOString() },
    recent: { id: 'new', createdAt: clock.insideNowAt.toISOString() },
    clock,
    wideCount: 3,
    narrowCount: 2,
    userCount: 1,
    emptyCount: 0,
    reversedStatus: 400,
    invalidStatus: 400,
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, new RegExp(`${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`));
  assert.match(proof, new RegExp(`用户 ${OLD_USERNAME}`));
  assert.match(proof, new RegExp(`用户 ${NEW_USERNAME}`));
  assert.match(proof, new RegExp(DEMO_ACTION));
  assert.match(proof, /成熟数 1→2/);
  assert.match(proof, /成熟数 3→4/);
  assert.match(proof, /窄窗口少于宽窗口: 是/);
  assert.match(proof, new RegExp(`窄窗口含 ${NEW_USERNAME}、不含 ${OLD_USERNAME}: 是`));
  assert.match(proof, new RegExp(`用户 ${OLD_USERNAME} 条数: 1`));
  assert.match(proof, new RegExp(`用户 ${OLD_USERNAME} 窄窗口条数: 0`));
  assert.match(proof, /开始晚于结束: 400/);
  assert.match(proof, /时间填不开: 400/);
  assert.match(proof, /审计页: http:\/\/127\.0\.0\.1:43123\/audit$/m);
  assert.match(proof, /宽窗口列表: http:\/\/127\.0\.0\.1:43123\/audit\?auditFrom=/);
  assert.match(proof, /用户列表: http:\/\/127\.0\.0\.1:43123\/audit\?auditUsername=audit-action-old$/m);
  assert.match(proof, /空筛选列表: .*auditUsername=audit-action-old/);
  assert.doesNotMatch(proof, /[?&]username=/);
  assert.doesNotMatch(proof, /[?&]from=/);
  assert.equal(
    auditPageUrl({ auditUsername: OLD_USERNAME }, 'http://127.0.0.1:43123'),
    'http://127.0.0.1:43123/audit?auditUsername=audit-action-old',
  );
  assert.doesNotMatch(proof, /ingest|heartbeat|alerts/);
});

test('http chain writes one older and one recent action, then reuses them', async () => {
  const now = new Date('2026-10-15T04:00:00.000Z');
  const state = { audits: [], now };
  const db = memoryDb(state.audits);
  const fetchMock = installFetch(state);
  try {
    const first = await showAuditActionFilter({ now, db });
    assert.equal(first.userCount, 1);
    assert.equal(first.emptyCount, 0);
    assert.equal(first.narrowCount < first.wideCount, true);
    assert.equal(first.reversedStatus, 400);
    assert.equal(first.invalidStatus, 400);
    assert.equal(first.older.createdAt, demoWindows(now).outsideAt.toISOString());
    assert.equal(first.recent.createdAt, demoWindows(now).insideNowAt.toISOString());
    assert.equal(first.older.username, OLD_USERNAME);
    assert.equal(first.recent.username, NEW_USERNAME);
    assert.equal(first.older.resource, OLD_RESOURCE);
    assert.equal(first.recent.resource, NEW_RESOURCE);
    assert.equal(matureMark(first.older.detail), '1→2');
    assert.equal(matureMark(first.recent.detail), '3→4');
    assert.equal(state.audits.length, 2);
    assert.equal(first.created.older, true);
    assert.equal(first.created.recent, true);
    const loginPosts = fetchMock.calls.filter((line) => line.startsWith('POST') && line.includes('/auth/login'));
    assert.equal(loginPosts.length, 1);
    assert.equal(fetchMock.calls.some((line) => line.includes('from=not-a-time')), true);
    assert.equal(fetchMock.calls.some((line) => /ingest|heartbeat|\/alerts|login-logs/.test(line)), false);

    const second = await showAuditActionFilter({ now, db });
    assert.equal(second.older.id, first.older.id);
    assert.equal(second.recent.id, first.recent.id);
    assert.equal(state.audits.length, 2);
    assert.equal(second.created.older, false);
    assert.equal(second.created.recent, false);
    const postsAfter = fetchMock.calls.filter((line) => line.startsWith('POST') && line.includes('/auth/login'));
    assert.equal(postsAfter.length, 2);
  } finally {
    fetchMock.restore();
  }
});

test('docs name the make target and leave the earlier audit demos alone', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_AUDIT_ACTION_FILTER.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  const earlierDoc = readFileSync(join(root, 'docs/DEMO_AUDIT_LOG.md'), 'utf8');
  const earlierLoginDoc = readFileSync(join(root, 'docs/DEMO_AUDIT_LOGIN_LOG.md'), 'utf8');
  const earlierScript = readFileSync(join(root, 'scripts/demo-audit-log.mjs'), 'utf8');
  const earlierLoginScript = readFileSync(join(root, 'scripts/demo-audit-login-log.mjs'), 'utf8');
  for (const text of [doc, caps, status, readme]) {
    assert.match(text, /make demo-audit-action-filter/);
    assert.match(text, /audit-action-old/);
    assert.match(text, /audit-action-new/);
    assert.match(text, /\/audit/);
  }
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /auditUsername/);
  assert.match(doc, /auditFrom/);
  assert.match(doc, /auditTo/);
  assert.match(doc, /开始时间/);
  assert.match(doc, /结束时间/);
  assert.match(doc, /没有符合条件的操作审计/);
  assert.match(doc, /暂无操作审计/);
  assert.match(doc, /时间筛选无效/);
  assert.match(doc, /宽窗口列表/);
  assert.match(doc, /窄窗口列表/);
  assert.match(doc, /用户列表/);
  assert.match(doc, /空筛选列表/);
  assert.match(doc, /成熟数 1→2/);
  assert.match(doc, /成熟数 3→4/);
  assert.match(doc, /CAM-ACT-OLD/);
  assert.match(doc, /CAM-ACT-NEW/);
  assert.match(doc, /make demo-audit-log/);
  assert.match(doc, /make demo-audit-login-log/);
  assert.match(doc, /不发识别/);
  assert.doesNotMatch(doc, /假定|假设/);
  assert.match(caps, /DEMO_AUDIT_ACTION_FILTER\.md/);
  assert.match(readme, /DEMO_AUDIT_ACTION_FILTER\.md/);
  assert.match(makefile, /^demo-audit-action-filter:.*\n\tnode scripts\/demo-audit-action-filter\.mjs\s*$/m);
  assert.match(makefile, /scripts\/demo-audit-action-filter\.spec\.mjs/);
  assert.match(makefile, /^demo-audit-log:.*\n\tnode scripts\/demo-audit-log\.mjs\s*$/m);
  assert.match(makefile, /^demo-audit-login-log:.*\n\tnode scripts\/demo-audit-login-log\.mjs\s*$/m);
  assert.doesNotMatch(earlierDoc, /audit-action-old|demo-audit-action-filter|CAM-ACT-OLD/);
  assert.doesNotMatch(earlierLoginDoc, /audit-action-old|demo-audit-action-filter|CAM-ACT-OLD/);
  assert.doesNotMatch(earlierScript, /audit-action-old|demo-audit-action-filter/);
  assert.doesNotMatch(earlierLoginScript, /audit-action-old|demo-audit-action-filter/);
});
