import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { repoRoot } from './lib/ingest-wire.mjs';
import { ADMIN_PASSWORD, ADMIN_USERNAME } from './demo-rbac.mjs';
import {
  SELF_DISPLAY_NAME,
  SELF_NEW_PASSWORD,
  SELF_OLD_PASSWORD,
  SELF_ROLE,
  SELF_SHED,
  SELF_USERNAME,
  assertChangeResponse,
  assertLoginContrast,
  assertPasswordNav,
  assertPasswordPage,
  changeBody,
  createBody,
  formatPasswordSelfProof,
  restoreBody,
  showPasswordSelf,
} from './demo-password-self.mjs';

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
      displayName: username === SELF_USERNAME ? SELF_DISPLAY_NAME : username,
      role,
      shedCodes,
    },
  };
}

function demoRow() {
  return {
    id: 'user-self',
    username: SELF_USERNAME,
    displayName: SELF_DISPLAY_NAME,
    role: SELF_ROLE,
    shedCodes: [SELF_SHED],
    enabled: true,
    createdAt: '2026-10-15T00:00:00.000Z',
  };
}

test('page and nav are open to every logged-in role', () => {
  assert.doesNotThrow(() => assertPasswordPage());
  assert.doesNotThrow(() => assertPasswordNav());
  assert.throws(
    () => assertPasswordPage('<div data-testid="password-self-form">修改密码</div>'),
    /当前密码/,
  );
  assert.throws(
    () => assertPasswordNav([{ to: '/account/password', label: '修改密码', roles: ['super_admin'] }]),
    /所有已登录角色/,
  );
  assert.equal(Object.hasOwn(createBody(), 'resetPassword'), false);
  assert.equal(restoreBody().resetPassword, true);
  assert.equal(restoreBody().password, SELF_OLD_PASSWORD);
  assert.deepEqual(changeBody(), {
    currentPassword: SELF_OLD_PASSWORD,
    newPassword: SELF_NEW_PASSWORD,
  });
  assert.doesNotThrow(() =>
    assertChangeResponse({ username: SELF_USERNAME, changed: true }),
  );
  assert.throws(
    () => assertChangeResponse({ username: SELF_USERNAME, changed: true, password: SELF_NEW_PASSWORD }),
    /密码/,
  );
});

test('login contrast is 401 for the old password and success for the new one', () => {
  assert.doesNotThrow(() =>
    assertLoginContrast({
      oldStatus: 401,
      newStatus: 201,
      newBody: session(SELF_USERNAME, SELF_ROLE, [SELF_SHED]),
    }),
  );
  assert.doesNotThrow(() =>
    assertLoginContrast({
      oldStatus: 401,
      newStatus: 200,
      newBody: session(SELF_USERNAME, SELF_ROLE, [SELF_SHED]),
    }),
  );
  assert.throws(
    () =>
      assertLoginContrast({
        oldStatus: 200,
        newStatus: 201,
        newBody: session(SELF_USERNAME, SELF_ROLE, [SELF_SHED]),
      }),
    /401/,
  );
  assert.throws(
    () =>
      assertLoginContrast({
        oldStatus: 401,
        newStatus: 401,
        newBody: session(SELF_USERNAME, SELF_ROLE, [SELF_SHED]),
      }),
    /成功/,
  );
});

