import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BACKUP_RUNNER = 'BACKUP_RUNNER';

export interface BackupRunResult {
  exitCode: number;
  file: string | null;
  bytes?: number;
  errorMessage?: string;
}

export type BackupRunner = (now: Date) => Promise<BackupRunResult>;

/** 调用现有 `scripts/backup-postgres.mjs`。页面上的时间由服务写入，不在脚本里再写一行。 */
export async function runPostgresBackup(
  now = new Date(),
): Promise<BackupRunResult> {
  const script = join(__dirname, '../../../../scripts/backup-postgres.mjs');
  // tsc 会把 file URL 的动态 import 收成 require，运行时 500。用 Function 保住真正的 import。
  const dynamicImport = new Function('u', 'return import(u)') as (
    u: string,
  ) => Promise<{
    runBackup: (args: { now: Date }) => Promise<BackupRunResult>;
  }>;
  const loaded = await dynamicImport(pathToFileURL(script).href);
  const result = await loaded.runBackup({ now });
  return {
    exitCode: result.exitCode,
    file: result.file ?? null,
    bytes: result.bytes,
    errorMessage: result.errorMessage,
  };
}
