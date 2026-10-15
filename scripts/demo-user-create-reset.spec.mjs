import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { repoRoot } from './lib/ingest-wire.mjs';
import { ADMIN_PASSWORD, ADMIN_USERNAME } from './demo-rbac.mjs';
import {
  CREATE_DISPLAY_NAME,
  CREATE_PASSWORD,
  CREATE_ROLE,
  CREATE_SHED,
  CREATE_USERNAME,
  RESET_DISPLAY_NAME,
  RESET_NEW_PASSWORD,
  RESET_OLD_PASSWORD,
  RESET_ROLE,
  RESET_SHED,
  RESET_USERNAME,
  assertCreateRow,
  assertLoginContrast,
  assertResetKept,
  assertUsersPageCanCreateAndReset,
  createBody,
  formatUserCreateResetProof,
  resetBody,
  resetSeedBody,
  showUserCreateReset,
} from './demo-user-create-reset.mjs';

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

function createdRow() {
  return {
    id: 'user-create',
    username: CREATE_USERNAME,
    displayName: CREATE_DISPLAY_NAME,
    role: CREATE_ROLE,
    shedCodes: [CREATE_SHED],
    enabled: true,
  };
}

function resetRow() {
  return {
    id: 'user-reset',
    username: RESET_USERNAME,
    displayName: RESET_DISPLAY_NAME,
    role: RESET_ROLE,
    shedCodes: [RESET_SHED],
    enabled: true,
  };
}

test('page source has the create form and a reset entry', () => {
  assert.doesNotThrow(() => assertUsersPageCanCreateAndReset());
  assert.throws(() => assertUsersPageCanCreateAndReset('<div>用户</div>'), /新建用户表单/);
  assert.equal(Object.hasOwn(createBody(), 'resetPassword'), false);
  assert.equal(resetBody().resetPassword, true);
  assert.equal(resetSeedBody().password, RESET_OLD_PASSWORD);
  assert.equal(resetBody().password, RESET_NEW_PASSWORD);
});

test('list and login checks keep the row and reject the old password', () => {
  const created = assertCreateRow([createdRow()], { fresh: true });
  assert.equal(created.username, CREATE_USERNAME);
  const kept = assertResetKept([createdRow(), resetRow()], [createdRow(), resetRow()], {
    id: 'user-reset',
    username: RESET_USERNAME,
  });
  assert.equal(kept.id, 'user-reset');
  assert.doesNotThrow(() =>
    assertLoginContrast({
      freshStatus: 201,
      freshBody: session(RESET_USERNAME, RESET_ROLE, [RESET_SHED]),
      staleStatus: 401,
    }),
  );
  assert.throws(() => assertCreateRow([{ username: 'admin' }], { fresh: false }), /应含/);
  assert.throws(
    () => assertCreateRow([{ ...createdRow(), passwordHash: 'x' }], { fresh: true }),
    /密码/,
  );
  assert.throws(
    () => assertResetKept([resetRow()], [{ ...resetRow(), id: 'other' }], { id: 'other' }),
    /另建一行/,
  );
  assert.throws(
    () =>
      assertLoginContrast({
        freshStatus: 201,
        freshBody: session(RESET_USERNAME, RESET_ROLE, [RESET_SHED]),
        staleStatus: 201,
      }),
    /401/,
  );
});

test('proof prints the users page and both demo accounts', () => {
  const proof = formatUserCreateResetProof({ webOrigin: 'http://127.0.0.1:43123' });
  assert.match(proof, new RegExp(`超管: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`));
  assert.match(proof, new RegExp(`新建: ${CREATE_USERNAME} / ${CREATE_PASSWORD}`));
  assert.match(proof, new RegExp(`重设账号: ${RESET_USERNAME}`));
  assert.match(proof, new RegExp(`旧密码: ${RESET_OLD_PASSWORD}`));
  assert.match(proof, new RegExp(`新密码: ${RESET_NEW_PASSWORD}`));
  assert.match(proof, /旧密码登录: 401/);
  assert.match(proof, /新密码登录: 成功/);
  assert.match(proof, /用户页: http:\/\/127\.0\.0\.1:43123\/users/);
  assert.match(proof, /登录: http:\/\/127\.0\.0\.1:43123\/login/);
  assert.doesNotMatch(proof, /ingest|heartbeat|alerts/i);
});

