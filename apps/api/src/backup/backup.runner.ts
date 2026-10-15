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
export async function runPostgresBackup(now = new Date()): Promise<BackupRunResult> {
  const script = join(__dirname, '../../../../scripts/backup-postgres.mjs');
  const loaded = await import(pathToFileURL(script).href);
  const result = await loaded.runBackup({ now });
  return {
    exitCode: result.exitCode,
    file: result.file ?? null,
    bytes: result.bytes,
    errorMessage: result.errorMessage,
  };
}
