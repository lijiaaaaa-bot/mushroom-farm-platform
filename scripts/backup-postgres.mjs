import { spawn } from 'node:child_process';
import { accessSync, constants, createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function datedBackupName(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `mushroom-${stamp}.sql`;
}

export function resolveBackupPath(repoRoot, env = process.env, now = new Date()) {
  const requested = env.BACKUP_DIR?.trim();
  const dir = requested
    ? isAbsolute(requested)
      ? requested
      : join(repoRoot, requested)
    : join(repoRoot, 'backups');
  return { dir, file: join(dir, datedBackupName(now)) };
}

export function databaseTarget(databaseUrl) {
  const url = new URL(databaseUrl);
  const database = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'mushroom';
  const user = decodeURIComponent(url.username || 'mushroom');
  return { databaseUrl, database, user };
}

export function commandOnPath(name, env = process.env) {
  const pathValue = env.PATH || '';
  const extensions =
    process.platform === 'win32' ? (env.PATHEXT || '.EXE').split(';') : [''];
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;
    for (const ext of extensions) {
      try {
        accessSync(join(dir, name + ext), constants.X_OK);
        return true;
      } catch {
        // try the next directory
      }
    }
  }
  return false;
}

export function selectBackupMode(which, env = process.env) {
  const via = env.BACKUP_VIA?.trim();
  if (via && via !== 'pg_dump' && via !== 'docker') {
    return { mode: null, reason: `BACKUP_VIA 只能是 pg_dump 或 docker。当前值：${via}` };
  }
  if (via === 'pg_dump') {
    return which('pg_dump')
      ? { mode: 'pg_dump' }
      : { mode: null, reason: 'BACKUP_VIA=pg_dump，但找不到 pg_dump。未写出备份。' };
  }
  if (via === 'docker') {
    return which('docker')
      ? { mode: 'docker' }
      : { mode: null, reason: 'BACKUP_VIA=docker，但找不到 docker。未写出备份。' };
  }
  if (which('pg_dump')) return { mode: 'pg_dump' };
  if (which('docker')) return { mode: 'docker' };
  return { mode: null, reason: '找不到 pg_dump 或 docker。未写出备份。' };
}

export function buildBackupCommand({ mode, file, databaseUrl, user, database, cwd }) {
  if (mode === 'pg_dump') {
    return {
      cmd: 'pg_dump',
      args: [
        '--dbname',
        databaseUrl,
        '--format',
        'plain',
        '--no-owner',
        '--no-acl',
        '--file',
        file,
      ],
      cwd,
      file,
      stdoutFile: null,
    };
  }
  return {
    cmd: 'docker',
    args: [
      'compose',
      'exec',
      '-T',
      'postgres',
      'pg_dump',
      '-U',
      user,
      '-d',
      database,
      '--no-owner',
      '--no-acl',
    ],
    cwd,
    file,
    stdoutFile: file,
  };
}

