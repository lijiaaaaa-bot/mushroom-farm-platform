import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runObjectTier, sameBytes } from './object-tier.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const now = new Date('2026-09-24T00:00:00.000Z');

function spawnTier(extra = {}) {
  const env = { ...process.env };
  delete env.MINIO_APPLY_TIER;
  delete env.MINIO_ENDPOINT;
  delete env.MINIO_ACCESS_KEY;
  delete env.MINIO_SECRET_KEY;
  delete env.MINIO_COLD_ENDPOINT;
  delete env.MINIO_COLD_ACCESS_KEY;
  delete env.MINIO_COLD_SECRET_KEY;
  delete env.OBJECT_HOT_DAYS;
  Object.assign(env, extra);
  return spawnSync(process.execPath, [join(root, 'scripts/object-tier.mjs')], {
    encoding: 'utf8',
    env,
  });
}

function memorySide(objects) {
  const store = new Map(objects);
  return {
    store,
    removed: [],
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
        store.set(name, { bytes: Buffer.from(body), lastModified: now });
      },
      removeObject: async (_bucket, name) => {
        store.delete(name);
      },
    },
  };
}

const applyEnv = {
  MINIO_APPLY_TIER: '1',
  MINIO_ENDPOINT: '127.0.0.1:9000',
  MINIO_ACCESS_KEY: 'hot',
  MINIO_SECRET_KEY: 'hot-secret',
  MINIO_COLD_ENDPOINT: '127.0.0.1:9002',
  MINIO_COLD_ACCESS_KEY: 'cold',
  MINIO_COLD_SECRET_KEY: 'cold-secret',
  OBJECT_HOT_DAYS: '1',
};

test('object tier stays a plan unless apply is requested', () => {
  const result = spawnTier();
  assert.equal(result.status, 0);
  assert.match(result.stdout, /未执行/);
  assert.doesNotMatch(result.stdout, /已执行/);
  assert.doesNotMatch(result.stdout, /已下发/);
});

test('apply without a cold endpoint exits non-zero and does not claim a move', () => {
  const result = spawnTier({
    MINIO_APPLY_TIER: '1',
    MINIO_ENDPOINT: '127.0.0.1:9000',
    MINIO_ACCESS_KEY: 'hot',
    MINIO_SECRET_KEY: 'hot-secret',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /缺少冷端/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /已执行/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /已下发/);
});

test('apply copies aged snapshots and deletes the hot object only after read-back', async () => {
  const hot = memorySide([
    ['snapshots/old.jpg', { bytes: Buffer.from('jpeg-old'), lastModified: new Date('2026-09-20T00:00:00.000Z') }],
    ['snapshots/new.jpg', { bytes: Buffer.from('jpeg-new'), lastModified: new Date('2026-09-23T12:00:00.000Z') }],
    ['snapshots/edge.jpg', { bytes: Buffer.from('edge'), lastModified: new Date('2026-09-23T00:00:00.000Z') }],
    ['other/old.jpg', { bytes: Buffer.from('leave'), lastModified: new Date('2026-09-01T00:00:00.000Z') }],
  ]);
  const cold = memorySide([]);
  const logs = [];
  const result = await runObjectTier({
    env: applyEnv,
    now,
    log: (line) => logs.push(line),
    error: () => undefined,
    clientFactory: async (side) => (side === 'hot' ? hot.client : cold.client),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.applied, true);
  assert.equal(result.moved, 1);
  assert.equal(hot.store.has('snapshots/old.jpg'), false);
  assert.equal(hot.store.has('snapshots/new.jpg'), true);
  assert.equal(hot.store.has('snapshots/edge.jpg'), true);
  assert.equal(hot.store.has('other/old.jpg'), true);
  assert.equal(sameBytes(cold.store.get('snapshots/old.jpg').bytes, Buffer.from('jpeg-old')), true);
  assert.match(logs.join('\n'), /已执行/);
  assert.doesNotMatch(logs.join('\n'), /已下发/);
});

test('apply keeps the hot object when cold read-back does not match', async () => {
  const hot = memorySide([
    ['snapshots/old.jpg', { bytes: Buffer.from('jpeg-old'), lastModified: new Date('2026-09-20T00:00:00.000Z') }],
  ]);
  const cold = memorySide([]);
  cold.client.getObject = async () => Buffer.from('different');
  const errors = [];
  const result = await runObjectTier({
    env: applyEnv,
    now,
    log: () => undefined,
    error: (line) => errors.push(line),
    clientFactory: async (side) => (side === 'hot' ? hot.client : cold.client),
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.applied, false);
  assert.equal(result.moved, 0);
  assert.equal(hot.store.has('snapshots/old.jpg'), true);
  assert.match(errors.join('\n'), /读回与热端不一致/);
});

test('apply to an unreachable cold endpoint fails closed', async () => {
  const errors = [];
  const logs = [];
  const result = await runObjectTier({
    env: applyEnv,
    now,
    log: (line) => logs.push(line),
    error: (line) => errors.push(line),
    clientFactory: async () => {
      const cause = new Error('connect ECONNREFUSED 127.0.0.1:9002');
      cause.code = 'ECONNREFUSED';
      throw cause;
    },
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.applied, false);
  assert.match(errors.join('\n'), /不可达/);
  assert.doesNotMatch(logs.join('\n'), /已执行/);
  assert.doesNotMatch(logs.join('\n'), /已下发/);
});

test('an empty hot prefix still counts as executed after the cold bucket is reachable', async () => {
  const hot = memorySide([]);
  const cold = memorySide([]);
  let sawCold = false;
  const logs = [];
  const result = await runObjectTier({
    env: applyEnv,
    now,
    log: (line) => logs.push(line),
    error: () => undefined,
    clientFactory: async (side) => {
      if (side === 'cold') sawCold = true;
      return side === 'hot' ? hot.client : cold.client;
    },
  });
  assert.equal(sawCold, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.moved, 0);
  assert.match(logs.join('\n'), /已执行/);
  assert.match(logs.join('\n'), /没有超过/);
});
