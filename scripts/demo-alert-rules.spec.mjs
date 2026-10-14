import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { repoRoot } from './lib/ingest-wire.mjs';
import {
  RULE_LEVEL,
  RULE_METRIC,
  RULE_NAME,
  RULE_SHED,
  RULE_THRESHOLD,
  RULE_WINDOW,
  SEED_RULE_NAME,
  SEED_THRESHOLD,
  assertDetailMatches,
  assertRuleFields,
  assertSeedUntouched,
  formatAlertRulesProof,
  ruleBody,
  ruleDetailUrl,
  rulesListUrl,
  sendAlertRulesDemo,
} from './demo-alert-rules.mjs';

const id = '88888888-8888-4888-8888-888888888888';
const seedId = 'seed-temp';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

function seedRule(overrides = {}) {
  return {
    id: seedId,
    name: SEED_RULE_NAME,
    metric: 'temperature_high',
    threshold: SEED_THRESHOLD,
    level: 'severe',
    shedCode: null,
    enabled: true,
    windowMinutes: 720,
    ...overrides,
  };
}

function demoRule(overrides = {}) {
  return {
    id,
    ...ruleBody(),
    enabled: true,
    ...overrides,
  };
}

test('proof prints the list and the detail for the seeded rule', () => {
  const rule = demoRule();
  assertSeedUntouched(seedRule());
  assertRuleFields(rule);
  assertDetailMatches(rule, rule);
  assert.throws(() => assertSeedUntouched(seedRule({ threshold: 24 })), /不改它/);
  assert.throws(() => assertRuleFields(demoRule({ shedCode: 'S03' })), /棚区/);
  assert.throws(() => assertDetailMatches(demoRule({ threshold: 90 }), demoRule()), /阈值/);
  const proof = formatAlertRulesProof({
    action: '新建',
    rule,
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /阈值规则: 新建/);
  assert.match(proof, new RegExp(`id: ${id}`));
  assert.match(proof, /名称: 演示规则列表/);
  assert.match(proof, /指标: 湿度过高/);
  assert.match(proof, /棚区: S01/);
  assert.match(proof, /阈值: 95/);
  assert.match(proof, /等级: 提示/);
  assert.match(proof, /窗口分钟: 360/);
  assert.match(proof, /启用: 是/);
  assert.match(
    proof,
    new RegExp(rulesListUrl(id, 'http://127.0.0.1:43123').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
  assert.match(
    proof,
    new RegExp(ruleDetailUrl(id, 'http://127.0.0.1:43123').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
  assert.match(proof, /ruleId=/);
  assert.doesNotMatch(proof, /ingest-observability/);
});

test('creates, patches, or stops without touching the seed rule', async () => {
  const original = global.fetch;
  try {
    const created = demoRule();
    const createCalls = [];
    let posted = false;
    global.fetch = async (url, init = {}) => {
      const target = String(url);
      const method = init.method || 'GET';
      createCalls.push(`${method} ${target}`);
      if (target.endsWith('/auth/login')) {
        return jsonResponse(200, { accessToken: 'token' });
      }
      if (target.endsWith('/alert-rules') && method === 'GET') {
        return jsonResponse(200, posted ? [seedRule(), created] : [seedRule()]);
      }
      if (target.endsWith('/alert-rules') && method === 'POST') {
        const body = JSON.parse(init.body);
        assert.equal(body.name, RULE_NAME);
        assert.equal(body.metric, RULE_METRIC);
        assert.equal(body.threshold, RULE_THRESHOLD);
        assert.equal(body.level, RULE_LEVEL);
        assert.equal(body.shedCode, RULE_SHED);
        assert.equal(body.windowMinutes, RULE_WINDOW);
        posted = true;
        return jsonResponse(201, created);
      }
      if (method === 'GET' && target.endsWith(`/alert-rules/${id}`)) {
        return jsonResponse(200, created);
      }
      throw new Error(`unexpected ${method} ${target}`);
    };
    const createdSent = await sendAlertRulesDemo();
    assert.equal(createdSent.action, '新建');
    assert.equal(createdSent.rule.id, id);
    assert.equal(createdSent.detail.threshold, RULE_THRESHOLD);
    assert.equal(createCalls.filter((line) => line.includes(`/alert-rules/${seedId}`)).length, 0);
    assert.equal(createCalls.filter((line) => line.startsWith('PATCH ')).length, 0);

    const patchCalls = [];
    const existing = demoRule({ threshold: 80, windowMinutes: 720, level: 'warning' });
    const saved = demoRule();
    let didPatch = false;
    global.fetch = async (url, init = {}) => {
      const target = String(url);
      const method = init.method || 'GET';
      patchCalls.push(`${method} ${target}`);
      if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'token' });
      if (target.endsWith('/alert-rules') && method === 'GET') {
        return jsonResponse(200, [seedRule(), didPatch ? saved : existing]);
      }
      if (method === 'PATCH' && target.endsWith(`/alert-rules/${id}`)) {
        assert.deepEqual(JSON.parse(init.body), {
          threshold: RULE_THRESHOLD,
          level: RULE_LEVEL,
          windowMinutes: RULE_WINDOW,
          enabled: true,
        });
        didPatch = true;
        return jsonResponse(200, saved);
      }
      if (method === 'GET' && target.endsWith(`/alert-rules/${id}`)) return jsonResponse(200, saved);
      throw new Error(`unexpected ${method} ${target}`);
    };
    const patched = await sendAlertRulesDemo();
    assert.equal(patched.action, '已改');
    assert.equal(
      patchCalls.filter((line) => line.startsWith('POST ') && line.endsWith('/alert-rules')).length,
      0,
    );
    assert.equal(patchCalls.filter((line) => line.includes(`/alert-rules/${seedId}`)).length, 0);

    global.fetch = async (url, init = {}) => {
      const target = String(url);
      const method = init.method || 'GET';
      if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'token' });
      if (target.endsWith('/alert-rules') && method === 'GET') {
        return jsonResponse(200, [seedRule({ threshold: 24 })]);
      }
      throw new Error(`unexpected ${method} ${target}`);
    };
    await assert.rejects(() => sendAlertRulesDemo(), /不改它/);
  } finally {
    global.fetch = original;
  }
});

test('make target and the demo doc name the list and the detail', () => {
  const root = repoRoot();
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  assert.match(makefile, /^demo-alert-rules:.*\n\tnode scripts\/demo-alert-rules\.mjs\s*$/m);
  assert.match(makefile, /scripts\/demo-alert-rules\.spec\.mjs/);
  const doc = readFileSync(join(root, 'docs/DEMO_ALERT_RULES.md'), 'utf8');
  assert.match(doc, /make demo-alert-rules/);
  assert.match(doc, /演示规则列表/);
  assert.match(doc, /湿度过高/);
  assert.match(doc, /S01/);
  assert.match(doc, /95/);
  assert.match(doc, /提示/);
  assert.match(doc, /360/);
  assert.match(doc, /阈值规则列表/);
  assert.match(doc, /阈值规则详情/);
  assert.match(doc, /打开/);
  assert.match(doc, /全场/);
  assert.match(doc, /温度过高/);
  assert.doesNotMatch(doc, /假定|假设/);
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  assert.match(caps, /make demo-alert-rules/);
  assert.match(caps, /GET\/PATCH \/api\/v1\/alert-rules\/:id|GET \/api\/v1\/alert-rules\/:id/);
});
