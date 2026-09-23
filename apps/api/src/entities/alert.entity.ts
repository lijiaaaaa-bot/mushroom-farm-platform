import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AlertLevel, AlertStatus } from '@mushroom/contracts';

@Entity('alerts')
@Index(['shedCode', 'status'])
export class Alert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', nullable: true })
  ruleId: string | null;

  @Column({ type: 'varchar', nullable: true })
  metric: string | null;

  @Column()
  shedCode: string;

  @Column({ type: 'varchar', nullable: true })
  cameraCode: string | null;

  @Column({ type: 'varchar' })
  level: AlertLevel;

  @Column({ type: 'varchar', default: 'open' })
  status: AlertStatus;

  @Column()
  title: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'float', nullable: true })
  metricValue: number | null;

  @Column({ type: 'float', nullable: true })
  threshold: number | null;

  @Column({ type: 'varchar', nullable: true })
  ackedBy: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  ackedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  ackNote: string | null;

  @Column({ type: 'varchar', nullable: true })
  closedBy: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  closeNote: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
