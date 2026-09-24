import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const FLUSH_PHASES = ['flush', 'fast_growth', 'mature'] as const;
export type FlushPhase = (typeof FLUSH_PHASES)[number];

@Entity('flush_batches')
@Index(['shedCode', 'batchCode'], { unique: true })
export class FlushBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  shedCode: string;

  @Column()
  batchCode: string;

  @Column({ type: 'timestamptz' })
  startedAt: Date;

  @Column({ type: 'varchar', length: 32 })
  phase: FlushPhase;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('flush_phase_events')
@Index(['batchId', 'occurredAt'])
export class FlushPhaseEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  batchId: string;

  @Column({ type: 'varchar', length: 32 })
  phase: FlushPhase;

  @Column({ type: 'timestamptz' })
  occurredAt: Date;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'varchar', nullable: true })
  recordedBy: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
