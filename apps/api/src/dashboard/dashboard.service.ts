import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser } from '../common/auth-user';
import { ShedScope } from '../common/shed-scope';
import { Alert } from '../entities/alert.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import { Shed } from '../entities/shed.entity';
import { DevicesService } from '../devices';
import { GrowthTrendService } from '../growth';

@Injectable()
export class DashboardService {
  constructor(
    private readonly devices: DevicesService,
    @InjectRepository(Alert) private readonly alerts: Repository<Alert>,
    @InjectRepository(Shed) private readonly sheds: Repository<Shed>,
    @InjectRepository(RecognitionRecord)
    private readonly records: Repository<RecognitionRecord>,
    private readonly growth: GrowthTrendService,
  ) {}

  async overview(user: AuthUser) {
    const scope = ShedScope.fromUser(user);
    const today = await this.growth.todaySnapshot(scope);
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
    const trend = await this.growth.trendFromDayBuckets(scope);
    const env = await this.growth.latestEnvironment(scope);
    return {
      shedCount,
      deviceTotal: deviceCounts.total,
      deviceOnline: deviceCounts.online,
      todayMushroom: today.mushroomCount,
      todayMature: today.matureCount,
      harvestableCameras: today.harvestableCameras,
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
}
