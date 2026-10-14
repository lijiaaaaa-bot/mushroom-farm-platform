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
  ADMIN_ROLE,
  ADMIN_ROLE_LABEL,
  VIEWER_ROLE,
  VIEWER_ROLE_LABEL,
  assertUserList,
  assertUserMgmt,
  assertUsersPageListsRoles,
  assertViewerCannotOpenUsersPage,
  formatUserMgmtProof,
  showUserMgmt,
} from './demo-user-mgmt.mjs';

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

function rows() {
  return [
    { id: 'user-admin', username: ADMIN_USERNAME, displayName: '系统管理员', role: ADMIN_ROLE, shedCodes: [], enabled: true },
    { id: 'user-viewer', username: VIEWER_USERNAME, displayName: '只读查看', role: VIEWER_ROLE, shedCodes: [VIEWER_SHED], enabled: true },
  ];
}

function scopes(overrides = {}) {
  return {
    adminSession: session(ADMIN_USERNAME, ADMIN_ROLE, []),
    viewerSession: session(VIEWER_USERNAME, VIEWER_ROLE, [VIEWER_SHED]),
    users: {
      adminStatus: 200,
      adminBody: rows(),
      viewerStatus: 403,
    },
    ...overrides,
  };
}

test('users page lists roles and the viewer cannot open it', () => {
  assert.doesNotThrow(() => assertUsersPageListsRoles());
  assert.throws(() => assertUsersPageListsRoles('<table><th>用户名</th></table>'), /角色列/);
  assert.throws(() => assertUsersPageListsRoles('<th>角色</th> ROLE_LABEL <form>'), /表单/);
  assert.doesNotThrow(() => assertViewerCannotOpenUsersPage());
  assert.throws(
    () => assertViewerCannotOpenUsersPage({ nav: [{ to: '/users', label: '用户', roles: ['super_admin', 'viewer'] }] }),
    /只给超管/,
  );
  assert.throws(
    () =>
      assertViewerCannotOpenUsersPage({
        routerSource: "path: 'users'\nroles: navRoles('/users')\nreturn true;",
      }),
    /回到总览/,
  );
});

test('list check keeps two readable roles and rejects a short or secret list', () => {
  const listed = assertUserList(rows());
  assert.equal(listed.length, 2);
  assert.equal(listed[0].roleLabel, ADMIN_ROLE_LABEL);
  assert.equal(listed[1].roleLabel, VIEWER_ROLE_LABEL);
  const checked = assertUserMgmt(scopes());
  assert.equal(checked.adminMenus.includes('用户'), true);
  assert.equal(checked.viewerMenus.includes('用户'), false);
  assert.throws(() => assertUserList([rows()[0]]), /至少有两条/);
  assert.throws(
    () => assertUserList([{ username: ADMIN_USERNAME, role: ADMIN_ROLE, passwordHash: 'x' }, rows()[1]]),
    /密码/,
  );
  assert.throws(() => assertUserMgmt(scopes({ users: { ...scopes().users, viewerStatus: 200 } })), /403/);
});

