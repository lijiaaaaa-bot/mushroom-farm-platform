import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { ADMIN_PASSWORD, ADMIN_USERNAME, VIEWER_PASSWORD, VIEWER_USERNAME } from './demo-rbac.mjs';
import { repoRoot } from './lib/ingest-wire.mjs';
import {
  assertBackupAdvanced,
  assertBackupNav,
  assertBackupPage,
  formatBackupRunProof,
  showBackupRun,
} from './demo-backup-run.mjs';

const BEFORE = '2026-10-15T02:00:00.000Z';
const AFTER = '2026-10-15T03:00:00.000Z';

function status(overrides = {}) {
  return {
    lastSuccessAt: null,
    lastRunAt: null,
    lastStatus: 'never',
    lastFileName: null,
    lastBytes: null,
    lastError: null,
    triggeredBy: null,
    ...overrides,
  };
}

function successAt(when) {
  return status({
    lastSuccessAt: when,
    lastRunAt: when,
    lastStatus: 'success',
    lastFileName: 'mushroom-20261015T030000Z.sql',
    lastBytes: 128,
    lastError: null,
    triggeredBy: 'admin',
  });
}

function jsonResponse(code, body) {
  return {
    ok: code >= 200 && code < 300,
    status: code,
    async json() {
      return body;
    },
  };
}

function session(username, role) {
  return {
    accessToken: `tok-${username}`,
    user: {
      id: `id-${username}`,
      username,
      displayName: username,
      role,
      shedCodes: role === 'super_admin' ? [] : ['S01'],
    },
  };
}

test('page and nav show the success time only to super admin', () => {
  assert.doesNotThrow(() => assertBackupPage());
  assert.doesNotThrow(() => assertBackupNav());
  assert.throws(() => assertBackupPage('<div>数据备份</div>'), /尚未成功备份/);
  assert.throws(
    () => assertBackupNav('[{"to":"/backup","label":"数据备份","roles":["viewer"]}]'),
    /只给超管/,
  );
});

test('a later success time replaces an empty or older one', () => {
  const first = assertBackupAdvanced(status(), successAt(AFTER));
  assert.equal(first.before.lastSuccessAt, null);
  assert.equal(first.after.lastSuccessAt, AFTER);
  const again = assertBackupAdvanced(successAt(BEFORE), successAt(AFTER));
  assert.equal(again.before.lastSuccessAt, BEFORE);
  assert.equal(again.after.lastSuccessAt, AFTER);
  assert.throws(() => assertBackupAdvanced(successAt(AFTER), successAt(AFTER)), /没有更新/);
  assert.throws(
    () =>
      assertBackupAdvanced(
        status(),
        status({
          lastSuccessAt: null,
          lastRunAt: AFTER,
          lastStatus: 'failed',
          lastError: '找不到 pg_dump 或 docker。',
          triggeredBy: 'admin',
        }),
      ),
    /成功/,
  );
  assert.throws(
    () =>
      assertBackupAdvanced(status(), {
        ...successAt(AFTER),
        lastError: 'postgres://mushroom:secret@127.0.0.1/mushroom',
      }),
    /连接串|密码/,
  );
});

test('proof prints the before and after times and the backup page', () => {
  const proof = formatBackupRunProof({
    before: status(),
    after: successAt(AFTER),
    viewerStatus: 403,
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, new RegExp(`超管: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`));
  assert.match(proof, /最近成功（前）: 尚未成功备份/);
  assert.match(proof, new RegExp(`最近成功（后）: ${AFTER}`));
  assert.match(proof, /最近一次: 成功/);
  assert.match(proof, /文件: mushroom-20261015T030000Z\.sql/);
  assert.match(proof, /触发人: admin/);
  assert.match(proof, /查看接口: 403/);
  assert.match(proof, /备份页: http:\/\/127\.0\.0\.1:43123\/backup/);
  assert.match(proof, /登录: http:\/\/127\.0\.0\.1:43123\/login/);
  assert.doesNotMatch(proof, /ingest|heartbeat|passwordHash/i);
});

test('docs name the make target and leave ingest observability alone', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_BACKUP_RUN.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  const ops = readFileSync(join(root, 'docs/OPS_STORAGE_BACKUP.md'), 'utf8');
  for (const text of [doc, caps, status, readme]) {
    assert.match(text, /make demo-backup-run/);
    assert.match(text, /\/backup/);
  }
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /Viewer@123456/);
  assert.match(doc, /尚未成功备份/);
  assert.match(doc, /本次备份成功/);
  assert.match(doc, /403/);
  assert.match(doc, /make up && make migrate/);
  assert.match(doc, /make api/);
  assert.match(doc, /make web/);
  assert.match(ops, /\/backup/);
  assert.match(ops, /postgres_backup_runs/);
  assert.match(caps, /DEMO_BACKUP_RUN\.md/);
  assert.match(readme, /DEMO_BACKUP_RUN\.md/);
  assert.match(makefile, /^demo-backup-run:.*\n\tnode scripts\/demo-backup-run\.mjs\s*$/m);
  assert.match(makefile, /scripts\/demo-backup-run\.spec\.mjs/);
  assert.match(makefile, /^backup:\n\tnode scripts\/backup-postgres\.mjs\s*$/m);
  assert.doesNotMatch(doc, /假定|假设/);
  const ingest = readFileSync(join(root, 'apps/web/src/views/IngestObservabilityView.vue'), 'utf8');
  assert.doesNotMatch(ingest, /\/backups|数据备份|demo-backup-run/);
});

test('http chain moves the success time and leaves the viewer at 403', async () => {
  const original = globalThis.fetch;
  const calls = [];
  let current = status();
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    const method = init?.method || 'GET';
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push(`${method} ${target}`);
    if (target.endsWith('/auth/login')) {
      if (body.username === ADMIN_USERNAME && body.password === ADMIN_PASSWORD) {
        return jsonResponse(201, session(ADMIN_USERNAME, 'super_admin'));
      }
      if (body.username === VIEWER_USERNAME && body.password === VIEWER_PASSWORD) {
        return jsonResponse(201, session(VIEWER_USERNAME, 'viewer'));
      }
      return jsonResponse(401, { message: '用户名或密码错误' });
    }
    const token = init?.headers?.authorization;
    if (target.endsWith('/backups/status') && method === 'GET') {
      if (token === 'Bearer tok-viewer') return jsonResponse(403, { message: '当前角色无权执行此操作' });
      assert.equal(token, 'Bearer tok-admin');
      return jsonResponse(200, current);
    }
    if (target.endsWith('/backups/run') && method === 'POST') {
      if (token === 'Bearer tok-viewer') return jsonResponse(403, { message: '当前角色无权执行此操作' });
      assert.equal(token, 'Bearer tok-admin');
      current = successAt(AFTER);
      return jsonResponse(201, current);
    }
    return jsonResponse(500, { message: `未预期的请求 ${target}` });
  };
  try {
    const result = await showBackupRun();
    assert.equal(result.before.lastSuccessAt, null);
    assert.equal(result.after.lastSuccessAt, AFTER);
    assert.equal(result.after.lastStatus, 'success');
    assert.equal(result.viewerStatus, 403);
    assert.equal(calls.filter((line) => line.endsWith('/backups/run') && line.startsWith('POST')).length, 2);
    assert.equal(calls.some((line) => /ingest|heartbeat|alerts|users/.test(line)), false);
  } finally {
    globalThis.fetch = original;
  }
});
