import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { repoRoot } from './lib/ingest-wire.mjs';
import { ADMIN_PASSWORD, ADMIN_USERNAME } from './demo-rbac.mjs';
import {
  ENABLE_DISPLAY_NAME,
  ENABLE_PASSWORD,
  ENABLE_ROLE,
  ENABLE_SHED,
  ENABLE_USERNAME,
  assertEnabledFlip,
  assertEnabledRow,
  assertLoginContrast,
  assertUsersPageCanToggle,
  createBody,
  enabledBody,
  formatUserEnableDisableProof,
  showUserEnableDisable,
} from './demo-user-enable-disable.mjs';

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

function demoRow(enabled) {
  return {
    id: 'user-enable',
    username: ENABLE_USERNAME,
    displayName: ENABLE_DISPLAY_NAME,
    role: ENABLE_ROLE,
    shedCodes: [ENABLE_SHED],
    enabled,
    createdAt: '2026-10-15T00:00:00.000Z',
  };
}

test('page source has an 启用 column and a toggle for another user', () => {
  assert.doesNotThrow(() => assertUsersPageCanToggle());
  assert.throws(() => assertUsersPageCanToggle('<div>用户</div>'), /启用列/);
  assert.equal(Object.hasOwn(createBody(), 'resetPassword'), false);
  assert.deepEqual(enabledBody(false), { enabled: false });
  assert.equal(createBody().username, ENABLE_USERNAME);
  assert.equal(createBody().password, ENABLE_PASSWORD);
});

test('list contract keeps one row and login contrast is 401 after disable', () => {
  const before = assertEnabledRow(demoRow(true), { fresh: true, enabled: true });
  assert.equal(before.username, ENABLE_USERNAME);
  const flipped = assertEnabledFlip(demoRow(true), demoRow(false), enabledBody(false));
  assert.equal(flipped.before.id, flipped.after.id);
  assert.equal(flipped.after.enabled, false);
  assert.doesNotThrow(() => assertLoginContrast({ enabledStatus: 201, disabledStatus: 401 }));
  assert.throws(
    () => assertEnabledRow({ ...demoRow(true), passwordHash: 'x' }, { fresh: true, enabled: true }),
    /密码|契约/,
  );
  assert.throws(
    () => assertEnabledFlip(demoRow(true), { ...demoRow(false), id: 'other' }, enabledBody(false)),
    /另建一行/,
  );
  assert.throws(
    () => assertLoginContrast({ enabledStatus: 201, disabledStatus: 200 }),
    /401/,
  );
  assert.throws(
    () => assertLoginContrast({ enabledStatus: 401, disabledStatus: 401 }),
    /应能登录/,
  );
});

test('proof prints the users page, the demo account, and 401', () => {
  const proof = formatUserEnableDisableProof({ webOrigin: 'http://127.0.0.1:43123' });
  assert.match(proof, new RegExp(`超管: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`));
  assert.match(proof, new RegExp(`账号: ${ENABLE_USERNAME} / ${ENABLE_PASSWORD}`));
  assert.match(proof, /启停前: 启用/);
  assert.match(proof, /启停后: 停用/);
  assert.match(proof, /停用后登录: 401/);
  assert.match(proof, /用户页: http:\/\/127\.0\.0\.1:43123\/users/);
  assert.match(proof, /登录: http:\/\/127\.0\.0\.1:43123\/login/);
  assert.match(proof, new RegExp(`启用列: ${ENABLE_USERNAME}`));
  assert.doesNotMatch(proof, /ingest|heartbeat|alerts/i);
});

test('docs name the make target and leave the earlier user demos alone', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_USER_ENABLE_DISABLE.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  for (const text of [doc, caps, status, readme]) {
    assert.match(text, /make demo-user-enable-disable/);
    assert.match(text, /\/users/);
    assert.match(text, new RegExp(ENABLE_USERNAME));
  }
  assert.match(doc, /Admin@123456/);
  assert.match(doc, new RegExp(ENABLE_PASSWORD));
  assert.match(doc, /401/);
  assert.match(doc, /启用/);
  assert.match(doc, /停用/);
  assert.match(doc, /make up && make migrate/);
  assert.match(doc, /make api/);
  assert.match(doc, /make demo-user-mgmt/);
  assert.match(doc, /make demo-user-create-reset/);
  assert.match(doc, /make demo-rbac/);
  assert.match(caps, /DEMO_USER_ENABLE_DISABLE\.md/);
  assert.match(readme, /DEMO_USER_ENABLE_DISABLE\.md/);
  assert.match(makefile, /^demo-user-enable-disable:.*\n\tnode scripts\/demo-user-enable-disable\.mjs\s*$/m);
  assert.match(makefile, /scripts\/demo-user-enable-disable\.spec\.mjs/);
  assert.match(makefile, /^demo-user-mgmt:.*\n\tnode scripts\/demo-user-mgmt\.mjs\s*$/m);
  assert.match(makefile, /^demo-user-create-reset:.*\n\tnode scripts\/demo-user-create-reset\.mjs\s*$/m);
  assert.match(makefile, /^demo-rbac:.*\n\tnode scripts\/demo-rbac\.mjs\s*$/m);
  assert.doesNotMatch(doc, /假定|假设/);
  for (const rel of [
    'scripts/demo-user-mgmt.mjs',
    'scripts/demo-rbac.mjs',
    'scripts/demo-user-create-reset.mjs',
    'docs/DEMO_RBAC.md',
    'docs/DEMO_USER_CREATE_RESET.md',
  ]) {
    const text = readFileSync(join(root, rel), 'utf8');
    assert.doesNotMatch(text, /demo-user-enable-disable|user-enable-demo/);
  }
});

