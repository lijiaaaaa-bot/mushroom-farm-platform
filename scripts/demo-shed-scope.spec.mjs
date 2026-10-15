import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { repoRoot } from './lib/ingest-wire.mjs';
import { ADMIN_PASSWORD, ADMIN_USERNAME } from './demo-rbac.mjs';
import {
  ASSIGNED_CAMERA,
  ASSIGNED_SHED,
  ASSIGNED_TITLE,
  OTHER_CAMERA,
  OTHER_SHED,
  OTHER_TITLE,
  SHEDLEAD_PASSWORD,
  SHEDLEAD_USERNAME,
  assertScopePages,
  assertShedScopeContrast,
  ensureScopeAlert,
  ensureShedlead,
  formatShedScopeProof,
  scopeAlertBody,
  shedleadBody,
  showShedScope,
} from './demo-shed-scope.mjs';

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

function contrast(overrides = {}) {
  return {
    adminSession: session(ADMIN_USERNAME, 'super_admin', []),
    leadSession: session(SHEDLEAD_USERNAME, 'shed_manager', [ASSIGNED_SHED]),
    sheds: {
      adminBody: [{ code: 'S01' }, { code: 'S02' }, { code: 'S03' }],
      leadBody: [{ code: 'S01' }],
    },
    overviews: {
      adminBody: {
        shedCount: 3,
        recentAlerts: [{ shedCode: 'S02', title: OTHER_TITLE }],
      },
      leadBody: {
        shedCount: 1,
        recentAlerts: [{ shedCode: 'S01', title: ASSIGNED_TITLE }],
      },
    },
    alerts: {
      adminBody: {
        items: [
          { title: OTHER_TITLE, shedCode: 'S02', cameraCode: OTHER_CAMERA },
          { title: ASSIGNED_TITLE, shedCode: 'S01', cameraCode: ASSIGNED_CAMERA },
        ],
        total: 2,
      },
      leadBody: {
        items: [{ title: ASSIGNED_TITLE, shedCode: 'S01', cameraCode: ASSIGNED_CAMERA }],
        total: 1,
      },
      adminOtherBody: {
        items: [{ title: OTHER_TITLE, shedCode: 'S02', cameraCode: OTHER_CAMERA }],
        total: 1,
      },
      leadOtherBody: { items: [], total: 0 },
    },
    ...overrides,
  };
}

test('shedlead body stays on S01 and the two alerts name their sheds', () => {
  assert.deepEqual(shedleadBody(), {
    username: 'shedlead',
    password: 'Shed@123456',
    displayName: '一号棚负责人',
    role: 'shed_manager',
    shedCodes: ['S01'],
    resetPassword: true,
  });
  const now = new Date('2026-10-15T04:16:00.000Z');
  assert.deepEqual(scopeAlertBody('S01', now), {
    shedCode: 'S01',
    cameraCode: 'CAM-SCOPE-S01',
    level: 'warning',
    title: '棚范围一号棚',
    message: '棚区 S01 负责人可见',
    createdAt: '2026-10-15T04:16:00.000Z',
  });
  assert.equal(scopeAlertBody('S02', now).shedCode, 'S02');
  assert.equal(scopeAlertBody('S02', now).title, '棚范围二号棚');
  assert.throws(() => scopeAlertBody('S03', now), /S01/);
});

test('contrast accepts admin on two sheds and shedlead on S01 only', () => {
  const result = assertShedScopeContrast(contrast());
  assert.deepEqual(result.leadCodes, ['S01']);
  assert.equal(result.adminCodes.includes('S02'), true);
  assert.equal(result.adminCount, 3);
  assert.equal(result.leadCount, 1);
});

