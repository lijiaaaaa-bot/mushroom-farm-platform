import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DeviceType } from '@mushroom/contracts';

@Entity('devices')
export class Device {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  code: string;

  @Column()
  name: string;

  @Column({ type: 'varchar' })
  type: DeviceType;

  @Column()
  shedCode: string;

  @Column({ type: 'varchar', nullable: true })
  parentCode: string | null;

  @Column({ default: 'offline' })
  onlineStatus: 'online' | 'offline';

  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @Column({ type: 'jsonb', default: {} })
  meta: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
