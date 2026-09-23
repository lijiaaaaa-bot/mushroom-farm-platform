import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** 站内未读按登录用户记，不改告警 open/acked/closed。 */
@Entity('alert_reads')
@Index(['userId', 'alertId'], { unique: true })
export class AlertRead {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  /** 与 alerts.id 同为 uuid。varchar 时未读 left join 会报 character varying = uuid。 */
  @Column({ type: 'uuid' })
  alertId: string;

  @CreateDateColumn({ type: 'timestamptz' })
  readAt: Date;
}
