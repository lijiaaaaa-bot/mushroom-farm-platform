import { spawn } from 'node:child_process';
import { accessSync, constants, createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
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
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    if (command.stdoutFile) {
      const out = createWriteStream(command.stdoutFile);
      child.stdout.pipe(out);
      child.on('close', (code) => {
        out.end();
        out.on('finish', () => resolvePromise({ code: code ?? 1, stderr }));
        out.on('error', () => resolvePromise({ code: code ?? 1, stderr }));
      });
      return;
    }
    child.stdout.resume();
    child.on('close', (code) => resolvePromise({ code: code ?? 1, stderr }));
  });
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
    error(`DATABASE_URL 无法解析。未写出备份。${cause.message}`);
    return { exitCode: 1, file: null };
  }

  const selected = selectBackupMode(which, env);
  if (!selected.mode) {
    error(selected.reason);
    return { exitCode: 1, file: null };
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
  log(
    `Postgres 备份写入 ${file}（${selected.mode}）。Redis 不在此文件中。MinIO 对象在独立数据卷，不在此文件中。`,
  );
  log('恢复步骤见 docs/OPS_STORAGE_BACKUP.md。');

  const result = await spawnCommand(command);
  if (result.code !== 0) {
    error(`备份失败，退出码 ${result.code}。${result.stderr || ''}`.trim());
    return { exitCode: result.code || 1, file };
  }

  let size = 0;
  try {
    size = (await statImpl(file)).size;
  } catch (cause) {
    error(`备份文件不可读：${cause.message}`);
    return { exitCode: 1, file };
  }
  if (!size) {
    error('备份文件为空，不当作成功。');
    return { exitCode: 1, file };
  }
  log(`Postgres 备份完成：${file}（${size} 字节）。`);
  return { exitCode: 0, file, bytes: size };
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  const result = await runBackup();
  process.exit(result.exitCode);
}
