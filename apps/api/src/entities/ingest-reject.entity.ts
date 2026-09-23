import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type IngestChannel = 'recognition' | 'environment' | 'heartbeat';

@Entity('ingest_rejects')
export class IngestReject {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ default: 'recognition' })
  channel: IngestChannel;

  @Column()
  source: 'http' | 'mqtt';

  @Column({ type: 'varchar', nullable: true })
  shedCode: string | null;

  @Column({ type: 'varchar', nullable: true })
  code: string | null;

  @Column({ type: 'jsonb' })
  errors: string[];

  @Column({ type: 'jsonb', nullable: true })
  payload: unknown;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
