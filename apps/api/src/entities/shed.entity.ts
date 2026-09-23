import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('sheds')
export class Shed {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  code: string;

  @Column()
  name: string;

  @Column({ type: 'varchar', nullable: true })
  location: string | null;

  /** 平面示意图横坐标，0–100。空值表示尚未配置。 */
  @Column({ type: 'double precision', nullable: true })
  mapX: number | null;

  /** 平面示意图纵坐标，0–100。空值表示尚未配置。 */
  @Column({ type: 'double precision', nullable: true })
  mapY: number | null;

  @Column({ default: true })
  enabled: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
