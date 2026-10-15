import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { repoRoot } from './lib/ingest-wire.mjs';
import {
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  DEMO_USER_AGENT,
  FAIL_PASSWORD,
  FAIL_USERNAME,
  TOKEN_USER_AGENT,
  assertLoginSelection,
  auditPageUrl,
  demoWindows,
  formatAuditLoginProof,
  inWindow,
  showAuditLoginLogs,
} from './demo-audit-login-log.mjs';

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
      if (sql.includes('UPDATE login_logs')) {
        const [createdAt, id] = params;
        const row = rows.find((item) => item.id === id);
        if (!row) return { rowCount: 0 };
        row.createdAt = new Date(createdAt).toISOString();
        return { rowCount: 1 };
      }
      if (sql.includes('DELETE FROM login_logs')) {
        const [username, userAgent, result, id] = params;
        const before = rows.length;
        const kept = rows.filter(
          (item) =>
            !(item.username === username && item.userAgent === userAgent && item.result === result && item.id !== id),
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
    assert.doesNotMatch(target.pathname, /ingest|heartbeat|alerts|recognition|mqtt|devices/);
    if (target.pathname.endsWith('/auth/login')) {
      const body = JSON.parse(init.body);
      const userAgent = init.headers['user-agent'];
      if (body.username === ADMIN_USERNAME) {
        assert.equal(body.password, ADMIN_PASSWORD);
        const row = {
          id: `login-${state.nextId}`,
          username: ADMIN_USERNAME,
          result: 'success',
          ip: '127.0.0.1',
          userAgent,
          createdAt: state.now.toISOString(),
        };
        state.nextId += 1;
        state.logins.unshift(row);
        state.audits.unshift({
          id: `audit-${state.nextId}`,
          username: ADMIN_USERNAME,
          action: 'auth.login',
          resource: 'auth',
          detail: null,
          createdAt: state.now.toISOString(),
        });
        state.nextId += 1;
        return jsonResponse(201, {
          accessToken: 'tok-admin',
          user: { username: ADMIN_USERNAME, role: 'super_admin' },
        });
      }
      assert.equal(body.username, FAIL_USERNAME);
      assert.equal(body.password, FAIL_PASSWORD);
      assert.equal(userAgent, DEMO_USER_AGENT);
      const row = {
        id: `login-${state.nextId}`,
        username: FAIL_USERNAME,
        result: 'failure',
        ip: '127.0.0.1',
        userAgent,
        createdAt: state.now.toISOString(),
      };
      state.nextId += 1;
      state.logins.unshift(row);
      state.audits.unshift({
        id: `audit-${state.nextId}`,
        username: null,
        action: 'auth.login_failed',
        resource: 'auth',
        detail: { username: FAIL_USERNAME },
        createdAt: state.now.toISOString(),
      });
      state.nextId += 1;
      return jsonResponse(401, { message: '用户名或密码错误' });
    }
    assert.equal(init.headers.authorization, 'Bearer tok-admin');
    if (target.pathname.endsWith('/login-logs')) {
      const username = target.searchParams.get('username');
      const from = target.searchParams.get('from');
      const to = target.searchParams.get('to');
      const pageNo = Number(target.searchParams.get('page') || '1');
      const pageSize = Number(target.searchParams.get('pageSize') || '100');
      let items = [...state.logins].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
      if (username) items = items.filter((item) => item.username === username);
      if (from) items = items.filter((item) => Date.parse(item.createdAt) >= Date.parse(from));
      if (to) items = items.filter((item) => Date.parse(item.createdAt) <= Date.parse(to));
      return jsonResponse(200, page(items, { page: pageNo, pageSize }));
    }
    if (target.pathname.endsWith('/audit-logs')) {
      const pageNo = Number(target.searchParams.get('page') || '1');
      const pageSize = Number(target.searchParams.get('pageSize') || '100');
      const items = [...state.audits].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
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

test('windows put the failed login outside the narrow range and inside the wide range', () => {
  const now = new Date('2026-10-15T04:00:00.000Z');
  const clock = demoWindows(now);
  assert.equal(inWindow(clock.outsideAt, clock.wideFrom, clock.to), true);
  assert.equal(inWindow(clock.outsideAt, clock.narrowFrom, clock.to), false);
  assert.equal(inWindow(clock.insideNowAt, clock.narrowFrom, clock.to), true);
  assert.equal(inWindow(clock.insideNowAt, clock.wideFrom, clock.to), true);
});

test('selection check rejects a window that still contains the outside login', () => {
  const now = new Date('2026-10-15T04:00:00.000Z');
  const clock = demoWindows(now);
  assert.throws(
    () =>
      assertLoginSelection(
        [{ id: 'fail', createdAt: clock.outsideAt.toISOString(), username: FAIL_USERNAME }],
        { from: clock.narrowFrom, to: clock.to, forbidden: ['fail'] },
      ),
    /fail/,
  );
  assert.throws(
    () =>
      assertLoginSelection(
        [
          { id: 'fail', createdAt: clock.outsideAt.toISOString(), username: FAIL_USERNAME },
          { id: 'ok', createdAt: clock.insideNowAt.toISOString(), username: ADMIN_USERNAME },
        ],
        { username: FAIL_USERNAME, required: ['fail'] },
      ),
    /admin/,
  );
});

test('proof names both logins, the empty filter, and the audit page', () => {
  const now = new Date('2026-10-15T04:00:00.000Z');
  const clock = demoWindows(now);
  const proof = formatAuditLoginProof({
    failure: { id: 'fail', createdAt: clock.outsideAt.toISOString(), result: 'failure' },
    success: { id: 'ok', createdAt: clock.insideNowAt.toISOString(), result: 'success' },
    clock,
    wideCount: 3,
    narrowCount: 2,
    userCount: 1,
    emptyCount: 0,
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, new RegExp(`${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`));
  assert.match(proof, new RegExp(`用户 ${FAIL_USERNAME}，结果失败`));
  assert.match(proof, new RegExp(`用户 ${ADMIN_USERNAME}，结果成功`));
  assert.match(proof, new RegExp(DEMO_USER_AGENT));
  assert.match(proof, /窄窗口少于宽窗口: 是/);
  assert.match(proof, /窄窗口含成功、不含失败: 是/);
  assert.match(proof, new RegExp(`用户 ${FAIL_USERNAME} 条数: 1`));
  assert.match(proof, new RegExp(`用户 ${FAIL_USERNAME} 窄窗口条数: 0`));
  assert.match(proof, /auth\.login_failed/);
  assert.match(proof, /auth\.login/);
  assert.match(proof, /审计页: http:\/\/127\.0\.0\.1:43123\/audit$/m);
  assert.match(proof, /宽窗口列表: http:\/\/127\.0\.0\.1:43123\/audit\?/);
  assert.match(proof, /失败用户列表: http:\/\/127\.0\.0\.1:43123\/audit\?username=login-log-fail$/m);
  assert.match(proof, /空筛选列表: .*username=login-log-fail/);
  assert.equal(
    auditPageUrl({ username: FAIL_USERNAME }, 'http://127.0.0.1:43123'),
    'http://127.0.0.1:43123/audit?username=login-log-fail',
  );
  assert.doesNotMatch(proof, /ingest|heartbeat|alerts/);
});

test('http chain writes one failure and one success, then reuses them', async () => {
  const now = new Date('2026-10-15T04:00:00.000Z');
  const state = { logins: [], audits: [], nextId: 1, now };
  const db = memoryDb(state.logins);
  const fetchMock = installFetch(state);
  try {
    const first = await showAuditLoginLogs({ now, db });
    assert.equal(first.userCount, 1);
    assert.equal(first.emptyCount, 0);
    assert.equal(first.narrowCount < first.wideCount, true);
    assert.equal(first.failure.createdAt, demoWindows(now).outsideAt.toISOString());
    assert.equal(first.success.createdAt, demoWindows(now).insideNowAt.toISOString());
    const demoRows = state.logins.filter((row) => row.userAgent === DEMO_USER_AGENT);
    assert.equal(demoRows.length, 2);
    assert.equal(demoRows.filter((row) => row.result === 'failure' && row.username === FAIL_USERNAME).length, 1);
    assert.equal(demoRows.filter((row) => row.result === 'success' && row.username === ADMIN_USERNAME).length, 1);
    assert.equal(state.logins.filter((row) => row.userAgent === TOKEN_USER_AGENT).length, 1);
    const loginPosts = fetchMock.calls.filter((line) => line.startsWith('POST') && line.includes('/auth/login'));
    assert.equal(loginPosts.length, 3);

    const second = await showAuditLoginLogs({ now, db });
    assert.equal(second.failure.id, first.failure.id);
    assert.equal(second.success.id, first.success.id);
    assert.equal(state.logins.filter((row) => row.userAgent === DEMO_USER_AGENT).length, 2);
    const postsAfter = fetchMock.calls.filter((line) => line.startsWith('POST') && line.includes('/auth/login'));
    assert.equal(postsAfter.length, 4);
    assert.equal(state.logins.filter((row) => row.userAgent === TOKEN_USER_AGENT).length, 2);
    assert.equal(fetchMock.calls.some((line) => /ingest|heartbeat|\/alerts/.test(line)), false);
  } finally {
    fetchMock.restore();
  }
});

test('docs name the make target and leave the earlier audit demo alone', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_AUDIT_LOGIN_LOG.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  const earlierDoc = readFileSync(join(root, 'docs/DEMO_AUDIT_LOG.md'), 'utf8');
  const earlierScript = readFileSync(join(root, 'scripts/demo-audit-log.mjs'), 'utf8');
  const rbacScript = readFileSync(join(root, 'scripts/demo-rbac.mjs'), 'utf8');
  for (const text of [doc, caps, status, readme]) {
    assert.match(text, /make demo-audit-login-log/);
    assert.match(text, /login-log-fail/);
    assert.match(text, /\/audit/);
  }
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /audit-login-log-demo\/1/);
  assert.match(doc, /开始时间/);
  assert.match(doc, /结束时间/);
  assert.match(doc, /没有符合条件的登录日志/);
  assert.match(doc, /暂无登录日志/);
  assert.match(doc, /时间筛选无效/);
  assert.match(doc, /宽窗口列表/);
  assert.match(doc, /窄窗口列表/);
  assert.match(doc, /失败用户列表/);
  assert.match(doc, /空筛选列表/);
  assert.match(doc, /登录失败/);
  assert.match(doc, /登录成功/);
  assert.match(doc, /make demo-audit-log/);
  assert.match(doc, /不发识别/);
  assert.doesNotMatch(doc, /假定|假设/);
  assert.match(caps, /DEMO_AUDIT_LOGIN_LOG\.md/);
  assert.match(readme, /DEMO_AUDIT_LOGIN_LOG\.md/);
  assert.match(makefile, /^demo-audit-login-log:.*\n\tnode scripts\/demo-audit-login-log\.mjs\s*$/m);
  assert.match(makefile, /scripts\/demo-audit-login-log\.spec\.mjs/);
  assert.match(makefile, /^demo-audit-log:.*\n\tnode scripts\/demo-audit-log\.mjs\s*$/m);
  assert.doesNotMatch(earlierDoc, /login-log-fail|demo-audit-login-log|audit-login-log-demo/);
  assert.doesNotMatch(earlierScript, /login-log-fail|demo-audit-login-log|audit-login-log-demo/);
  assert.doesNotMatch(rbacScript, /login-log-fail|demo-audit-login-log/);
});
