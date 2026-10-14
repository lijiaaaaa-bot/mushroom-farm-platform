import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { repoRoot } from './lib/ingest-wire.mjs';
import { SEED_RULE_NAME, SEED_THRESHOLD } from './demo-alert-rules.mjs';
import {
  AFTER_LEVEL,
  AFTER_THRESHOLD,
  AFTER_WINDOW,
  BEFORE_LEVEL,
  BEFORE_THRESHOLD,
  BEFORE_WINDOW,
  RULE_METRIC,
  RULE_NAME,
  afterPatch,
  beforeBody,
  formatAlertRuleEditProof,
  isAfterState,
  isBeforeState,
  sendAlertRuleEditDemo,
} from './demo-alert-rule-edit.mjs';

const id = '77777777-7777-4777-8777-777777777777';
const seedId = 'seed-temp';
const listId = 'list-rule';
const configId = 'config-rule';

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

function listRule() {
  return {
    id: listId,
    name: '演示规则列表',
    metric: 'humidity_high',
    threshold: 95,
    level: 'info',
    shedCode: 'S01',
    enabled: true,
    windowMinutes: 360,
  };
}

function configRule() {
  return {
    id: configId,
    name: '演示环境温度过高',
    metric: 'temperature_high',
    threshold: 24,
    level: 'warning',
    shedCode: 'S03',
    enabled: true,
    windowMinutes: 720,
  };
}

function demoRule(overrides = {}) {
  return {
    id,
    ...beforeBody(),
    shedCode: null,
    enabled: true,
    ...overrides,
  };
}

function afterRule() {
  return demoRule({
    threshold: AFTER_THRESHOLD,
    level: AFTER_LEVEL,
    windowMinutes: AFTER_WINDOW,
    enabled: false,
  });
}

test('proof prints the before and after fields and the two addresses', () => {
  const before = demoRule();
  const after = afterRule();
  assert.equal(isBeforeState(before), true);
  assert.equal(isAfterState(after), true);
  assert.equal(isAfterState(before), false);
  const proof = formatAlertRuleEditProof({
    action: '新建',
    before,
    after,
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.match(proof, /阈值规则: 新建/);
  assert.match(proof, new RegExp(`id: ${id}`));
  assert.match(proof, /名称: 演示规则新建/);
  assert.match(proof, /指标: 湿度过低/);
  assert.match(proof, /棚区: 全场/);
  assert.match(proof, /改前阈值: 40/);
  assert.match(proof, /改前等级: 提示/);
  assert.match(proof, /改前窗口分钟: 180/);
  assert.match(proof, /改前启用: 是/);
  assert.match(proof, /改后阈值: 55/);
  assert.match(proof, /改后等级: 一般/);
  assert.match(proof, /改后窗口分钟: 90/);
  assert.match(proof, /改后启用: 否/);
  assert.match(proof, /对照: 阈值 40 → 55；等级 提示 → 一般；窗口分钟 180 → 90；启用 是 → 否/);
  assert.match(proof, /改后列表: http:\/\/127\.0\.0\.1:43123\/alert-rules\?ruleId=/);
  assert.match(proof, new RegExp(`改后详情: http://127\\.0\\.0\\.1:43123/alert-rules/${id}`));
  assert.doesNotMatch(proof, /假定|假设|ingest-observability/);
});

test('creates the rule, then the list and the detail both show the edited values', async () => {
  const original = global.fetch;
  try {
    const calls = [];
    let phase = 'missing';
    global.fetch = async (url, init = {}) => {
      const target = String(url);
      const method = init.method || 'GET';
      calls.push(`${method} ${target}`);
      if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'token' });
      if (target.endsWith('/alert-rules') && method === 'GET') {
        const row = phase === 'after' ? afterRule() : phase === 'before' ? demoRule() : null;
        return jsonResponse(200, row ? [seedRule(), listRule(), configRule(), row] : [seedRule(), listRule(), configRule()]);
      }
      if (target.endsWith('/alert-rules') && method === 'POST') {
        assert.deepEqual(JSON.parse(init.body), beforeBody());
        phase = 'before';
        return jsonResponse(201, demoRule());
      }
      if (method === 'PATCH' && target.endsWith(`/alert-rules/${id}`)) {
        assert.deepEqual(JSON.parse(init.body), afterPatch());
        phase = 'after';
        return jsonResponse(200, afterRule());
      }
      if (method === 'GET' && target.endsWith(`/alert-rules/${id}`)) {
        return jsonResponse(200, phase === 'after' ? afterRule() : demoRule());
      }
      throw new Error(`unexpected ${method} ${target}`);
    };
    const sent = await sendAlertRuleEditDemo();
    assert.equal(sent.action, '新建');
    assert.equal(sent.before.threshold, BEFORE_THRESHOLD);
    assert.equal(sent.before.level, BEFORE_LEVEL);
    assert.equal(sent.before.windowMinutes, BEFORE_WINDOW);
    assert.equal(sent.before.enabled, true);
    assert.equal(sent.after.threshold, AFTER_THRESHOLD);
    assert.equal(sent.after.level, AFTER_LEVEL);
    assert.equal(sent.after.windowMinutes, AFTER_WINDOW);
    assert.equal(sent.after.enabled, false);
    assert.equal(sent.detail.enabled, false);
    assert.equal(calls.filter((line) => line.startsWith('POST ') && line.endsWith('/alert-rules')).length, 1);
    assert.equal(calls.filter((line) => line.startsWith('PATCH ')).length, 1);
    assert.equal(calls.filter((line) => line.includes(`/alert-rules/${seedId}`)).length, 0);
    assert.equal(calls.filter((line) => line.includes(`/alert-rules/${listId}`)).length, 0);
    assert.equal(calls.filter((line) => line.includes(`/alert-rules/${configId}`)).length, 0);
  } finally {
    global.fetch = original;
  }
});

