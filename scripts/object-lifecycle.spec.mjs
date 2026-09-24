import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('object lifecycle script stays a local plan unless mc is explicitly targeted', () => {
  const result = spawnSync(
    process.execPath,
    [join(root, 'scripts/object-lifecycle.mjs')],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0);
  assert.match(result.stdout, /未下发/);
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
