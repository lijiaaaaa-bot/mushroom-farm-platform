import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 小时/日指标桶的公共列。棚行 cameraCode 为空字符串。 */
export interface MetricBucketBase {
  id: string;
  shedCode: string;
  cameraCode: string;
  bucketStart: Date;
  metric: string;
  value: number | null;
  sampleCount: number;
  valueSum: number | null;
  latestAt: Date | null;
  updatedAt: Date;
}

@Entity('metric_buckets_hour')
@Index(['shedCode', 'cameraCode', 'bucketStart', 'metric'], { unique: true })
@Index(['bucketStart'])
export class MetricBucketHour implements MetricBucketBase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  shedCode: string;

  @Column({ default: '' })
  cameraCode: string;

  /** 上海整点。 */
  @Column({ type: 'timestamptz' })
  bucketStart: Date;

  @Column({ type: 'varchar', length: 64 })
  metric: string;

  @Column({ type: 'double precision', nullable: true })
  value: number | null;

  /** 样本数。菌盖均值只计有直径的记录；计数指标与 value 相同。 */
  @Column({ type: 'int', default: 0 })
  sampleCount: number;

  @Column({ type: 'double precision', nullable: true })
  valueSum: number | null;

  /** mushroom_count 记下贡献该值的 recognizedAt。 */
  @Column({ type: 'timestamptz', nullable: true })
  latestAt: Date | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('metric_buckets_day')
@Index(['shedCode', 'cameraCode', 'bucketStart', 'metric'], { unique: true })
@Index(['bucketStart'])
export class MetricBucketDay implements MetricBucketBase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  shedCode: string;

  @Column({ default: '' })
  cameraCode: string;

  /** 上海日历日零点。 */
  @Column({ type: 'timestamptz' })
  bucketStart: Date;

  @Column({ type: 'varchar', length: 64 })
  metric: string;

  @Column({ type: 'double precision', nullable: true })
  value: number | null;

  /** 样本数。菌盖均值只计有直径的记录；计数指标与 value 相同。 */
  @Column({ type: 'int', default: 0 })
  sampleCount: number;

  @Column({ type: 'double precision', nullable: true })
  valueSum: number | null;

  /** mushroom_count 记下贡献该值的 recognizedAt。 */
  @Column({ type: 'timestamptz', nullable: true })
  latestAt: Date | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