function runProcess(command) {
  return new Promise((resolvePromise) => {
    const child = spawn(command.cmd, command.args, {
      cwd: command.cwd,
      env: command.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let settled = false;
    const settle = (payload) => {
      if (settled) return;
      settled = true;
      resolvePromise(payload);
    };
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    if (command.stdoutFile) {
      const out = createWriteStream(command.stdoutFile);
      child.stdout.pipe(out);
      const finishOut = () =>
        new Promise((resolveFinish) => {
          // pipe 可能已经 end()。writableEnded 时数据还没落盘，要等 finish，不能再 end() 一次，否则 finish 不再来。
          if (out.writableFinished || out.destroyed) {
            resolveFinish();
            return;
          }
          out.once('finish', resolveFinish);
          out.once('error', resolveFinish);
          if (!out.writableEnded) out.end();
        });
      child.on('close', (code) => {
        finishOut().finally(() => settle({ code: code ?? 1, stderr }));
      });
      child.on('error', (err) => {
        finishOut().finally(() => settle({ code: 1, stderr: stderr || String(err) }));
      });
      return;
    }
    child.stdout.resume();
    child.on('close', (code) => settle({ code: code ?? 1, stderr }));
    child.on('error', (err) => settle({ code: 1, stderr: stderr || String(err) }));
  });
}

const require = createRequire(import.meta.url);

export function publicBackupError(message) {
  const text = String(message ?? '')
    .replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgresql://…')
    .replace(/\s+/g, ' ')
    .trim();
  return (text || '备份失败').slice(0, 500);
}

export function backupFileName(file) {
  if (!file) return null;
  const name = basename(String(file));
  if (!name || name === '.' || name === '..') return null;
  return name;
}

/** 页面和 `postgres_backup_runs` 共用这一行。失败不带字节，错误里不留连接串。 */
export function backupRunRow({ result, now = new Date(), triggeredBy = 'make-backup' }) {
  const success = result?.exitCode === 0;
  const bytes = result?.bytes;
  return {
    status: success ? 'success' : 'failed',
    finishedAt: now.toISOString(),
    fileName: backupFileName(result?.file),
    bytes: success && Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null,
    errorMessage: success ? null : publicBackupError(result?.errorMessage),
    triggeredBy: String(triggeredBy || 'make-backup').slice(0, 120),
  };
}

export const INSERT_BACKUP_RUN_SQL = `INSERT INTO postgres_backup_runs (status, finished_at, file_name, bytes, error_message, triggered_by)
VALUES ($1, $2, $3, $4, $5, $6)`;

function loadPgClient() {
  for (const name of ['pg', join(root, 'apps/api/node_modules/pg')]) {
    try {
      return require(name).Client;
    } catch {
      // 下一个位置
    }
  }
  return null;
}

/**
 * 把一次备份结果写入 `postgres_backup_runs`。
 * 写不进去时不抛错：备份文件是否成功仍由 `runBackup` 的退出码决定。
 */
export async function recordBackupRun({ databaseUrl, row, query } = {}) {
  if (!row) return { ok: false, reason: '没有备份结果。备份记录未写入，页面上的时间不更新。' };
  let runQuery = query;
  let client;
  if (typeof runQuery !== 'function') {
    const url = databaseUrl?.trim();
    if (!url) {
      return { ok: false, reason: '没有 DATABASE_URL。备份记录未写入，页面上的时间不更新。' };
    }
    const Client = loadPgClient();
    if (!Client) {
      return { ok: false, reason: '找不到 pg。备份记录未写入，页面上的时间不更新。' };
    }
    client = new Client({ connectionString: url });
    try {
      await client.connect();
    } catch (cause) {
      await client.end().catch(() => undefined);
      client = undefined;
      return {
        ok: false,
        reason: `备份记录未写入，页面上的时间不更新。${publicBackupError(cause.message)}`,
      };
    }
    runQuery = (sql, params) => client.query(sql, params);
  }
  try {
    await runQuery(INSERT_BACKUP_RUN_SQL, [
      row.status,
      row.finishedAt,
      row.fileName,
      row.bytes,
      row.errorMessage,
      row.triggeredBy,
    ]);
    return { ok: true };
  } catch (cause) {
    return {
      ok: false,
      reason: `备份记录未写入，页面上的时间不更新。${publicBackupError(cause.message)}`,
    };
  } finally {
    if (client) await client.end().catch(() => undefined);
  }
}

/**
 * 把 Postgres 逻辑备份写到带日期的 SQL 文件。
 * Redis 不在文件里。MinIO 对象在独立数据卷，不在文件里。
 * 未找到 pg_dump / docker，或文件为空时退出码非 0。
 */
export async function runBackup({
  env = process.env,
  repoRoot = root,
  now = new Date(),
  log = console.log,
  error = console.error,
  which = (name) => commandOnPath(name, env),
  spawnCommand = runProcess,
  mkdirImpl = mkdir,
  statImpl = stat,
} = {}) {
  const databaseUrl =
    env.DATABASE_URL?.trim() || 'postgres://mushroom:mushroom@127.0.0.1:5432/mushroom';
  let target;
  try {
    target = databaseTarget(databaseUrl);
  } catch (cause) {
    const message = `DATABASE_URL 无法解析。未写出备份。${cause.message}`;
    error(message);
    return { exitCode: 1, file: null, errorMessage: publicBackupError(message) };
  }

  const selected = selectBackupMode(which, env);
  if (!selected.mode) {
    error(selected.reason);
    return { exitCode: 1, file: null, errorMessage: publicBackupError(selected.reason) };
  }

  const { dir, file } = resolveBackupPath(repoRoot, env, now);
  await mkdirImpl(dir, { recursive: true });
  const command = buildBackupCommand({
    mode: selected.mode,
    file,
    databaseUrl: target.databaseUrl,
    user: target.user,
    database: target.database,
    cwd: repoRoot,
  });
  command.env = env;
  log(
    `Postgres 备份写入 ${file}（${selected.mode}）。Redis 不在此文件中。MinIO 对象在独立数据卷，不在此文件中。`,
  );
  log('恢复步骤见 docs/OPS_STORAGE_BACKUP.md。');

  const result = await spawnCommand(command);
  if (result.code !== 0) {
    const message = `备份失败，退出码 ${result.code}。${result.stderr || ''}`.trim();
    error(message);
    return { exitCode: result.code || 1, file, errorMessage: publicBackupError(message) };
  }

  let size = 0;
  try {
    size = (await statImpl(file)).size;
  } catch (cause) {
    const message = `备份文件不可读：${cause.message}`;
    error(message);
    return { exitCode: 1, file, errorMessage: publicBackupError(message) };
  }
  if (!size) {
    const message = '备份文件为空，不当作成功。';
    error(message);
    return { exitCode: 1, file, errorMessage: publicBackupError(message) };
  }
  log(`Postgres 备份完成：${file}（${size} 字节）。`);
  return { exitCode: 0, file, bytes: size };
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  const started = new Date();
  const result = await runBackup({ now: started });
  const databaseUrl =
    process.env.DATABASE_URL?.trim() || 'postgres://mushroom:mushroom@127.0.0.1:5432/mushroom';
  const row = backupRunRow({ result, now: new Date(), triggeredBy: 'make-backup' });
  const recorded = await recordBackupRun({ databaseUrl, row });
  if (recorded.ok) {
    console.log(`备份记录已写入。页面可看最近一次${row.status === 'success' ? '成功' : '失败'}。`);
  } else {
    console.error(recorded.reason);
  }
  process.exit(result.exitCode);
}
