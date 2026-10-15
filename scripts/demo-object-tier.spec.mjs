import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  FIXTURE_LEAVE,
  FIXTURE_NEW,
  FIXTURE_OLD,
  assertTierDemo,
  buildTierDemo,
} from './demo-object-tier.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('demo-object-tier prints the plan and the fixture key contrast', async () => {
  const report = await buildTierDemo({ ...process.env, MINIO_APPLY_TIER: '1', OBJECT_HOT_DAYS: '7' });
  assertTierDemo(report);
  assert.equal(report.plan.status, 0);
  assert.match(report.plan.stdout, /超过 90 天/);
  assert.doesNotMatch(report.plan.stdout, /超过 7 天/);
  assert.equal(report.fixture.after.hot.includes(FIXTURE_OLD), false);
  assert.equal(report.fixture.after.hot.includes(FIXTURE_NEW), true);
  assert.equal(report.fixture.after.hot.includes(FIXTURE_LEAVE), true);
  assert.deepEqual(report.fixture.after.cold, [FIXTURE_OLD]);
  const spawned = spawnSync(process.execPath, [join(root, 'scripts/demo-object-tier.mjs')], {
    encoding: 'utf8',
    env: { ...process.env, MINIO_APPLY_TIER: '1' },
  });
  assert.equal(spawned.status, 0, spawned.stderr);
  assertTierDemo({
    plan: { status: 0, stdout: spawned.stdout.split('夹具复制（不连接 MinIO）')[0] },
    fixture: report.fixture,
    text: spawned.stdout,
  });
});

test('docs name the make target and leave ingest observability alone', () => {
  const doc = readFileSync(join(root, 'docs/DEMO_OBJECT_TIER.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  const ops = readFileSync(join(root, 'docs/OPS_STORAGE_BACKUP.md'), 'utf8');
  for (const text of [doc, caps, readme, status, ops]) {
    assert.match(text, /make demo-object-tier/);
  }
  assert.match(doc, /snapshots\/tier-old\.jpg/);
  assert.match(doc, /snapshots\/tier-new\.jpg/);
  assert.match(doc, /热端（前）/);
  assert.match(doc, /冷端（后）/);
  assert.match(doc, /热端（后）/);
  assert.match(doc, /127\.0\.0\.1:9001/);
  assert.match(doc, /127\.0\.0\.1:9003/);
  assert.match(doc, /docker-compose\.minio-cold\.yml/);
  assert.match(doc, /未列出/);
  assert.match(caps, /DEMO_OBJECT_TIER\.md/);
  assert.match(readme, /DEMO_OBJECT_TIER\.md/);
  assert.match(makefile, /^demo-object-tier:\n\tnode scripts\/demo-object-tier\.mjs\s*$/m);
  assert.match(makefile, /scripts\/demo-object-tier\.spec\.mjs/);
  assert.match(makefile, /^object-tier:\n\tnode scripts\/object-tier\.mjs\s*$/m);
  assert.doesNotMatch(doc, /假定|假设/);
  assert.match(doc, /不改接入观测/);
  assert.doesNotMatch(doc, /ingest-observability/);
  const ingest = readFileSync(join(root, 'apps/web/src/views/IngestObservabilityView.vue'), 'utf8');
  assert.doesNotMatch(ingest, /object-tier|tier-old|热冷复制/);
  const demo = readFileSync(join(root, 'scripts/demo-object-tier.mjs'), 'utf8');
  assert.doesNotMatch(demo, /ingest\/observability|IngestObservability/);
});