test('reuses an existing rule, writes the before state, then the after state', async () => {
  const original = global.fetch;
  try {
    const calls = [];
    let phase = 'dirty';
    const dirty = demoRule({ threshold: 12, level: 'severe', windowMinutes: 30, enabled: false });
    global.fetch = async (url, init = {}) => {
      const target = String(url);
      const method = init.method || 'GET';
      calls.push(`${method} ${target} ${init.body || ''}`);
      if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'token' });
      if (target.endsWith('/alert-rules') && method === 'GET') {
        const row = phase === 'after' ? afterRule() : phase === 'before' ? demoRule() : dirty;
        return jsonResponse(200, [seedRule(), listRule(), row]);
      }
      if (method === 'PATCH' && target.endsWith(`/alert-rules/${id}`)) {
        const body = JSON.parse(init.body);
        if (body.enabled === true) {
          assert.equal(body.threshold, BEFORE_THRESHOLD);
          assert.equal(body.level, BEFORE_LEVEL);
          assert.equal(body.windowMinutes, BEFORE_WINDOW);
          phase = 'before';
          return jsonResponse(200, demoRule());
        }
        assert.deepEqual(body, afterPatch());
        phase = 'after';
        return jsonResponse(200, afterRule());
      }
      if (method === 'GET' && target.endsWith(`/alert-rules/${id}`)) {
        return jsonResponse(200, phase === 'after' ? afterRule() : demoRule());
      }
      throw new Error(`unexpected ${method} ${target}`);
    };
    const sent = await sendAlertRuleEditDemo();
    assert.equal(sent.action, '沿用');
    assert.equal(sent.before.enabled, true);
    assert.equal(sent.after.threshold, AFTER_THRESHOLD);
    assert.equal(sent.after.enabled, false);
    assert.equal(calls.filter((line) => line.startsWith('POST ') && line.includes('/alert-rules')).length, 0);
    assert.equal(calls.filter((line) => line.startsWith('PATCH ')).length, 2);
  } finally {
    global.fetch = original;
  }
});

