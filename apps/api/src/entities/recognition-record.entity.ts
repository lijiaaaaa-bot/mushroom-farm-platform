import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('recognition_records')
@Index(['shedCode', 'recognizedAt'])
@Index(['cameraCode', 'recognizedAt'])
export class RecognitionRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  idempotencyKey: string;

  @Column()
  shedCode: string;

  @Column()
  cameraCode: string;

  @Column({ type: 'timestamptz' })
  recognizedAt: Date;

  @Column({ type: 'int' })
  mushroomCount: number;

  @Column({ type: 'int' })
  matureCount: number;

  @Column({ type: 'jsonb', default: [] })
  capDiameters: number[];

  @Column({ type: 'float', nullable: true })
  avgCapDiameter: number | null;

  @Column({ type: 'int', default: 0 })
  diseaseCount: number;

  @Column({ type: 'int', default: 0 })
  diseaseLevel: number;

  @Column({ type: 'varchar', nullable: true })
  snapshotObjectKey: string | null;

  @Column({ type: 'varchar', nullable: true })
  snapshotUrl: string | null;

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
