import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('heartbeat_receipts')
@Index(['shedCode', 'createdAt'])
export class HeartbeatReceipt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  source: 'http' | 'mqtt';

  @Column()
  shedCode: string;

  @Column()
  deviceCode: string;

  @Column({ default: false })
  duplicate: boolean;

  @Column({ type: 'int', nullable: true })
  latencyMs: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
