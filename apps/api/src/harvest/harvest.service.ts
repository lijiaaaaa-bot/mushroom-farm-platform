import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser } from '../common/auth-user';
import { ShedScope } from '../common/shed-scope';
import { shanghaiDayRange, todayShanghai } from '@mushroom/contracts';
import { RecognitionRecord } from '../entities/recognition-record.entity';

export interface HarvestItem {
  id: string;
  shedCode: string;
  cameraCode: string;
  recognizedAt: Date;
  mushroomCount: number;
  matureCount: number;
  avgCapDiameter: number | null;
  diseaseCount: number;
  diseaseLevel: number;
}

@Injectable()
export class HarvestService {
  constructor(
    @InjectRepository(RecognitionRecord)
    private readonly records: Repository<RecognitionRecord>,
  ) {}

  async daily(user: AuthUser, date?: string) {
    const day = date || todayShanghai();
    const items = await this.latestPerCamera(user, day);
    const summary = {
      date: day,
      cameraCount: items.length,
      harvestableCameras: items.filter((item) => item.matureCount > 0).length,
      mushroomCount: items.reduce((sum, item) => sum + item.mushroomCount, 0),
      matureCount: items.reduce((sum, item) => sum + item.matureCount, 0),
    };
    return { date: day, summary, items };
  }

  async latestPerCamera(user: AuthUser, date: string): Promise<HarvestItem[]> {
    const scope = ShedScope.fromUser(user);
    const { start, end } = shanghaiDayRange(date);
    const rows = await this.records.query(
      `
      SELECT DISTINCT ON (camera_code)
        id,
        shed_code AS "shedCode",
        camera_code AS "cameraCode",
        recognized_at AS "recognizedAt",
        mushroom_count AS "mushroomCount",
        mature_count AS "matureCount",
        avg_cap_diameter AS "avgCapDiameter",
        disease_count AS "diseaseCount",
        disease_level AS "diseaseLevel"
      FROM recognition_records
      WHERE recognized_at >= $1 AND recognized_at < $2
        AND ($3::text[] IS NULL OR shed_code = ANY($3::text[]))
      ORDER BY camera_code, recognized_at DESC
      `,
      [start, end, scope.sqlParam()],
    );
    return rows as HarvestItem[];
  }
}
