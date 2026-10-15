import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { BackupStatus, parseBackupStatus } from '@mushroom/contracts';
import { Repository } from 'typeorm';
import { AuthUser } from '../common/auth-user';
import { PostgresBackupRun } from '../entities/postgres-backup-run.entity';
import { BACKUP_RUNNER, BackupRunner } from './backup.runner';

export function publicBackupError(message: string | null | undefined): string {
  const text = String(message ?? '')
    .replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgresql://…')
    .replace(/\s+/g, ' ')
    .trim();
  return (text || '备份失败').slice(0, 500);
}

export function backupFileName(file: string | null | undefined): string | null {
  if (!file) return null;
  const name = file.split(/[/\\]/).pop() ?? '';
  if (!name || name === '.' || name === '..') return null;
  return name;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function asBytes(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
  return parsed;
}

export function presentBackupStatus(
  latest: PostgresBackupRun | null,
  success: PostgresBackupRun | null,
): BackupStatus {
  const body = {
    lastSuccessAt: iso(success?.finishedAt),
    lastRunAt: iso(latest?.finishedAt),
    lastStatus: latest ? latest.status : ('never' as const),
    lastFileName: latest?.fileName ?? null,
    lastBytes: latest ? asBytes(latest.bytes) : null,
    lastError:
      latest?.status === 'failed'
        ? publicBackupError(latest.errorMessage)
        : null,
    triggeredBy: latest?.triggeredBy ?? null,
  };
  const parsed = parseBackupStatus(body);
  if (!parsed.ok) throw new InternalServerErrorException('备份状态无法读取');
  return parsed.value;
}

@Injectable()
export class BackupService {
  constructor(
    @InjectRepository(PostgresBackupRun)
    private readonly runs: Repository<PostgresBackupRun>,
    @Inject(BACKUP_RUNNER) private readonly runner: BackupRunner,
  ) {}

  async status(): Promise<BackupStatus> {
    const [latest] = await this.runs.find({
      order: { finishedAt: 'DESC' },
      take: 1,
    });
    const [success] = await this.runs.find({
      where: { status: 'success' },
      order: { finishedAt: 'DESC' },
      take: 1,
    });
    return presentBackupStatus(latest ?? null, success ?? null);
  }

  async run(actor: AuthUser): Promise<BackupStatus> {
    const started = new Date();
    const result = await this.runner(started);
    const finishedAt = new Date();
    const success = result.exitCode === 0;
    const bytes = result.bytes;
    await this.runs.save(
      this.runs.create({
        status: success ? 'success' : 'failed',
        finishedAt,
        fileName: backupFileName(result.file),
        bytes:
          success && Number.isSafeInteger(bytes) && (bytes ?? 0) >= 0
            ? bytes
            : null,
        errorMessage: success ? null : publicBackupError(result.errorMessage),
        triggeredBy: actor.username.slice(0, 120),
      }),
    );
    return this.status();
  }
}