test('proof prints both accounts, the role words, and the blocked page', () => {
  const proof = formatUserMgmtProof({
    ...assertUserMgmt(scopes()),
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, new RegExp(`超管: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`));
  assert.match(proof, new RegExp(`查看: ${VIEWER_USERNAME} / ${VIEWER_PASSWORD}`));
  assert.match(proof, /用户页: http:\/\/127\.0\.0\.1:43123\/users/);
  assert.match(proof, /条数: 2/);
  assert.match(proof, new RegExp(`账号: ${ADMIN_USERNAME} ${ADMIN_ROLE_LABEL}`));
  assert.match(proof, new RegExp(`账号: ${VIEWER_USERNAME} ${VIEWER_ROLE_LABEL}`));
  assert.match(proof, /查看菜单不含用户/);
  assert.match(proof, /查看打开用户页回到总览/);
  assert.match(proof, /用户接口: 超管 200，查看 403/);
  assert.match(proof, /总览: http:\/\/127\.0\.0\.1:43123\//);
  assert.doesNotMatch(proof, /ingest|heartbeat|alerts|password/i);
});

test('docs name the make target and leave the earlier demos alone', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_USER_MGMT.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  const untouched = [
    'docs/DEMO_RBAC.md',
    'docs/DEMO_AUDIT_LOG.md',
    'docs/DEMO_ALERT_STATUS_FILTER.md',
    'docs/DEMO_DUTY_BOARD.md',
    'scripts/demo-rbac.mjs',
    'scripts/demo-audit-log.mjs',
    'scripts/demo-alert-status-filter.mjs',
    'scripts/demo-duty-board.mjs',
  ];
  for (const text of [doc, caps, status, readme]) {
    assert.match(text, /make demo-user-mgmt/);
    assert.match(text, /\/users/);
    assert.match(text, new RegExp(ADMIN_ROLE_LABEL));
    assert.match(text, new RegExp(VIEWER_ROLE_LABEL));
  }
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /Viewer@123456/);
  assert.match(doc, /403/);
  assert.match(doc, /回到总览/);
  assert.match(doc, /make up && make migrate/);
  assert.match(doc, /make api/);
  assert.match(caps, /DEMO_USER_MGMT\.md/);
  assert.match(readme, /DEMO_USER_MGMT\.md/);
  assert.match(makefile, /^demo-user-mgmt:.*\n\tnode scripts\/demo-user-mgmt\.mjs\s*$/m);
  assert.match(makefile, /scripts\/demo-user-mgmt\.spec\.mjs/);
  assert.match(doc, /make demo-rbac/);
  assert.doesNotMatch(doc, /假定|假设/);
  for (const rel of untouched) {
    const text = readFileSync(join(root, rel), 'utf8');
    assert.doesNotMatch(text, /demo-user-mgmt/);
  }
});

test('http chain logs in both roles and only reads the user list', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    const method = init?.method || 'GET';
    calls.push(`${method} ${target}`);
    const token = init?.headers?.authorization;
    if (target.endsWith('/auth/login')) {
      const body = JSON.parse(init.body);
      if (body.username === ADMIN_USERNAME) {
        assert.equal(body.password, ADMIN_PASSWORD);
        return jsonResponse(201, session(ADMIN_USERNAME, ADMIN_ROLE, []));
      }
      assert.equal(body.username, VIEWER_USERNAME);
      assert.equal(body.password, VIEWER_PASSWORD);
      return jsonResponse(201, session(VIEWER_USERNAME, VIEWER_ROLE, [VIEWER_SHED]));
    }
    if (target.endsWith('/users') && method === 'POST') {
      assert.equal(token, 'Bearer tok-admin');
      assert.deepEqual(JSON.parse(init.body), viewerBody());
      return jsonResponse(201, {
        id: 'user-viewer',
        username: VIEWER_USERNAME,
        displayName: '只读查看',
        role: VIEWER_ROLE,
        shedCodes: [VIEWER_SHED],
      });
    }
    if (target.endsWith('/users') && method === 'GET') {
      if (token === 'Bearer tok-admin') return jsonResponse(200, rows());
      return jsonResponse(403, { message: '当前角色无权执行此操作' });
    }
    return jsonResponse(500, { message: `未预期的请求 ${target}` });
  };
  try {
    const result = await showUserMgmt();
    assert.equal(result.listed.length, 2);
    assert.equal(result.viewerMenus.includes('用户'), false);
    assert.equal(calls.filter((line) => line.startsWith('POST') && line.endsWith('/users')).length, 1);
    assert.equal(calls.filter((line) => line.startsWith('GET') && line.endsWith('/users')).length, 2);
    assert.equal(calls.some((line) => /ingest|heartbeat|alerts|audit-logs|login-logs|sheds/.test(line)), false);
  } finally {
    globalThis.fetch = original;
  }
});