test('proof names the change page, the failed login, and the page after success', () => {
  const proof = formatPasswordSelfProof({ webOrigin: 'http://127.0.0.1:43123' });
  assert.match(proof, new RegExp(`超管: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`));
  assert.match(proof, new RegExp(`账号: ${SELF_USERNAME}`));
  assert.match(proof, new RegExp(`旧密码: ${SELF_OLD_PASSWORD}`));
  assert.match(proof, new RegExp(`新密码: ${SELF_NEW_PASSWORD}`));
  assert.match(proof, /改密: 200/);
  assert.match(proof, /旧密码登录: 401/);
  assert.match(proof, /新密码登录: 201/);
  assert.match(proof, /登录页: http:\/\/127\.0\.0\.1:43123\/login/);
  assert.match(proof, /修改密码页: http:\/\/127\.0\.0\.1:43123\/account\/password/);
  assert.match(proof, /登录成功后: http:\/\/127\.0\.0\.1:43123\//);
  assert.doesNotMatch(proof, /ingest|heartbeat|alerts/i);
});

test('docs name the make target and the screenshot routes', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_PASSWORD_SELF.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  for (const text of [doc, caps, status, readme]) {
    assert.match(text, /make demo-password-self/);
    assert.match(text, /\/account\/password/);
    assert.match(text, new RegExp(SELF_USERNAME));
  }
  assert.match(doc, /Admin@123456/);
  assert.match(doc, new RegExp(SELF_OLD_PASSWORD));
  assert.match(doc, new RegExp(SELF_NEW_PASSWORD));
  assert.match(doc, /401/);
  assert.match(doc, /200/);
  assert.match(doc, /201/);
  assert.match(doc, /用户名或密码错误/);
  assert.match(doc, /http:\/\/127\.0\.0\.1:43123\/account\/password/);
  assert.match(doc, /http:\/\/127\.0\.0\.1:43123\/login/);
  assert.match(doc, /http:\/\/127\.0\.0\.1:43123\//);
  assert.match(doc, /make up && make migrate/);
  assert.match(doc, /make api/);
  assert.match(doc, /make web/);
  assert.match(doc, /make demo-user-create-reset/);
  assert.match(doc, /make demo-rbac/);
  assert.match(caps, /DEMO_PASSWORD_SELF\.md/);
  assert.match(readme, /DEMO_PASSWORD_SELF\.md/);
  assert.match(makefile, /^demo-password-self:.*\n\tnode scripts\/demo-password-self\.mjs\s*$/m);
  assert.match(makefile, /scripts\/demo-password-self\.spec\.mjs/);
  assert.match(makefile, /^demo-user-create-reset:.*\n\tnode scripts\/demo-user-create-reset\.mjs\s*$/m);
  assert.match(makefile, /^demo-user-enable-disable:.*\n\tnode scripts\/demo-user-enable-disable\.mjs\s*$/m);
  assert.doesNotMatch(doc, /假定|假设/);
  const usersController = readFileSync(join(root, 'apps/api/src/auth/users.controller.ts'), 'utf8');
  assert.match(usersController, /resetPassword/);
  assert.doesNotMatch(usersController, /change-password|changeOwnPassword|currentPassword/);
  const ingest = readFileSync(join(root, 'apps/web/src/views/IngestObservabilityView.vue'), 'utf8');
  assert.doesNotMatch(ingest, /change-password|pwd-self-demo|demo-password-self/);
  for (const rel of [
    'scripts/demo-user-mgmt.mjs',
    'scripts/demo-rbac.mjs',
    'scripts/demo-user-create-reset.mjs',
    'scripts/demo-user-enable-disable.mjs',
    'docs/DEMO_RBAC.md',
    'docs/DEMO_USER_CREATE_RESET.md',
  ]) {
    const text = readFileSync(join(root, rel), 'utf8');
    assert.doesNotMatch(text, /demo-password-self|pwd-self-demo/);
  }
});

function installFetch({ present = false } = {}) {
  const calls = [];
  let row = present ? demoRow() : null;
  let password = present ? SELF_NEW_PASSWORD : null;
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    const method = init?.method || 'GET';
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push(`${method} ${target}`);
    if (target.endsWith('/auth/login')) {
      if (body.username === ADMIN_USERNAME) {
        assert.equal(body.password, ADMIN_PASSWORD);
        return jsonResponse(201, session(ADMIN_USERNAME, 'super_admin', []));
      }
      if (body.username === SELF_USERNAME) {
        if (body.password === password) {
          return jsonResponse(201, session(SELF_USERNAME, SELF_ROLE, [SELF_SHED]));
        }
        return jsonResponse(401, { message: '用户名或密码错误' });
      }
      return jsonResponse(401, { message: '用户名或密码错误' });
    }
    if (target.endsWith('/users') && method === 'GET') {
      assert.equal(init?.headers?.authorization, 'Bearer tok-admin');
      return jsonResponse(200, row ? [row] : []);
    }
    if (target.endsWith('/users') && method === 'POST') {
      assert.equal(init?.headers?.authorization, 'Bearer tok-admin');
      assert.equal(body.username, SELF_USERNAME);
      assert.equal(body.password, SELF_OLD_PASSWORD);
      if (!row) {
        assert.equal(Object.hasOwn(body, 'resetPassword'), false);
        row = demoRow();
        password = SELF_OLD_PASSWORD;
        return jsonResponse(201, { id: row.id, username: row.username });
      }
      assert.equal(body.resetPassword, true);
      assert.equal(body.displayName, SELF_DISPLAY_NAME);
      password = SELF_OLD_PASSWORD;
      return jsonResponse(201, { id: row.id, username: row.username });
    }
    if (target.endsWith('/auth/change-password') && method === 'POST') {
      assert.equal(init?.headers?.authorization, 'Bearer tok-pwd-self-demo');
      assert.deepEqual(body, changeBody());
      password = SELF_NEW_PASSWORD;
      return jsonResponse(200, { username: SELF_USERNAME, changed: true });
    }
    return jsonResponse(404, { message: '未实现' });
  };
  return calls;
}

test('http chain creates or restores the fixture, then contrasts old 401 and new login', async () => {
  const original = globalThis.fetch;
  try {
    const created = installFetch({ present: false });
    const fresh = await showPasswordSelf();
    assert.equal(fresh.newStatus, 201);
    assert.equal(created.filter((line) => line.includes('/auth/change-password')).length, 1);
    assert.equal(created.filter((line) => line.endsWith('/users') && line.startsWith('POST')).length, 1);
    assert.equal(created.filter((line) => line.includes('/auth/login')).length, 4);

    const restored = installFetch({ present: true });
    const again = await showPasswordSelf();
    assert.equal(again.newStatus, 201);
    assert.equal(restored.filter((line) => line.endsWith('/users') && line.startsWith('POST')).length, 1);
    assert.equal(restored.filter((line) => line.includes('/auth/change-password')).length, 1);
  } finally {
    globalThis.fetch = original;
  }
});
