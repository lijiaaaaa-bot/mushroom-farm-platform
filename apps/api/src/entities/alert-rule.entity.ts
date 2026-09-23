import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AlertLevel, AlertMetric } from '@mushroom/contracts';

@Entity('alert_rules')
export class AlertRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'varchar' })
  metric: AlertMetric;

  @Column({ type: 'float' })
  threshold: number;

  @Column({ type: 'varchar' })
  level: AlertLevel;

  @Column({ type: 'varchar', nullable: true })
  shedCode: string | null;

  @Column({ default: true })
  enabled: boolean;

  @Column({ type: 'int', default: 720 })
  windowMinutes: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
