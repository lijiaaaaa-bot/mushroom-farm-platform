import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { repoRoot } from './lib/ingest-wire.mjs';
import {
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  VIEWER_PASSWORD,
  VIEWER_SHED,
  VIEWER_USERNAME,
  viewerBody,
} from './demo-rbac.mjs';
import {
  DEMO_LOGIN_PASSWORD,
  DEMO_LOGIN_USERNAME,
  DEMO_USER_AGENT,
  assertAuditEntries,
  failedLoginBody,
  formatAuditProof,
  showAuditLogs,
} from './demo-audit-log.mjs';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

function session(username, role, shedCodes) {
  return {
    accessToken: `tok-${username}`,
    user: {
      id: `id-${username}`,
      username,
      displayName: username,
      role,
      shedCodes,
    },
  };
}

function page(items) {
  return { items, total: items.length, page: 1, pageSize: 20 };
}

function entries(overrides = {}) {
  return {
    failedStatus: 401,
    loginLogs: {
      adminStatus: 200,
      adminBody: page([
        {
          username: DEMO_LOGIN_USERNAME,
          result: 'failure',
          userAgent: DEMO_USER_AGENT,
        },
        {
          username: ADMIN_USERNAME,
          result: 'success',
          userAgent: DEMO_USER_AGENT,
        },
      ]),
      viewerStatus: 403,
    },
    auditLogs: {
      adminStatus: 200,
      adminBody: page([
        {
          username: null,
          action: 'auth.login_failed',
          resource: 'auth',
          detail: { username: DEMO_LOGIN_USERNAME },
        },
        {
          username: ADMIN_USERNAME,
          action: 'auth.login',
          resource: 'auth',
          detail: null,
        },
      ]),
      viewerStatus: 403,
    },
    ...overrides,
  };
}

test('failed login body names the demo user and not a seed password', () => {
  assert.deepEqual(failedLoginBody(), {
    username: DEMO_LOGIN_USERNAME,
    password: DEMO_LOGIN_PASSWORD,
  });
  assert.equal(DEMO_LOGIN_USERNAME === ADMIN_USERNAME, false);
  assert.equal(DEMO_LOGIN_PASSWORD === ADMIN_PASSWORD, false);
  assert.equal(DEMO_USER_AGENT, 'audit-log-demo/1');
});

test('entry check rejects a viewer who can read the logs', () => {
  assert.throws(
    () => assertAuditEntries(entries({ loginLogs: { ...entries().loginLogs, viewerStatus: 200 } })),
    /403/,
  );
  assert.throws(
    () => assertAuditEntries(entries({ auditLogs: { ...entries().auditLogs, viewerStatus: 200 } })),
    /403/,
  );
  assert.throws(() => assertAuditEntries(entries({ failedStatus: 200 })), /401/);
});

test('entry check rejects a first page that hides the demo rows', () => {
  const missingLogin = entries();
  missingLogin.loginLogs.adminBody = page([
    { username: ADMIN_USERNAME, result: 'success', userAgent: 'node' },
  ]);
  assert.throws(() => assertAuditEntries(missingLogin), /audit-demo/);
  const missingAudit = entries();
  missingAudit.auditLogs.adminBody = page([
    { username: ADMIN_USERNAME, action: 'auth.login', detail: null },
  ]);
  assert.throws(() => assertAuditEntries(missingAudit), /auth\.login_failed/);
});

test('proof names both rows and the viewer block', () => {
  const proof = formatAuditProof({ webOrigin: 'http://127.0.0.1:43123' });
  assert.match(proof, new RegExp(`超管: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`));
  assert.match(proof, new RegExp(`查看: ${VIEWER_USERNAME} / ${VIEWER_PASSWORD}`));
  assert.match(proof, new RegExp(`用户 ${DEMO_LOGIN_USERNAME}，结果失败，User-Agent ${DEMO_USER_AGENT}`));
  assert.match(proof, new RegExp(`用户 ${ADMIN_USERNAME}，结果成功，User-Agent ${DEMO_USER_AGENT}`));
  assert.match(proof, /登录失败，明细 audit-demo/);
  assert.match(proof, /auth\.login_failed/);
  assert.match(proof, new RegExp(`用户 ${ADMIN_USERNAME}，登录成功`));
  assert.match(proof, /登录日志接口: 超管 200，查看 403/);
  assert.match(proof, /审计接口: 超管 200，查看 403/);
  assert.match(proof, /审计页: http:\/\/127\.0\.0\.1:43123\/audit/);
  assert.match(proof, /查看打开审计页回到总览/);
  assert.doesNotMatch(proof, /ingest|heartbeat|alerts/);
});

