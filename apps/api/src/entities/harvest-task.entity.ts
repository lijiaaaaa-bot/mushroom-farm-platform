import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const HARVEST_TASK_STATUSES = ['open', 'scheduled', 'done'] as const;
export type HarvestTaskStatus = (typeof HARVEST_TASK_STATUSES)[number];

export const HARVEST_SHIFTS = ['morning', 'afternoon'] as const;
export type HarvestShift = (typeof HARVEST_SHIFTS)[number];

@Entity('harvest_tasks')
@Index(['taskDate', 'shedCode', 'cameraCode'], { unique: true })
export class HarvestTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'date' })
  taskDate: string;

  @Column()
  shedCode: string;

  @Column()
  cameraCode: string;

  @Column({ type: 'int' })
  matureCount: number;

  @Column({ type: 'int' })
  mushroomCount: number;

  @Column({ type: 'varchar', length: 16, default: 'open' })
  status: HarvestTaskStatus;

  @Column({ type: 'varchar', nullable: true })
  assignee: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  shift: HarvestShift | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
