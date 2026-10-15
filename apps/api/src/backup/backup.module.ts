import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PostgresBackupRun } from '../entities/postgres-backup-run.entity';
import { BackupController } from './backup.controller';
import { BACKUP_RUNNER, runPostgresBackup } from './backup.runner';
import { BackupService } from './backup.service';

@Module({
  imports: [TypeOrmModule.forFeature([PostgresBackupRun])],
  controllers: [BackupController],
  providers: [
    BackupService,
    { provide: BACKUP_RUNNER, useValue: runPostgresBackup },
  ],
})
export class BackupModule {}