test('contrast rejects a shedlead who can see S02', () => {
  assert.throws(
    () =>
      assertShedScopeContrast(
        contrast({
          sheds: {
            adminBody: [{ code: 'S01' }, { code: 'S02' }],
            leadBody: [{ code: 'S01' }, { code: 'S02' }],
          },
        }),
      ),
    /只有 S01/,
  );
  assert.throws(
    () =>
      assertShedScopeContrast(
        contrast({
          alerts: {
            ...contrast().alerts,
            leadBody: {
              items: [{ title: OTHER_TITLE, shedCode: 'S02' }],
              total: 1,
            },
          },
        }),
      ),
    /含 S02/,
  );
  assert.throws(
    () =>
      assertShedScopeContrast(
        contrast({
          alerts: {
            ...contrast().alerts,
            leadOtherBody: { items: [{ title: OTHER_TITLE, shedCode: 'S02' }], total: 1 },
          },
        }),
      ),
    /应为空/,
  );
  assert.throws(
    () =>
      assertShedScopeContrast(
        contrast({
          overviews: {
            adminBody: { shedCount: 3, recentAlerts: [] },
            leadBody: { shedCount: 3, recentAlerts: [] },
          },
        }),
      ),
    /棚数应为 1/,
  );
  assert.throws(
    () =>
      assertShedScopeContrast(
        contrast({
          overviews: {
            adminBody: { shedCount: 1, recentAlerts: [] },
            leadBody: { shedCount: 1, recentAlerts: [] },
          },
        }),
      ),
    /至少为 2/,
  );
  assert.throws(
    () =>
      assertShedScopeContrast(
        contrast({
          overviews: {
            ...contrast().overviews,
            leadBody: {
              shedCount: 1,
              recentAlerts: [{ shedCode: 'S02', title: OTHER_TITLE }],
            },
          },
        }),
      ),
    /最近告警含 S02/,
  );
});

test('proof names both logins and the three screenshot routes', () => {
  const proof = formatShedScopeProof({
    ...assertShedScopeContrast(contrast()),
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, new RegExp(`超管: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`));
  assert.match(proof, new RegExp(`棚区负责人: ${SHEDLEAD_USERNAME} / ${SHEDLEAD_PASSWORD}`));
  assert.match(proof, /登录: http:\/\/127\.0\.0\.1:43123\/login/);
  assert.match(proof, /棚列表: 超管 S01、S02、S03；负责人 S01/);
  assert.match(proof, /总览棚数: 超管 3；负责人 1/);
  assert.match(proof, /棚区页: http:\/\/127\.0\.0\.1:43123\/sheds/);
  assert.match(proof, /值班看板: http:\/\/127\.0\.0\.1:43123\/duty-screen/);
  assert.match(proof, /基地大屏: http:\/\/127\.0\.0\.1:43123\/big-screen/);
  assert.match(proof, /告警页: http:\/\/127\.0\.0\.1:43123\/alerts/);
  assert.match(proof, /二号棚搜索: http:\/\/127\.0\.0\.1:43123\/alerts\?q=/);
  assert.doesNotMatch(proof, /ingest|heartbeat/);
});

test('pages keep shed codes on the shed list, duty board, alerts, and big screen', () => {
  assert.doesNotThrow(() => assertScopePages());
  assert.throws(() => assertScopePages({ duty: '<div>无编号</div>', sheds: '编号 row.code', alerts: '棚区 row.shedCode', screen: "point.shed.code http.get<ShedRow[]>('/sheds')" }), /值班看板/);
});

test('docs name the same two accounts and the three pages', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_SHED_SCOPE.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  for (const text of [doc, caps]) {
    assert.match(text, /make demo-shed-scope/);
    assert.match(text, /shedlead/);
    assert.match(text, /Shed@123456/);
    assert.match(text, /\/sheds/);
    assert.match(text, /\/duty-screen/);
    assert.match(text, /\/alerts/);
  }
  assert.match(doc, /棚范围二号棚/);
  assert.match(doc, /S01/);
  assert.match(doc, /S02/);
  assert.match(readme, /DEMO_SHED_SCOPE\.md/);
  assert.match(readme, /make demo-shed-scope/);
  assert.doesNotMatch(doc, /假定|假设/);
  assert.doesNotMatch(doc, /ingest\/observability|接入观测页/);
});

