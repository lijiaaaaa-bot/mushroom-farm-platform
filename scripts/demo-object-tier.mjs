#!/usr/bin/env node
/**
 * 热冷对照：未设置 MINIO_APPLY_TIER 时计划不列出键；
 * 夹具里超龄 snapshots/ 复制到冷端后热端没有。不连接 MinIO。
 */
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runObjectTier, sameBytes } from './object-tier.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const FIXTURE_OLD = 'snapshots/tier-old.jpg';
export const FIXTURE_NEW = 'snapshots/tier-new.jpg';
export const FIXTURE_LEAVE = 'other/tier-leave.jpg';
export const FIXTURE_BYTES = Buffer.from('tier-demo-jpeg');
export const FIXTURE_NOW = new Date('2026-10-15T00:00:00.000Z');

const applyEnv = {
  MINIO_APPLY_TIER: '1',
  MINIO_ENDPOINT: '127.0.0.1:9000',
  MINIO_ACCESS_KEY: 'hot',
  MINIO_SECRET_KEY: 'hot-secret',
  MINIO_BUCKET: 'mushroom-snapshots',
  MINIO_COLD_ENDPOINT: '127.0.0.1:9002',
  MINIO_COLD_ACCESS_KEY: 'cold',
  MINIO_COLD_SECRET_KEY: 'cold-secret',
  MINIO_COLD_BUCKET: 'mushroom-snapshots',
  OBJECT_HOT_DAYS: '1',
};

function memorySide(objects) {
  const store = new Map(objects);
  return {
    store,
    client: {
      bucketExists: async () => true,
      makeBucket: async () => undefined,
      listObjectsV2: (_bucket, prefix) =>
        [...store.keys()]
          .filter((name) => name.startsWith(prefix))
          .map((name) => ({
            name,
            lastModified: store.get(name).lastModified,
          })),
      getObject: async (_bucket, name) => Buffer.from(store.get(name).bytes),
      putObject: async (_bucket, name, body) => {
        store.set(name, { bytes: Buffer.from(body), lastModified: FIXTURE_NOW });
      },
      removeObject: async (_bucket, name) => {
        store.delete(name);
      },
    },
  };
}

function sortedKeys(store) {
  return [...store.keys()].sort();
}

export function spawnPlan(env = process.env) {
  const childEnv = { ...env };
  delete childEnv.MINIO_APPLY_TIER;
  delete childEnv.MINIO_ENDPOINT;
  delete childEnv.MINIO_ACCESS_KEY;
  delete childEnv.MINIO_SECRET_KEY;
  delete childEnv.MINIO_COLD_ENDPOINT;
  delete childEnv.MINIO_COLD_ACCESS_KEY;
  delete childEnv.MINIO_COLD_SECRET_KEY;
  delete childEnv.OBJECT_HOT_DAYS;
  return spawnSync(process.execPath, [join(root, 'scripts/object-tier.mjs')], {
    encoding: 'utf8',
    env: childEnv,
  });
}

export async function runFixtureContrast() {
  const hot = memorySide([
    [FIXTURE_OLD, { bytes: Buffer.from(FIXTURE_BYTES), lastModified: new Date('2026-10-01T00:00:00.000Z') }],
    [FIXTURE_NEW, { bytes: Buffer.from('tier-demo-new'), lastModified: new Date('2026-10-14T12:00:00.000Z') }],
    [FIXTURE_LEAVE, { bytes: Buffer.from('tier-demo-leave'), lastModified: new Date('2026-09-01T00:00:00.000Z') }],
  ]);
  const cold = memorySide([]);
  const before = { hot: sortedKeys(hot.store), cold: sortedKeys(cold.store) };
  const logs = [];
  const result = await runObjectTier({
    env: applyEnv,
    now: FIXTURE_NOW,
    log: (line) => logs.push(line),
    error: (line) => logs.push(line),
    clientFactory: async (side) => (side === 'hot' ? hot.client : cold.client),
  });
  const after = { hot: sortedKeys(hot.store), cold: sortedKeys(cold.store) };
  const coldBytes = cold.store.get(FIXTURE_OLD)?.bytes;
  return {
    result,
    logs,
    before,
    after,
    bytesMatch: sameBytes(coldBytes, FIXTURE_BYTES),
  };
}

function keyLines(label, names) {
  if (!names.length) return [`${label}: （无）`];
  return names.map((name) => `${label}: ${name}`);
}