test('docs name the make target and leave the earlier user demos alone', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_USER_CREATE_RESET.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  for (const text of [doc, caps, status, readme]) {
    assert.match(text, /make demo-user-create-reset/);
    assert.match(text, /\/users/);
    assert.match(text, new RegExp(CREATE_USERNAME));
    assert.match(text, new RegExp(RESET_USERNAME));
  }
  assert.match(doc, /Admin@123456/);
  assert.match(doc, new RegExp(CREATE_PASSWORD));
  assert.match(doc, new RegExp(RESET_OLD_PASSWORD));
  assert.match(doc, new RegExp(RESET_NEW_PASSWORD));
  assert.match(doc, /401/);
  assert.match(doc, /make up && make migrate/);
  assert.match(doc, /make api/);
  assert.match(doc, /make demo-user-mgmt/);
  assert.match(doc, /make demo-rbac/);
  assert.match(caps, /DEMO_USER_CREATE_RESET\.md/);
  assert.match(readme, /DEMO_USER_CREATE_RESET\.md/);
  assert.match(makefile, /^demo-user-create-reset:.*\n\tnode scripts\/demo-user-create-reset\.mjs\s*$/m);
  assert.match(makefile, /scripts\/demo-user-create-reset\.spec\.mjs/);
  assert.match(makefile, /^demo-user-mgmt:.*\n\tnode scripts\/demo-user-mgmt\.mjs\s*$/m);
  assert.match(makefile, /^demo-rbac:.*\n\tnode scripts\/demo-rbac\.mjs\s*$/m);
  assert.doesNotMatch(doc, /假定|假设/);
  for (const rel of ['scripts/demo-user-mgmt.mjs', 'scripts/demo-rbac.mjs', 'docs/DEMO_RBAC.md']) {
    const text = readFileSync(join(root, rel), 'utf8');
    assert.doesNotMatch(text, /demo-user-create-reset|user-create-demo|user-reset-demo/);
  }
});

function installFetch({ createStatus = 201, seedStatus = 201 } = {}) {
  const calls = [];
  const lists = [];
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    const method = init?.method || 'GET';
    calls.push(`${method} ${target}`);
    if (target.endsWith('/auth/login')) {
      const body = JSON.parse(init.body);
      if (body.username === ADMIN_USERNAME) {
        assert.equal(body.password, ADMIN_PASSWORD);
        return jsonResponse(201, session(ADMIN_USERNAME, 'super_admin', []));
      }
      if (body.username === RESET_USERNAME && body.password === RESET_NEW_PASSWORD) {
        return jsonResponse(201, session(RESET_USERNAME, RESET_ROLE, [RESET_SHED]));
      }
      if (body.username === RESET_USERNAME && body.password === RESET_OLD_PASSWORD) {
        return jsonResponse(401, { message: '用户名或密码错误' });
      }
      return jsonResponse(401, { message: '用户名或密码错误' });
    }
    if (target.endsWith('/users') && method === 'POST') {
      assert.equal(init?.headers?.authorization, 'Bearer tok-admin');
      const body = JSON.parse(init.body);
      if (body.username === CREATE_USERNAME) {
        assert.deepEqual(body, createBody());
        if (createStatus === 409) return jsonResponse(409, { message: '用户名已存在' });
        return jsonResponse(201, {
          id: 'user-create',
          username: CREATE_USERNAME,
          displayName: CREATE_DISPLAY_NAME,
          role: CREATE_ROLE,
          shedCodes: [CREATE_SHED],
        });
      }
      if (body.username === RESET_USERNAME && body.resetPassword !== true) {
        assert.deepEqual(body, resetSeedBody());
        if (seedStatus === 409) return jsonResponse(409, { message: '用户名已存在' });
        return jsonResponse(201, {
          id: 'user-reset',
          username: RESET_USERNAME,
          displayName: RESET_DISPLAY_NAME,
          role: RESET_ROLE,
          shedCodes: [RESET_SHED],
        });
      }
      assert.deepEqual(body, resetBody());
      return jsonResponse(201, {
        id: 'user-reset',
        username: RESET_USERNAME,
        displayName: RESET_DISPLAY_NAME,
        role: RESET_ROLE,
        shedCodes: [RESET_SHED],
      });
    }
    if (target.endsWith('/users') && method === 'GET') {
      lists.push(1);
      const rows = [createdRow()];
      if (lists.length >= 2) rows.push(resetRow());
      return jsonResponse(200, rows);
    }
    return jsonResponse(500, { message: `未预期的请求 ${target}` });
  };
  return calls;
}

test('http chain creates one user, resets another, and checks both passwords', async () => {
  const original = globalThis.fetch;
  const calls = installFetch();
  try {
    const result = await showUserCreateReset();
    assert.equal(result.fresh, true);
    assert.equal(result.listed.some((row) => row.username === CREATE_USERNAME), true);
    assert.equal(result.listed.some((row) => row.username === RESET_USERNAME), true);
    assert.equal(calls.filter((line) => line.startsWith('POST') && line.endsWith('/users')).length, 3);
    assert.equal(calls.filter((line) => line.startsWith('GET') && line.endsWith('/users')).length, 3);
    assert.equal(calls.filter((line) => line.includes('/auth/login')).length, 3);
    assert.equal(calls.some((line) => /ingest|heartbeat|alerts|audit-logs|login-logs|sheds/.test(line)), false);
    assert.equal(calls.some((line) => line.includes('viewer')), false);
  } finally {
    globalThis.fetch = original;
  }
});

test('an existing create user is left in place and an existing reset user is not duplicated', async () => {
  const original = globalThis.fetch;
  const calls = installFetch({ createStatus: 409, seedStatus: 409 });
  try {
    const result = await showUserCreateReset();
    assert.equal(result.fresh, false);
    assert.equal(calls.filter((line) => line.startsWith('POST') && line.endsWith('/users')).length, 3);
    const resetPosts = calls.filter((line) => line.startsWith('POST') && line.endsWith('/users'));
    assert.equal(resetPosts.length, 3);
  } finally {
    globalThis.fetch = original;
  }
});
