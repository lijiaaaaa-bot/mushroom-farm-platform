import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { repoRoot } from './lib/ingest-wire.mjs';
import {
  MATCH_CAMERA,
  MATCH_TITLE,
  OTHER_CAMERA,
  OTHER_TITLE,
  TITLE_KEYWORD,
  TITLE_LEVEL,
  TITLE_ROWS,
  TITLE_SHED,
  alertMessage,
  assertBothPresent,
  assertDetail,
  assertOnlyTitle,
  formatTitleProof,
  pickReusable,
  sendTitleSearchDemo,
  titleMatches,
} from './demo-alert-title-search.mjs';

const matchId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const keptId = '33333333-3333-4333-8333-333333333333';

function row(id, cameraCode, title, status = 'open') {
  const spec = TITLE_ROWS.find((item) => item.cameraCode === cameraCode);
  return {
    id,
    shedCode: TITLE_SHED,
    cameraCode,
    level: TITLE_LEVEL,
    status,
    title: title || spec.title,
    message: alertMessage(cameraCode),
    createdAt: '2026-10-14T01:02:03.004Z',
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
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
    if (target.pathname.endsWith('/auth/login')) {
      assert.deepEqual(JSON.parse(init.body), { username: 'admin', password: 'Admin@123456' });
      return jsonResponse(200, { accessToken: 'tok' });
    }
    if (method === 'POST' && target.pathname.endsWith('/alerts')) {
      const body = JSON.parse(init.body);
      assert.equal(body.shedCode, TITLE_SHED);
      assert.equal(body.level, TITLE_LEVEL);
      assert.equal(init.headers.authorization, 'Bearer tok');
      const created = row(
        body.cameraCode === OTHER_CAMERA ? otherId : matchId,
        body.cameraCode,
        body.title,
      );
      created.message = body.message;
      state.alerts.push(created);
      state.created.push(body);
      return jsonResponse(201, created);
    }
    if (method === 'GET' && /\/alerts\/[^/]+$/.test(target.pathname)) {
      const id = decodeURIComponent(target.pathname.split('/').pop());
      const found = state.alerts.find((item) => item.id === id);
      if (!found) return jsonResponse(404, { message: '告警不存在' });
      return jsonResponse(200, found);
    }
    if (method === 'GET' && target.pathname.endsWith('/alerts')) {
      const keyword = (target.searchParams.get('q') || '').trim().toLowerCase();
      const shed = target.searchParams.get('shedCode');
      let items = state.alerts;
      if (shed) items = items.filter((item) => item.shedCode === shed);
      if (keyword) items = items.filter((item) => titleMatches(item.title, keyword));
      return jsonResponse(200, { items, total: items.length, page: 1, pageSize: 100 });
    }
    return jsonResponse(404, { message: `未模拟 ${method} ${target.pathname}` });
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

test('two titles stay distinct when one keyword is searched', () => {
  const match = row(matchId, MATCH_CAMERA);
  const other = row(otherId, OTHER_CAMERA);
  assert.equal(titleMatches(MATCH_TITLE, ` ${TITLE_KEYWORD} `), true);
  assert.equal(titleMatches(OTHER_TITLE, TITLE_KEYWORD), false);
  assert.equal(titleMatches('正文里有东侧标题', TITLE_KEYWORD), true);
  assert.equal(pickReusable([match, { ...other, status: 'closed' }], OTHER_TITLE), null);
  assert.equal(pickReusable([other, match], MATCH_TITLE)?.id, matchId);
  assert.equal(pickReusable([other], OTHER_TITLE)?.id, otherId);
  assert.doesNotThrow(() => assertOnlyTitle([match], TITLE_KEYWORD, matchId, otherId));
  assert.throws(() => assertOnlyTitle([match, other], TITLE_KEYWORD, matchId, otherId), /另一条/);
  assert.throws(
    () => assertOnlyTitle([match, { ...match, id: '44444444-4444-4444-8444-444444444444', title: '别的告警' }], TITLE_KEYWORD, matchId),
    /不匹配标题/,
  );
  assert.throws(() => assertOnlyTitle([other], TITLE_KEYWORD, matchId, otherId), /没有告警/);
  assert.doesNotThrow(() =>
    assertBothPresent([match, other, row(keptId, 'CAM-ALERT-01', '温度过高告警')], [matchId, otherId]),
  );
  assert.throws(() => assertBothPresent([match], [matchId, otherId]), /缺少/);
  assertDetail(match, { id: matchId, cameraCode: MATCH_CAMERA, title: MATCH_TITLE });
});

test('proof names both titles and the searched list', () => {
  const proof = formatTitleProof({
    seeded: [
      { cameraCode: MATCH_CAMERA, title: MATCH_TITLE, id: matchId, created: true },
      { cameraCode: OTHER_CAMERA, title: OTHER_TITLE, id: otherId, created: false },
    ],
    filteredCount: 1,
    detail: row(matchId, MATCH_CAMERA),
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /留下 2 条告警/);
  assert.match(proof, new RegExp(`东侧标题搜索告警: 新建 ${matchId}`));
  assert.match(proof, new RegExp(`西侧过道对照告警: 沿用 ${otherId}`));
  assert.match(proof, /搜索关键词: 东侧标题/);
  assert.match(proof, /搜索后条数: 1/);
  assert.match(proof, /搜索后不匹配标题: 无/);
  assert.match(proof, /详情可打开: 是/);
  assert.match(proof, /详情标题: 东侧标题搜索告警/);
  assert.match(proof, /不带关键词仍含这两条: 是/);
  assert.match(proof, /空白关键词仍含这两条: 是/);
  assert.match(proof, /告警列表: http:\/\/127\.0\.0\.1:43123\/alerts$/m);
  assert.match(
    proof,
    /按标题搜索: http:\/\/127\.0\.0\.1:43123\/alerts\?q=%E4%B8%9C%E4%BE%A7%E6%A0%87%E9%A2%98/,
  );
  assert.match(
    proof,
    new RegExp(
      `告警详情: http://127\\.0\\.0\\.1:43123/alerts/${matchId}\\?q=%E4%B8%9C%E4%BE%A7%E6%A0%87%E9%A2%98`,
    ),
  );
});

test('the command leaves two titles and the keyword hides the other one', async () => {
  const state = {
    alerts: [row(keptId, 'CAM-ALERT-01', '温度过高告警', 'open')],
    created: [],
  };
  state.alerts[0].level = 'severe';
  state.alerts[0].title = '温度过高告警';
  const installed = installFetch(state);
  try {
    const result = await sendTitleSearchDemo();
    assert.deepEqual(
      result.seeded.map((item) => item.title),
      [MATCH_TITLE, OTHER_TITLE],
    );
    assert.equal(result.seeded.every((item) => item.created), true);
    assert.equal(result.detail.id, matchId);
    assert.equal(result.detail.title, MATCH_TITLE);
    assert.equal(result.filteredCount, 1);
    assert.equal(state.created.length, 2);
    assert.deepEqual(
      state.created.map((body) => body.title),
      [MATCH_TITLE, OTHER_TITLE],
    );
    assert.equal(state.alerts.find((item) => item.id === keptId).status, 'open');
    assert.equal(
      installed.calls.filter((line) => line.includes('/close') || line.includes('/ack')).length,
      0,
    );
    assert.match(formatTitleProof(result), /搜索后不匹配标题: 无/);
  } finally {
    installed.restore();
  }
});

test('an existing open alert for the same camera and title is reused', async () => {
  const state = {
    alerts: [
      row(matchId, MATCH_CAMERA),
      { ...row(otherId, OTHER_CAMERA), status: 'acked' },
      row(keptId, 'CAM-THRESH-01', 'CO₂过高告警'),
    ],
    created: [],
  };
  const installed = installFetch(state);
  try {
    const result = await sendTitleSearchDemo();
    assert.equal(result.seeded.every((item) => item.created), false);
    assert.deepEqual(
      result.seeded.map((item) => item.id),
      [matchId, otherId],
    );
    assert.equal(state.created.length, 0);
    assert.equal(result.filteredCount, 1);
    assert.equal(state.alerts.find((item) => item.id === keptId).title, 'CO₂过高告警');
    assert.equal(
      installed.calls.filter((line) => line.startsWith('POST ') && line.includes('/alerts')).length,
      0,
    );
    assert.ok(
      installed.calls.some((line) =>
        /q=(?:%20|\+)%E4%B8%9C%E4%BE%A7%E6%A0%87%E9%A2%98(?:%20|\+)/.test(line),
      ),
    );
    assert.ok(installed.calls.some((line) => /[?&]q=(?:%20|\+){3}(?:&|$)/.test(line)));
  } finally {
    installed.restore();
  }
});

test('the written steps name the make target and leave the earlier demos alone', () => {
  const root = repoRoot();
  const doc = readFileSync(join(root, 'docs/DEMO_ALERT_TITLE_SEARCH.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  const one = readFileSync(join(root, 'docs/DEMO_ONE_INGEST.md'), 'utf8');
  const registerDoc = readFileSync(join(root, 'docs/DEMO_REGISTER_AND_INGEST.md'), 'utf8');
  const heartbeatDoc = readFileSync(join(root, 'docs/DEMO_REGISTER_AND_HEARTBEAT.md'), 'utf8');
  const alertDoc = readFileSync(join(root, 'docs/DEMO_ONE_ALERT.md'), 'utf8');
  const ackDoc = readFileSync(join(root, 'docs/DEMO_ACK_CLOSE_ALERT.md'), 'utf8');
  const thresholdDoc = readFileSync(join(root, 'docs/DEMO_THRESHOLD_ALERT.md'), 'utf8');
  const cameraDoc = readFileSync(join(root, 'docs/DEMO_ALERT_CAMERA_FILTER.md'), 'utf8');
  const statusDoc = readFileSync(join(root, 'docs/DEMO_ALERT_STATUS_FILTER.md'), 'utf8');
  const alertScript = readFileSync(join(root, 'scripts/demo-one-alert.mjs'), 'utf8');
  const ackScript = readFileSync(join(root, 'scripts/demo-ack-close-alert.mjs'), 'utf8');
  const thresholdScript = readFileSync(join(root, 'scripts/demo-threshold-alert.mjs'), 'utf8');
  const cameraScript = readFileSync(join(root, 'scripts/demo-alert-camera-filter.mjs'), 'utf8');
  const statusScript = readFileSync(join(root, 'scripts/demo-alert-status-filter.mjs'), 'utf8');
  assert.match(doc, /make demo-alert-title-search/);
  assert.match(doc, /admin/);
  assert.match(doc, /Admin@123456/);
  assert.match(doc, /东侧标题搜索告警/);
  assert.match(doc, /西侧过道对照告警/);
  assert.match(doc, /CAM-TITLE-01/);
  assert.match(doc, /CAM-TITLE-02/);
  assert.match(doc, /搜索/);
  assert.match(doc, /清除搜索/);
  assert.match(doc, /\/alerts/);
  assert.match(doc, /q=东侧标题/);
  assert.match(caps, /make demo-alert-title-search/);
  assert.match(caps, /DEMO_ALERT_TITLE_SEARCH\.md/);
  assert.match(status, /make demo-alert-title-search/);
  assert.match(readme, /DEMO_ALERT_TITLE_SEARCH\.md/);
  assert.doesNotMatch(one, /demo-alert-title-search|CAM-TITLE-0/);
  assert.doesNotMatch(registerDoc, /demo-alert-title-search|CAM-TITLE-0/);
  assert.doesNotMatch(heartbeatDoc, /demo-alert-title-search|CAM-TITLE-0/);
  assert.doesNotMatch(alertDoc, /demo-alert-title-search|CAM-TITLE-0/);
  assert.doesNotMatch(ackDoc, /demo-alert-title-search|CAM-TITLE-0/);
  assert.doesNotMatch(thresholdDoc, /demo-alert-title-search|CAM-TITLE-0/);
  assert.doesNotMatch(cameraDoc, /demo-alert-title-search|CAM-TITLE-0/);
  assert.doesNotMatch(statusDoc, /demo-alert-title-search|CAM-TITLE-0/);
  assert.doesNotMatch(alertScript, /CAM-TITLE-0/);
  assert.doesNotMatch(ackScript, /CAM-TITLE-0|demo-alert-title-search/);
  assert.doesNotMatch(thresholdScript, /CAM-TITLE-0/);
  assert.doesNotMatch(cameraScript, /CAM-TITLE-0|demo-alert-title-search/);
  assert.doesNotMatch(statusScript, /CAM-TITLE-0|demo-alert-title-search/);
  assert.match(makefile, /^demo-one-alert:.*\n\tnode scripts\/demo-one-alert\.mjs\s*$/m);
  assert.match(
    makefile,
    /^demo-alert-camera-filter:.*\n\tnode scripts\/demo-alert-camera-filter\.mjs\s*$/m,
  );
  assert.match(
    makefile,
    /^demo-alert-status-filter:.*\n\tnode scripts\/demo-alert-status-filter\.mjs\s*$/m,
  );
  assert.match(
    makefile,
    /^demo-alert-title-search:.*\n\tnode scripts\/demo-alert-title-search\.mjs\s*$/m,
  );
  assert.match(makefile, /scripts\/demo-alert-title-search\.spec\.mjs/);
  const added = readme.split('\n').filter((line) => line.includes('DEMO_ALERT_TITLE_SEARCH.md'));
  assert.equal(added.length, 1);
});
