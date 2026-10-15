import { Column, Entity, PrimaryColumn } from 'typeorm';

/** 全场一行。默认与契约 IMAGE_RETENTION_DAYS、TIMESERIES_RETENTION_DAYS、ALERT_UNREAD_POLL_SECONDS 相同。 */
@Entity('system_params')
export class SystemParam {
  @PrimaryColumn({ type: 'smallint' })
  id: number;

  @Column({ type: 'int' })
  imageRetentionDays: number;

  @Column({ type: 'int' })
  timeseriesRetentionDays: number;

  @Column({ type: 'int' })
  alertUnreadPollSeconds: number;

  @Column({ type: 'timestamptz', nullable: true })
  updatedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  updatedBy: string | null;
}