function installFetch({ present = false, enabled = true, passwordOk = true, createStatus = 201 } = {}) {
  const calls = [];
  let row = present ? demoRow(enabled) : null;
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
      if (body.username === ENABLE_USERNAME) {
        assert.equal(body.password, ENABLE_PASSWORD);
        if (!passwordOk || row?.enabled === false) {
          return jsonResponse(401, { message: '用户名或密码错误' });
        }
        return jsonResponse(201, session(ENABLE_USERNAME, ENABLE_ROLE, [ENABLE_SHED]));
      }
      return jsonResponse(401, { message: '用户名或密码错误' });
    }
    if (target.endsWith('/users') && method === 'GET') {
      assert.equal(init?.headers?.authorization, 'Bearer tok-admin');
      return jsonResponse(200, row ? [row] : []);
    }
    if (target.endsWith('/users') && method === 'POST') {
      assert.equal(init?.headers?.authorization, 'Bearer tok-admin');
      assert.deepEqual(body, createBody());
      if (createStatus === 409) return jsonResponse(409, { message: '用户名已存在' });
      row = demoRow(true);
      return jsonResponse(201, {
        id: row.id,
        username: row.username,
        displayName: row.displayName,
        role: row.role,
        shedCodes: row.shedCodes,
      });
    }
    if (method === 'PATCH' && target.endsWith('/users/user-enable')) {
      assert.equal(init?.headers?.authorization, 'Bearer tok-admin');
      assert.deepEqual(body, enabledBody(body.enabled));
      assert.equal(typeof body.enabled, 'boolean');
      if (!row) return jsonResponse(404, { message: '用户不存在' });
      row = { ...row, enabled: body.enabled };
      return jsonResponse(200, row);
    }
    return jsonResponse(500, { message: `未预期的请求 ${target}` });
  };
  return calls;
}

test('http chain creates the demo user, disables it, and gets 401', async () => {
  const original = globalThis.fetch;
  const calls = installFetch();
  try {
    const result = await showUserEnableDisable();
    assert.equal(result.fresh, true);
    assert.equal(result.before.enabled, true);
    assert.equal(result.after.enabled, false);
    assert.equal(result.before.id, result.after.id);
    assert.equal(calls.filter((line) => line.startsWith('POST') && line.endsWith('/users')).length, 1);
    assert.equal(calls.filter((line) => line.startsWith('PATCH')).length, 1);
    assert.equal(calls.filter((line) => line.includes('/auth/login')).length, 3);
    assert.equal(calls.some((line) => /ingest|heartbeat|alerts|audit-logs|login-logs|sheds|viewer/.test(line)), false);
  } finally {
    globalThis.fetch = original;
  }
});

test('an existing enabled user is not recreated, then disable returns 401', async () => {
  const original = globalThis.fetch;
  const calls = installFetch({ present: true, enabled: true });
  try {
    const result = await showUserEnableDisable();
    assert.equal(result.fresh, false);
    assert.equal(result.after.enabled, false);
    assert.equal(calls.filter((line) => line.startsWith('POST') && line.endsWith('/users')).length, 0);
    assert.equal(calls.filter((line) => line.startsWith('PATCH')).length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('an existing disabled user is enabled, checked, then disabled again', async () => {
  const original = globalThis.fetch;
  const calls = installFetch({ present: true, enabled: false });
  try {
    const result = await showUserEnableDisable();
    assert.equal(result.fresh, false);
    assert.equal(result.before.enabled, true);
    assert.equal(result.after.enabled, false);
    assert.equal(calls.filter((line) => line.startsWith('POST') && line.endsWith('/users')).length, 0);
    assert.equal(calls.filter((line) => line.startsWith('PATCH')).length, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test('a wrong password while enabled does not disable the row', async () => {
  const original = globalThis.fetch;
  const calls = installFetch({ present: true, enabled: true, passwordOk: false });
  try {
    await assert.rejects(() => showUserEnableDisable(), /应能登录/);
    assert.equal(calls.filter((line) => line.startsWith('PATCH')).length, 0);
  } finally {
    globalThis.fetch = original;
  }
});