test('does not create another row when the name exists with another metric or shed', async () => {
  const original = global.fetch;
  try {
    global.fetch = async (url, init = {}) => {
      const target = String(url);
      const method = init.method || 'GET';
      if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'token' });
      if (target.endsWith('/alert-rules') && method === 'GET') {
        return jsonResponse(200, [seedRule(), demoRule({ metric: 'temperature_high' })]);
      }
      throw new Error(`unexpected ${method} ${target}`);
    };
    await assert.rejects(() => sendAlertRuleEditDemo(), /不另建一行/);

    global.fetch = async (url, init = {}) => {
      const target = String(url);
      const method = init.method || 'GET';
      if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'token' });
      if (target.endsWith('/alert-rules') && method === 'GET') {
        return jsonResponse(200, [seedRule(), demoRule({ shedCode: 'S01' })]);
      }
      throw new Error(`unexpected ${method} ${target}`);
    };
    await assert.rejects(() => sendAlertRuleEditDemo(), /全场/);
  } finally {
    global.fetch = original;
  }
});

test('stops when the seed temperature rule is no longer 28', async () => {
  const original = global.fetch;
  try {
    global.fetch = async (url, init = {}) => {
      const target = String(url);
      const method = init.method || 'GET';
      if (target.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'token' });
      if (target.endsWith('/alert-rules') && method === 'GET') {
        return jsonResponse(200, [seedRule({ threshold: 24 })]);
      }
      throw new Error(`unexpected ${method} ${target}`);
    };
    await assert.rejects(() => sendAlertRuleEditDemo(), /不改它/);
  } finally {
    global.fetch = original;
  }
});

test('make target and the demo doc name the create row and the edited fields', () => {
  const root = repoRoot();
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  assert.match(makefile, /^demo-alert-rule-edit:.*\n\tnode scripts\/demo-alert-rule-edit\.mjs\s*$/m);
  assert.match(makefile, /scripts\/demo-alert-rule-edit\.spec\.mjs/);
  assert.match(makefile, /^demo-alert-rules:.*\n\tnode scripts\/demo-alert-rules\.mjs\s*$/m);
  assert.match(makefile, /^demo-alert-rule-config:.*\n\tnode scripts\/demo-alert-rule-config\.mjs\s*$/m);
  const doc = readFileSync(join(root, 'docs/DEMO_ALERT_RULE_EDIT.md'), 'utf8');
  assert.match(doc, /make demo-alert-rule-edit/);
  assert.match(doc, /演示规则新建/);
  assert.match(doc, /湿度过低/);
  assert.match(doc, /全场/);
  assert.match(doc, /40/);
  assert.match(doc, /55/);
  assert.match(doc, /提示/);
  assert.match(doc, /一般/);
  assert.match(doc, /180/);
  assert.match(doc, /90/);
  assert.match(doc, /新建规则/);
  assert.match(doc, /改后列表/);
  assert.match(doc, /改后详情/);
  assert.match(doc, /温度过高/);
  assert.match(doc, /28/);
  assert.doesNotMatch(doc, /假定|假设/);
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  assert.match(caps, /make demo-alert-rule-edit/);
  assert.match(caps, /演示规则新建/);
  const rulesDoc = readFileSync(join(root, 'docs/DEMO_ALERT_RULES.md'), 'utf8');
  assert.match(rulesDoc, /演示规则列表/);
  assert.match(rulesDoc, /95/);
  const configDoc = readFileSync(join(root, 'docs/DEMO_ALERT_RULE_CONFIG.md'), 'utf8');
  assert.match(configDoc, /演示环境温度过高/);
  assert.match(configDoc, /make demo-alert-rule-config/);
  assert.equal(BEFORE_WINDOW, 180);
  assert.equal(AFTER_WINDOW, 90);
  assert.equal(RULE_METRIC, 'humidity_low');
  assert.equal(RULE_NAME, '演示规则新建');
});
