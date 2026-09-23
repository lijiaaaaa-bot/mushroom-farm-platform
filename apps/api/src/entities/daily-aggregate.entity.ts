import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type AggregateGrain = 'shed' | 'camera';

/** 上海日历日的蘑菇数与菌盖直径均值。棚行 cameraCode 为空字符串。 */
@Entity('daily_aggregates')
@Index(['day', 'grain', 'shedCode', 'cameraCode'], { unique: true })
@Index(['shedCode', 'day'])
export class DailyAggregate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** YYYY-MM-DD，Asia/Shanghai。 */
  @Column({ type: 'varchar', length: 10 })
  day: string;

  @Column({ type: 'varchar' })
  grain: AggregateGrain;

  @Column()
  shedCode: string;

  @Column({ default: '' })
  cameraCode: string;

  /** 摄像头：当日最后一条识别的蘑菇数。棚：各摄像头该值之和。 */
  @Column({ type: 'int' })
  mushroomCount: number;

  /** 当日各条识别 avgCapDiameter 的算术平均；没有直径则为空。 */
  @Column({ type: 'double precision', nullable: true })
  capDiameterMean: number | null;

  @Column({ type: 'int' })
  sampleCount: number;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
