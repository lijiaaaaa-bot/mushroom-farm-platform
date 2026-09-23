import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('ingest_rejects')
export class IngestReject {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  source: 'http' | 'mqtt';

  @Column({ type: 'jsonb' })
  errors: string[];

  @Column({ type: 'jsonb', nullable: true })
  payload: unknown;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
