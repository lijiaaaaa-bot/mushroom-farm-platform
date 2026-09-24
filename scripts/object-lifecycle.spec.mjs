import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildLifecycleConfig,
  lifecycleRuleMatches,
  runObjectLifecycle,
} from './object-lifecycle.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function spawnLifecycle(extra = {}) {
  const env = { ...process.env };
  delete env.MINIO_APPLY_LIFECYCLE;
  delete env.MINIO_ENDPOINT;
  delete env.MINIO_ACCESS_KEY;
  delete env.MINIO_SECRET_KEY;
  delete env.MINIO_BUCKET;
  delete env.OBJECT_HOT_DAYS;
  Object.assign(env, extra);
  return spawnSync(process.execPath, [join(root, 'scripts/object-lifecycle.mjs')], {
    encoding: 'utf8',
    env,
  });
}

test('object lifecycle script stays a local plan unless apply is requested', () => {
  const result = spawnLifecycle();
  assert.equal(result.status, 0);
  assert.match(result.stdout, /未下发/);
  assert.doesNotMatch(result.stdout, /已下发/);
  assert.doesNotMatch(result.stdout, /已生产启用/);
});

test('optional timescale migration does not create a hypertable', () => {
  const sql = readFileSync(
    join(root, 'infra/migrations/009_timescale_optional.sql'),
    'utf8',
  );
  assert.doesNotMatch(sql, /create_hypertable/i);
  assert.doesNotMatch(sql, /CREATE EXTENSION/i);
  assert.match(sql, /timescaledb is not installed/);
});

test('configured apply without endpoint exits non-zero and does not claim success', () => {
  const result = spawnLifecycle({ MINIO_APPLY_LIFECYCLE: '1' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /缺少 MINIO_ENDPOINT/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /已下发/);
});

test('configured apply to an unreachable endpoint fails closed', () => {
  const result = spawnLifecycle({
    MINIO_APPLY_LIFECYCLE: '1',
    MINIO_ENDPOINT: '127.0.0.1:1',
    MINIO_ACCESS_KEY: 'minioadmin',
    MINIO_SECRET_KEY: 'minioadmin',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /不可达|下发失败|客户端不可用/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /已下发/);
});

test('configured apply records the rule only after MinIO reads it back', async () => {
  let saved = null;
  const result = await runObjectLifecycle({
    env: {
      MINIO_APPLY_LIFECYCLE: '1',
      MINIO_ENDPOINT: '127.0.0.1:9000',
      MINIO_ACCESS_KEY: 'key',
      MINIO_SECRET_KEY: 'secret',
      OBJECT_HOT_DAYS: '30',
    },
    log: () => undefined,
    error: () => undefined,
    clientFactory: async () => ({
      setBucketLifecycle: async (_bucket, config) => {
        saved = config;
      },
      getBucketLifecycle: async () => saved,
    }),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.applied, true);
  assert.equal(saved.Rule[0].Filter.Prefix, 'snapshots/');
  assert.equal(saved.Rule[0].Transition.Days, 30);
  assert.equal(saved.Rule[0].Transition.StorageClass, 'GLACIER');
  assert.equal(lifecycleRuleMatches(saved, 'snapshots/'), true);
});

test('configured apply fails closed when the read-back rule does not match', async () => {
  const errors = [];
  const result = await runObjectLifecycle({
    env: {
      MINIO_APPLY_LIFECYCLE: '1',
      MINIO_ENDPOINT: '127.0.0.1:9000',
      MINIO_ACCESS_KEY: 'key',
      MINIO_SECRET_KEY: 'secret',
    },
    log: () => undefined,
    error: (line) => errors.push(line),
    clientFactory: async () => ({
      setBucketLifecycle: async () => undefined,
      getBucketLifecycle: async () => ({ Rule: [] }),
    }),
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.applied, false);
  assert.match(errors.join('\n'), /未读回/);
});

test('buildLifecycleConfig uses the plan prefix and cold class', () => {
  const source = JSON.parse(readFileSync(join(root, 'infra/object-lifecycle.json'), 'utf8'));
  const config = buildLifecycleConfig(source, source.hotDays);
  assert.equal(config.Rule[0].Filter.Prefix, source.prefix);
  assert.equal(config.Rule[0].Transition.StorageClass, source.coldStorageClass);
  assert.equal(config.Rule[0].Transition.Days, source.hotDays);
});
