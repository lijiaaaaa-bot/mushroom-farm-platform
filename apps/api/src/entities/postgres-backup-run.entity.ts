import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('postgres_backup_runs')
export class PostgresBackupRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  status: 'success' | 'failed';

  @Column({ type: 'timestamptz' })
  finishedAt: Date;

  @Column({ type: 'varchar', nullable: true })
  fileName: string | null;

  @Column({ type: 'bigint', nullable: true })
  bytes: string | number | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'varchar', nullable: true })
  triggeredBy: string | null;
}
