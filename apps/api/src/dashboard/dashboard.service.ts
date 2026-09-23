import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser } from '../common/auth-user';
import { ShedScope } from '../common/shed-scope';
import { todayShanghai } from '@mushroom/contracts';
import { Alert } from '../entities/alert.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import { Shed } from '../entities/shed.entity';
import { DevicesService } from '../devices';
import { HarvestService } from '../harvest';

@Injectable()
export class DashboardService {
  constructor(
    private readonly harvest: HarvestService,
    private readonly devices: DevicesService,
    @InjectRepository(Alert) private readonly alerts: Repository<Alert>,
    @InjectRepository(Shed) private readonly sheds: Repository<Shed>,
    @InjectRepository(RecognitionRecord)
    private readonly records: Repository<RecognitionRecord>,
  ) {}

  async overview(user: AuthUser) {
    const scope = ShedScope.fromUser(user);
    const daily = await this.harvest.daily(user, todayShanghai());
    const deviceCounts = await this.devices.counts(user);
    const shedQb = this.sheds.createQueryBuilder('s');
    if (scope.codes) {
      if (!scope.codes.length) shedQb.andWhere('1 = 0');
      else shedQb.andWhere('s.code IN (:...codes)', { codes: scope.codes });
    }
    const shedCount = await shedQb.getCount();
    const alertQb = this.alerts
      .createQueryBuilder('a')
      .where('a.status IN (:...st)', {
        st: ['open', 'acked'],
      });
    if (scope.codes) {
      if (!scope.codes.length) alertQb.andWhere('1 = 0');
      else
        alertQb.andWhere('a.shedCode IN (:...codes)', { codes: scope.codes });
    }
    const openAlerts = await alertQb.getCount();
    const severeAlerts = await alertQb
      .clone()
      .andWhere('a.level = :level', { level: 'severe' })
      .getCount();
    const recentAlerts = await alertQb
      .clone()
      .orderBy('a.createdAt', 'DESC')
      .take(6)
      .getMany();
    const recentRecords = await this.recent(scope);
    const trend = await this.trend(scope);
    const env = this.envOf(recentRecords);
    return {
      shedCount,
      deviceTotal: deviceCounts.total,
      deviceOnline: deviceCounts.online,
      todayMushroom: daily.summary.mushroomCount,
      todayMature: daily.summary.matureCount,
      harvestableCameras: daily.summary.harvestableCameras,
      openAlerts,
      severeAlerts,
      env,
      trend,
      recentAlerts,
      recentRecords,
    };
  }

  private async recent(scope: ShedScope) {
    const qb = this.records
      .createQueryBuilder('r')
      .orderBy('r.recognizedAt', 'DESC')
      .take(8);
    if (scope.codes) {
      if (!scope.codes.length) qb.andWhere('1 = 0');
      else qb.andWhere('r.shedCode IN (:...codes)', { codes: scope.codes });
    }
    return qb.getMany();
  }

  private async trend(scope: ShedScope) {
    const rows = await this.records.query(
      `
      SELECT day::text AS day,
             SUM(mushroom_count)::int AS mushroom,
             SUM(mature_count)::int AS mature,
             SUM(disease_count)::int AS disease
      FROM (
        SELECT DISTINCT ON (camera_code, (recognized_at AT TIME ZONE 'Asia/Shanghai')::date)
          camera_code,
          (recognized_at AT TIME ZONE 'Asia/Shanghai')::date AS day,
          mushroom_count,
          mature_count,
          disease_count
        FROM recognition_records
        WHERE recognized_at > NOW() - INTERVAL '7 days'
          AND ($1::text[] IS NULL OR shed_code = ANY($1::text[]))
        ORDER BY camera_code, (recognized_at AT TIME ZONE 'Asia/Shanghai')::date, recognized_at DESC
      ) latest
      GROUP BY day
      ORDER BY day
      `,
      [scope.sqlParam()],
    );
    return rows as {
      day: string;
      mushroom: number;
      mature: number;
      disease: number;
    }[];
  }

  private envOf(records: RecognitionRecord[]) {
    const avg = (pick: (row: RecognitionRecord) => number | null) => {
      const values = records
        .map(pick)
        .filter((value): value is number => value !== null);
      if (!values.length) return null;
      return (
        Math.round(
          (values.reduce((sum, value) => sum + value, 0) / values.length) * 10,
        ) / 10
      );
    };
    return {
      avgTemp: avg((row) => row.temperature),
      avgHumidity: avg((row) => row.humidity),
      avgCo2: avg((row) => row.co2),
      avgSubstrateMoisture: avg((row) => row.substrateMoisture),
    };
  }
}