export function renderTierDemo({ plan, fixture }) {
  const gone = fixture.before.hot.filter((name) => !fixture.after.hot.includes(name));
  return [
    `计划退出码: ${plan.status}`,
    '计划（未设置 MINIO_APPLY_TIER）',
    String(plan.stdout || '').trimEnd(),
    '夹具复制（不连接 MinIO）',
    `夹具退出码: ${fixture.result.exitCode}`,
    `夹具转移: ${fixture.result.moved}`,
    ...keyLines('夹具热端（前）', fixture.before.hot),
    ...keyLines('夹具冷端（前）', fixture.before.cold),
    ...fixture.logs,
    ...keyLines('夹具热端（后）', fixture.after.hot),
    ...keyLines('夹具冷端（后）', fixture.after.cold),
    ...gone.map((name) => `夹具热端已无: ${name}`),
  ].join('\n');
}

export function assertTierDemo({ plan, fixture, text }) {
  if (plan.status !== 0) {
    throw new Error(`计划退出码是 ${plan.status}。${plan.stderr || ''}`);
  }
  const planText = String(plan.stdout || '');
  if (!/未执行/.test(planText)) throw new Error('计划输出里没有「未执行」。');
  if (/已执行/.test(planText)) throw new Error('计划输出写成了已执行。');
  if (/已下发/.test(planText)) throw new Error('计划输出写成了已下发。');
  if (!/热端对象键: 未列出/.test(planText) || !/冷端对象键: 未列出/.test(planText)) {
    throw new Error('计划应写明热端和冷端对象键都未列出。');
  }
  if (!/超过 90 天/.test(planText)) throw new Error('计划应写出默认热天数 90。');
  if (planText.includes(FIXTURE_OLD)) throw new Error('计划不应列出夹具对象键。');
  if (fixture.result.exitCode !== 0 || fixture.result.applied !== true || fixture.result.moved !== 1) {
    throw new Error(`夹具复制应转移 1 个对象并退出码 0，实际 ${fixture.result.moved} / ${fixture.result.exitCode}。`);
  }
  if (!fixture.bytesMatch) throw new Error('冷端字节与热端原字节不一致。');
  if (fixture.after.hot.includes(FIXTURE_OLD)) throw new Error('超龄对象仍在热端。');
  if (!fixture.after.hot.includes(FIXTURE_NEW) || !fixture.after.hot.includes(FIXTURE_LEAVE)) {
    throw new Error('未超龄对象或前缀外对象被移走了。');
  }
  if (fixture.after.cold.length !== 1 || fixture.after.cold[0] !== FIXTURE_OLD) {
    throw new Error(`冷端应只有 ${FIXTURE_OLD}。`);
  }
  const required = [
    '计划退出码: 0',
    '夹具退出码: 0',
    `夹具热端（前）: ${FIXTURE_OLD}`,
    `夹具热端（前）: ${FIXTURE_NEW}`,
    `夹具热端（前）: ${FIXTURE_LEAVE}`,
    '夹具冷端（前）: （无）',
    `热端（前）: ${FIXTURE_OLD}`,
    `冷端（后）: ${FIXTURE_OLD}`,
    `热端（后）: 无 ${FIXTURE_OLD}`,
    `夹具热端（后）: ${FIXTURE_NEW}`,
    `夹具热端（后）: ${FIXTURE_LEAVE}`,
    `夹具冷端（后）: ${FIXTURE_OLD}`,
    `夹具热端已无: ${FIXTURE_OLD}`,
  ];
  for (const line of required) {
    if (!text.includes(line)) throw new Error(`对照输出缺少：${line}`);
  }
  if (/已下发/.test(text)) throw new Error('对照输出写成了已下发。');
  const planPart = text.split('夹具复制（不连接 MinIO）')[0] || '';
  if (/已执行/.test(planPart)) throw new Error('计划段写成了已执行。');
  const fixturePart = text.split('夹具复制（不连接 MinIO）')[1] || '';
  if (!/已执行/.test(fixturePart)) throw new Error('夹具段应写明已执行。');
}

export async function buildTierDemo(env = process.env) {
  const plan = spawnPlan(env);
  const fixture = await runFixtureContrast();
  const text = renderTierDemo({ plan, fixture });
  return { plan, fixture, text };
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  try {
    const report = await buildTierDemo();
    assertTierDemo(report);
    console.log(report.text);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