test('http chain resets shedlead, writes both alerts, and skips ingest', async () => {
  const original = globalThis.fetch;
  const calls = [];
  const stored = [];
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
      assert.equal(body.username, SHEDLEAD_USERNAME);
      assert.equal(body.password, SHEDLEAD_PASSWORD);
      return jsonResponse(201, session(SHEDLEAD_USERNAME, 'shed_manager', [ASSIGNED_SHED]));
    }
    if (target.endsWith('/users') && method === 'POST') {
      assert.equal(token, 'Bearer tok-admin');
      assert.deepEqual(JSON.parse(init.body), shedleadBody());
      return jsonResponse(201, {
        id: 'user-shedlead',
        username: SHEDLEAD_USERNAME,
        displayName: '一号棚负责人',
        role: 'shed_manager',
        shedCodes: [ASSIGNED_SHED],
      });
    }
    if (target.includes('/alerts') && method === 'POST') {
      const body = JSON.parse(init.body);
      stored.push(body);
      return jsonResponse(201, { id: `alert-${body.shedCode}`, ...body, status: 'open' });
    }
    if (target.includes('/alerts') && method === 'GET') {
      const parsed = new URL(target);
      const q = parsed.searchParams.get('q');
      const visible = stored.filter((row) => {
        if (token === 'Bearer tok-shedlead' && row.shedCode !== ASSIGNED_SHED) return false;
        if (q && !row.title.includes(q)) return false;
        return true;
      });
      return jsonResponse(200, { items: visible, total: visible.length, page: 1, pageSize: 100 });
    }
    if (target.endsWith('/sheds')) {
      if (token === 'Bearer tok-admin') {
        return jsonResponse(200, [{ code: 'S01', name: '一号菇棚' }, { code: 'S02', name: '二号菇棚' }, { code: 'S03', name: '育菇棚' }]);
      }
      return jsonResponse(200, [{ code: 'S01', name: '一号菇棚' }]);
    }
    if (target.endsWith('/dashboard/overview')) {
      if (token === 'Bearer tok-admin') {
        return jsonResponse(200, {
          shedCount: 3,
          recentAlerts: stored.filter((row) => row.shedCode === 'S02'),
        });
      }
      return jsonResponse(200, {
        shedCount: 1,
        recentAlerts: stored.filter((row) => row.shedCode === 'S01'),
      });
    }
    return jsonResponse(500, { message: `未预期的请求 ${target}` });
  };
  try {
    const result = await showShedScope(new Date('2026-10-15T04:16:00.000Z'));
    assert.deepEqual(result.leadCodes, ['S01']);
    assert.equal(result.adminCodes.includes('S02'), true);
    assert.equal(result.assignedAction, '新建');
    assert.equal(result.otherAction, '新建');
    assert.equal(calls.some((line) => line.includes('/ingest')), false);
    assert.equal(calls.some((line) => line.includes('/heartbeat')), false);
    assert.equal(stored.map((row) => row.shedCode).join(','), 'S01,S02');
  } finally {
    globalThis.fetch = original;
  }
});

test('ensureShedlead rejects a write that keeps S02', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    jsonResponse(201, { username: 'shedlead', role: 'shed_manager', shedCodes: ['S01', 'S02'] });
  try {
    await assert.rejects(() => ensureShedlead('tok-admin'), /棚号/);
  } finally {
    globalThis.fetch = original;
  }
});

test('ensureScopeAlert reports reuse when the same camera title already exists', async () => {
  const original = globalThis.fetch;
  const body = scopeAlertBody('S02', new Date('2026-10-15T04:16:00.000Z'));
  globalThis.fetch = async (url, init) => {
    const method = init?.method || 'GET';
    if (method === 'GET') {
      return jsonResponse(200, { items: [{ ...body, id: 'old' }], total: 1 });
    }
    return jsonResponse(201, { id: 'old', ...body, status: 'open' });
  };
  try {
    const result = await ensureScopeAlert('tok-admin', body);
    assert.equal(result.action, '沿用');
    assert.equal(result.alert.shedCode, 'S02');
  } finally {
    globalThis.fetch = original;
  }
});