test('docs name the make target and leave the earlier demos alone', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_AUDIT_LOG.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  const rbacDoc = readFileSync(join(root, 'docs/DEMO_RBAC.md'), 'utf8');
  const statusDoc = readFileSync(join(root, 'docs/DEMO_ALERT_STATUS_FILTER.md'), 'utf8');
  const dutyDoc = readFileSync(join(root, 'docs/DEMO_DUTY_BOARD.md'), 'utf8');
  const rbacScript = readFileSync(join(root, 'scripts/demo-rbac.mjs'), 'utf8');
  for (const text of [doc, caps, status]) {
    assert.match(text, /make demo-audit-log/);
    assert.match(text, /audit-demo/);
    assert.match(text, /audit-log-demo\/1/);
    assert.match(text, /\/audit/);
  }
  assert.match(readme, /make demo-audit-log/);
  assert.match(readme, /audit-demo/);
  assert.match(readme, /\/audit/);
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /Viewer@123456/);
  assert.match(doc, /403/);
  assert.match(doc, /登录失败/);
  assert.match(caps, /DEMO_AUDIT_LOG\.md/);
  assert.match(readme, /DEMO_AUDIT_LOG\.md/);
  assert.match(makefile, /^demo-audit-log:.*\n\tnode scripts\/demo-audit-log\.mjs\s*$/m);
  assert.match(makefile, /scripts\/demo-audit-log\.spec\.mjs/);
  assert.match(rbacDoc, /make demo-rbac/);
  assert.match(statusDoc, /make demo-alert-status-filter/);
  assert.match(dutyDoc, /make demo-duty-board/);
  assert.doesNotMatch(rbacDoc, /demo-audit-log|audit-demo/);
  assert.doesNotMatch(statusDoc, /demo-audit-log|audit-demo/);
  assert.doesNotMatch(dutyDoc, /demo-audit-log|audit-demo/);
  assert.doesNotMatch(rbacScript, /demo-audit-log|audit-demo/);
  assert.doesNotMatch(doc, /假定|假设/);
});

test('http chain writes the two logins and does not touch ingest or alerts', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    const method = init?.method || 'GET';
    const token = init?.headers?.authorization;
    const userAgent = init?.headers?.['user-agent'];
    calls.push(`${method} ${target}`);
    if (target.endsWith('/auth/login')) {
      const body = JSON.parse(init.body);
      assert.equal(userAgent, DEMO_USER_AGENT);
      if (body.username === ADMIN_USERNAME) {
        assert.equal(body.password, ADMIN_PASSWORD);
        return jsonResponse(201, session(ADMIN_USERNAME, 'super_admin', []));
      }
      if (body.username === DEMO_LOGIN_USERNAME) {
        assert.deepEqual(body, failedLoginBody());
        return jsonResponse(401, { message: '用户名或密码错误' });
      }
      assert.equal(body.username, VIEWER_USERNAME);
      assert.equal(body.password, VIEWER_PASSWORD);
      return jsonResponse(201, session(VIEWER_USERNAME, 'viewer', [VIEWER_SHED]));
    }
    if (target.endsWith('/users') && method === 'POST') {
      assert.equal(token, 'Bearer tok-admin');
      assert.deepEqual(JSON.parse(init.body), viewerBody());
      return jsonResponse(201, {
        id: 'user-viewer',
        username: VIEWER_USERNAME,
        displayName: '只读查看',
        role: 'viewer',
        shedCodes: [VIEWER_SHED],
      });
    }
    if (target.includes('/login-logs') || target.includes('/audit-logs')) {
      assert.match(target, /pageSize=20/);
      if (token === 'Bearer tok-admin') {
        if (target.includes('/login-logs')) {
          return jsonResponse(
            200,
            page([
              {
                username: DEMO_LOGIN_USERNAME,
                result: 'failure',
                userAgent: DEMO_USER_AGENT,
              },
              {
                username: ADMIN_USERNAME,
                result: 'success',
                userAgent: DEMO_USER_AGENT,
              },
            ]),
          );
        }
        return jsonResponse(
          200,
          page([
            {
              username: null,
              action: 'auth.login_failed',
              resource: 'auth',
              detail: { username: DEMO_LOGIN_USERNAME },
            },
            {
              username: ADMIN_USERNAME,
              action: 'auth.login',
              resource: 'auth',
              detail: null,
            },
          ]),
        );
      }
      assert.equal(token, 'Bearer tok-viewer');
      return jsonResponse(403, { message: '当前角色无权执行此操作' });
    }
    return jsonResponse(500, { message: `未预期的请求 ${target}` });
  };
  try {
    const result = await showAuditLogs();
    assert.equal(result.viewerRole, 'viewer');
    assert.equal(calls.filter((line) => line.startsWith('POST') && line.endsWith('/auth/login')).length, 3);
    assert.equal(calls.filter((line) => line.startsWith('POST') && line.endsWith('/users')).length, 1);
    assert.equal(calls.some((line) => line.includes('/ingest')), false);
    assert.equal(calls.some((line) => line.includes('/alerts')), false);
    assert.equal(calls.some((line) => line.includes('/heartbeat')), false);
    assert.equal(calls.some((line) => line.includes('/devices')), false);
  } finally {
    globalThis.fetch = original;
  }
});
