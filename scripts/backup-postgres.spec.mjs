import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildBackupCommand,
  databaseTarget,
  datedBackupName,
  resolveBackupPath,
  runBackup,
  selectBackupMode,
} from './backup-postgres.mjs';

test('backup file name is dated plain SQL under backups/', () => {
  const now = new Date('2026-09-24T09:14:55.123Z');
  assert.equal(datedBackupName(now), 'mushroom-20260924T091455Z.sql');
  const path = resolveBackupPath('/repo', {}, now);
  assert.equal(path.dir, '/repo/backups');
  assert.equal(path.file, '/repo/backups/mushroom-20260924T091455Z.sql');
  const custom = resolveBackupPath('/repo', { BACKUP_DIR: 'var/dumps' }, now);
  assert.equal(custom.file, '/repo/var/dumps/mushroom-20260924T091455Z.sql');
});

test('database target comes from DATABASE_URL and the dump command does not print it', () => {
  const target = databaseTarget('postgres://mushroom:secret@127.0.0.1:5432/mushroom');
  assert.equal(target.user, 'mushroom');
  assert.equal(target.database, 'mushroom');
  const command = buildBackupCommand({
    mode: 'pg_dump',
    file: '/tmp/mushroom.sql',
    databaseUrl: target.databaseUrl,
    user: target.user,
    database: target.database,
    cwd: '/repo',
  });
  assert.equal(command.cmd, 'pg_dump');
  assert.equal(command.args.at(-1), '/tmp/mushroom.sql');
  assert.equal(command.stdoutFile, null);
  const docker = buildBackupCommand({
    mode: 'docker',
    file: '/tmp/mushroom.sql',
    databaseUrl: target.databaseUrl,
    user: target.user,
    database: target.database,
    cwd: '/repo',
  });
  assert.deepEqual(docker.args.slice(0, 4), ['compose', 'exec', '-T', 'postgres']);
  assert.equal(docker.stdoutFile, '/tmp/mushroom.sql');
});

test('selects pg_dump, then docker, and refuses a missing tool', () => {
  assert.equal(selectBackupMode((name) => name === 'pg_dump').mode, 'pg_dump');
  assert.equal(selectBackupMode((name) => name === 'docker').mode, 'docker');
  assert.equal(selectBackupMode(() => false).mode, null);
  assert.equal(
    selectBackupMode((name) => name === 'pg_dump', { BACKUP_VIA: 'docker' }).mode,
    null,
  );
});

test('backup writes a dated file and fails closed on an empty dump', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mushroom-backup-'));
  try {
    const logs = [];
    const errors = [];
    const ok = await runBackup({
      env: { DATABASE_URL: 'postgres://mushroom:mushroom@127.0.0.1:5432/mushroom' },
      repoRoot: dir,
      now: new Date('2026-09-24T09:14:55.123Z'),
      log: (line) => logs.push(line),
      error: (line) => errors.push(line),
      which: (name) => name === 'pg_dump',
      spawnCommand: async (command) => {
        await writeFile(command.file, '-- PostgreSQL database dump\n');
        return { code: 0, stderr: '' };
      },
    });
    assert.equal(ok.exitCode, 0);
    assert.match(ok.file, /mushroom-20260924T091455Z\.sql$/);
    assert.match((await readFile(ok.file, 'utf8')), /PostgreSQL database dump/);
    assert.match(logs.join('\n'), /Redis 不在此文件中/);
    assert.match(logs.join('\n'), /MinIO/);
    assert.equal(logs.join('\n').includes('mushroom:mushroom'), false);

    const empty = await runBackup({
      env: {},
      repoRoot: dir,
      now: new Date('2026-09-24T10:00:00.000Z'),
      log: () => undefined,
      error: (line) => errors.push(line),
      which: () => true,
      spawnCommand: async (command) => {
        await writeFile(command.file, '');
        return { code: 0, stderr: '' };
      },
    });
    assert.equal(empty.exitCode, 1);
    assert.match(errors.join('\n'), /为空/);
    assert.equal((await stat(empty.file)).size, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('backup does not claim success when the dump command fails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mushroom-backup-fail-'));
  const errors = [];
  try {
    const result = await runBackup({
      env: {},
      repoRoot: dir,
      log: () => undefined,
      error: (line) => errors.push(line),
      which: () => false,
      spawnCommand: async () => {
        throw new Error('should not spawn');
      },
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.file, null);
    assert.match(errors.join('\n'), /找不到 pg_dump 或 docker/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
