import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { repoRoot } from './lib/ingest-wire.mjs';
import {
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  HIDDEN_SHED,
  VIEWER_PASSWORD,
  VIEWER_SHED,
  VIEWER_USERNAME,
  assertRbacScopes,
  ensureViewer,
  formatRbacProof,
  menuLabels,
  showRbac,
  viewerBody,
} from './demo-rbac.mjs';

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

function scopes(overrides = {}) {
  return {
    adminSession: session(ADMIN_USERNAME, 'super_admin', []),
    viewerSession: session(VIEWER_USERNAME, 'viewer', [VIEWER_SHED]),
    users: {
      adminStatus: 200,
      adminBody: [
        { username: ADMIN_USERNAME, role: 'super_admin' },
        { username: VIEWER_USERNAME, role: 'viewer' },
      ],
      viewerStatus: 403,
    },
    auditLogs: { adminStatus: 200, viewerStatus: 403 },
    loginLogs: { adminStatus: 200, viewerStatus: 403 },
    sheds: {
      adminBody: [{ code: 'S01' }, { code: 'S02' }, { code: 'S03' }],
      viewerBody: [{ code: 'S01' }],
    },
    ...overrides,
  };
}

test('viewer body resets the known account onto S01', () => {
  assert.deepEqual(viewerBody(), {
    username: 'viewer',
    password: 'Viewer@123456',
    displayName: '只读查看',
    role: 'viewer',
    shedCodes: ['S01'],
    resetPassword: true,
  });
  const admin = menuLabels('super_admin');
  const viewer = menuLabels('viewer');
  assert.ok(admin.includes('审计'));
  assert.ok(admin.includes('用户'));
  assert.equal(viewer.includes('审计'), false);
  assert.equal(viewer.includes('用户'), false);
  assert.ok(viewer.includes('总览'));
  assert.ok(viewer.includes('基地大屏'));
  assert.ok(viewer.includes('值班看板'));
  const adminMenus = assertRbacScopes(scopes()).adminMenus;
  assert.ok(adminMenus.includes('用户'));
  assert.equal(adminMenus[adminMenus.length - 1], '数据备份');
  assert.equal(viewer.includes('数据备份'), false);
});

test('scope check rejects a viewer who can read users or S02', () => {
  assert.throws(() => assertRbacScopes(scopes({ users: { ...scopes().users, viewerStatus: 200 } })), /403/);
  assert.throws(
    () =>
      assertRbacScopes(
        scopes({
          sheds: {
            adminBody: [{ code: 'S01' }, { code: 'S02' }],
            viewerBody: [{ code: 'S01' }, { code: 'S02' }],
          },
        }),
      ),
    /不含 S02/,
  );
  assert.throws(
    () =>
      assertRbacScopes(
        scopes({
          users: {
            adminStatus: 200,
            adminBody: [
              { username: 'admin', role: 'super_admin' },
              { username: 'viewer', role: 'viewer', note: VIEWER_PASSWORD },
            ],
            viewerStatus: 403,
          },
        }),
      ),
    /密码/,
  );
});

test('proof prints both logins and the routes that differ', () => {
  const proof = formatRbacProof({
    ...assertRbacScopes(scopes()),
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, new RegExp(`超管: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`));
  assert.match(proof, new RegExp(`查看: ${VIEWER_USERNAME} / ${VIEWER_PASSWORD}`));
  assert.match(proof, /登录: http:\/\/127\.0\.0\.1:43123\/login/);
  assert.match(proof, /超管菜单: .*审计、用户/);
  assert.match(proof, /查看没有: 审计、用户/);
  assert.doesNotMatch(proof.split('\n').find((line) => line.startsWith('查看菜单')), /审计|用户/);
  assert.match(proof, /用户接口: 超管 200，查看 403/);
  assert.match(proof, /审计接口: 超管 200，查看 403/);
  assert.match(proof, /登录日志: 超管 200，查看 403/);
  assert.match(proof, new RegExp(`棚区: 超管含 ${VIEWER_SHED}、${HIDDEN_SHED}`));
  assert.match(proof, /审计页: http:\/\/127\.0\.0\.1:43123\/audit/);
  assert.match(proof, /用户页: http:\/\/127\.0\.0\.1:43123\/users/);
  assert.doesNotMatch(proof, /ingest|heartbeat|alerts/);
});

test('docs name the same two accounts and the hidden menus', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_RBAC.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  for (const text of [doc, caps]) {
    assert.match(text, /make demo-rbac/);
    assert.match(text, /admin/);
    assert.match(text, /Admin@123456/);
    assert.match(text, /viewer/);
    assert.match(text, /Viewer@123456/);
    assert.match(text, /\/audit/);
    assert.match(text, /\/users/);
  }
  assert.match(doc, /查看没有/);
  assert.doesNotMatch(doc, /假定|假设/);
});

test('http chain logs in both roles and does not touch ingest or alerts', async () => {
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
        return jsonResponse(201, session(ADMIN_USERNAME, 'super_admin', []));
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
    if (target.endsWith('/users') && method === 'GET') {
      if (token === 'Bearer tok-admin') {
        return jsonResponse(200, [
          { username: ADMIN_USERNAME, role: 'super_admin' },
          { username: VIEWER_USERNAME, role: 'viewer', shedCodes: [VIEWER_SHED] },
        ]);
      }
      return jsonResponse(403, { message: '当前角色无权执行此操作' });
    }
    if (target.endsWith('/audit-logs') || target.endsWith('/login-logs')) {
      if (token === 'Bearer tok-admin') return jsonResponse(200, { items: [], total: 0 });
      return jsonResponse(403, { message: '当前角色无权执行此操作' });
    }
    if (target.endsWith('/sheds')) {
      if (token === 'Bearer tok-admin') {
        return jsonResponse(200, [{ code: 'S01' }, { code: 'S02' }, { code: 'S03' }]);
      }
      return jsonResponse(200, [{ code: 'S01' }]);
    }
    return jsonResponse(500, { message: `未预期的请求 ${target}` });
  };
  try {
    const result = await showRbac();
    assert.equal(result.viewerMenus.includes('审计'), false);
    assert.equal(result.adminMenus.includes('用户'), true);
    assert.equal(calls.some((line) => line.includes('/ingest')), false);
    assert.equal(calls.some((line) => line.includes('/alerts')), false);
    assert.equal(calls.some((line) => line.includes('/heartbeat')), false);
    assert.equal(calls.filter((line) => line.startsWith('POST') && line.endsWith('/users')).length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('ensureViewer rejects a write that does not stick to S01', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    jsonResponse(201, { username: 'viewer', role: 'viewer', shedCodes: ['S01', 'S02'] });
  try {
    await assert.rejects(() => ensureViewer('tok-admin'), /棚号/);
  } finally {
    globalThis.fetch = original;
  }
});
