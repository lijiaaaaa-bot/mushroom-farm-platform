import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { ADMIN_PASSWORD, ADMIN_USERNAME, VIEWER_PASSWORD, VIEWER_USERNAME } from './demo-rbac.mjs';
import { repoRoot } from './lib/ingest-wire.mjs';
import {
  assertParamsAdvanced,
  assertParamsNav,
  assertParamsPage,
  formatParamsProof,
  nextUnreadPollSeconds,
  showSysParams,
} from './demo-sys-params.mjs';

function params(poll, overrides = {}) {
  return {
    imageRetentionDays: 30,
    timeseriesRetentionDays: 90,
    alertUnreadPollSeconds: poll,
    updatedAt: poll === 15 ? null : '2026-10-15T03:00:00.000Z',
    updatedBy: poll === 15 ? null : 'admin',
    ...overrides,
  };
}

function patched(beforePoll, afterPoll) {
  const unit = (value) => `${value} 秒`;
  return {
    ...params(afterPoll),
    updatedAt: '2026-10-15T03:04:00.000Z',
    updatedBy: 'admin',
    changes: [
      {
        key: 'alertUnreadPollSeconds',
        label: '告警未读轮询',
        beforeText: unit(beforePoll),
        afterText: unit(afterPoll),
      },
    ],
  };
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

test('page and nav show system params only to super admin', () => {
  assert.equal(nextUnreadPollSeconds(15), 45);
  assert.equal(nextUnreadPollSeconds(45), 15);
  assert.doesNotThrow(() => assertParamsPage());
  assert.doesNotThrow(() => assertParamsNav());
  assert.throws(() => assertParamsPage('<div>系统参数</div>'), /当前值/);
  assert.throws(
    () => assertParamsNav('[{"to":"/system-params","label":"系统参数","roles":["viewer"]}]'),
    /只给超管/,
  );
});

test('a poll change keeps retention days and prints an arrow', () => {
  const first = assertParamsAdvanced(params(15), patched(15, 45));
  assert.equal(first.before.alertUnreadPollSeconds, 15);
  assert.equal(first.after.alertUnreadPollSeconds, 45);
  assert.equal(first.line, '告警未读轮询：15 秒 → 45 秒');
  const back = assertParamsAdvanced(params(45), patched(45, 15));
  assert.equal(back.line, '告警未读轮询：45 秒 → 15 秒');
  assert.throws(() => assertParamsAdvanced(params(15), patched(15, 15)), /应为 45/);
  assert.throws(
    () =>
      assertParamsAdvanced(params(15), {
        ...patched(15, 45),
        imageRetentionDays: 7,
      }),
    /图片保留/,
  );
});

test('proof prints the before and after poll and the params page', () => {
  const advanced = assertParamsAdvanced(params(15), patched(15, 45));
  const proof = formatParamsProof({
    ...advanced,
    viewerStatus: 403,
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, new RegExp(`超管: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`));
  assert.match(proof, /图片保留: 30 天/);
  assert.match(proof, /时序保留: 90 天/);
  assert.match(proof, /告警未读轮询：15 秒 → 45 秒/);
  assert.match(proof, /修改人: admin/);
  assert.match(proof, /查看接口: 403/);
  assert.match(proof, /系统参数页: http:\/\/127\.0\.0\.1:43123\/system-params/);
  assert.match(proof, /登录: http:\/\/127\.0\.0\.1:43123\/login/);
  assert.doesNotMatch(proof, /ingest|heartbeat|passwordHash/i);
});

test('docs name the make target and leave ingest observability alone', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_SYS_PARAMS.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  const ops = readFileSync(join(root, 'docs/OPS_STORAGE_BACKUP.md'), 'utf8');
  for (const text of [doc, caps, status, readme]) {
    assert.match(text, /make demo-sys-params/);
    assert.match(text, /\/system-params/);
  }
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /Viewer@123456/);
  assert.match(doc, /15 秒 → 45 秒/);
  assert.match(doc, /403/);
  assert.match(doc, /make up && make migrate/);
  assert.match(doc, /make api/);
  assert.match(doc, /make web/);
  assert.match(ops, /\/system-params/);
  assert.match(ops, /system_params/);
  assert.match(caps, /DEMO_SYS_PARAMS\.md/);
  assert.match(readme, /DEMO_SYS_PARAMS\.md/);
  assert.match(makefile, /^demo-sys-params:.*\n\tnode scripts\/demo-sys-params\.mjs\s*$/m);
  assert.match(makefile, /scripts\/demo-sys-params\.spec\.mjs/);
  assert.doesNotMatch(doc, /假定|假设/);
  const ingest = readFileSync(join(root, 'apps/web/src/views/IngestObservabilityView.vue'), 'utf8');
  assert.doesNotMatch(ingest, /system-params|系统参数|demo-sys-params/);
  const retention = readFileSync(join(root, 'apps/api/src/maintenance/retention.service.ts'), 'utf8');
  assert.match(retention, /imageRetentionDays/);
  assert.match(retention, /timeseriesRetentionDays/);
});

test('http chain changes the poll and leaves the viewer at 403', async () => {
  const original = globalThis.fetch;
  let current = params(15);
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    const method = init?.method || 'GET';
    const body = init?.body ? JSON.parse(init.body) : undefined;
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
    if (target.endsWith('/system-params') && method === 'GET') {
      if (token === 'Bearer tok-viewer') return jsonResponse(403, { message: '当前角色无权执行此操作' });
      assert.equal(token, 'Bearer tok-admin');
      return jsonResponse(200, current);
    }
    if (target.endsWith('/system-params') && method === 'PATCH') {
      if (token === 'Bearer tok-viewer') return jsonResponse(403, { message: '当前角色无权执行此操作' });
      assert.equal(token, 'Bearer tok-admin');
      assert.deepEqual(body, { alertUnreadPollSeconds: 45 });
      current = params(45);
      return jsonResponse(200, patched(15, 45));
    }
    return jsonResponse(404, { message: target });
  };
  try {
    const result = await showSysParams();
    assert.equal(result.line, '告警未读轮询：15 秒 → 45 秒');
    assert.equal(result.viewerStatus, 403);
    assert.equal(current.alertUnreadPollSeconds, 45);
    assert.equal(current.imageRetentionDays, 30);
  } finally {
    globalThis.fetch = original;
  }
});
