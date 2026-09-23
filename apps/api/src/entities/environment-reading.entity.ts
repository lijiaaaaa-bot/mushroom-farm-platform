import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('environment_readings')
@Index(['shedCode', 'observedAt'])
export class EnvironmentReading {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  idempotencyKey: string;

  @Column()
  shedCode: string;

  @Column()
  sensorCode: string;

  @Column({ type: 'timestamptz' })
  observedAt: Date;

  @Column({ type: 'float', nullable: true })
  temperature: number | null;

  @Column({ type: 'float', nullable: true })
  humidity: number | null;

  @Column({ type: 'float', nullable: true })
  co2: number | null;

  @Column({ type: 'float', nullable: true })
  substrateMoisture: number | null;

  @Column({ type: 'varchar' })
  source: 'http' | 'mqtt';

  @Column({ type: 'jsonb', nullable: true })
  rawPayload: unknown;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
