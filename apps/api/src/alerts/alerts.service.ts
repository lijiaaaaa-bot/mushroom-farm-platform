import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser } from '../common/auth-user';
import { ListQuery, parsePage } from '../common/pagination';
import { ShedScope } from '../common/shed-scope';
import {
  ERROR_CODES,
  type AlertLevel,
  type AlertMetric,
  isAlertLevel,
  isAlertMetric,
  transitionError,
} from '@mushroom/contracts';
import { AlertRule } from '../entities/alert-rule.entity';
import { Alert } from '../entities/alert.entity';

@Injectable()
export class AlertsService {
  constructor(
    @InjectRepository(Alert) private readonly alerts: Repository<Alert>,
    @InjectRepository(AlertRule) private readonly rules: Repository<AlertRule>,
  ) {}

  async list(user: AuthUser, query: ListQuery) {
    const scope = ShedScope.fromUser(user);
    if (query.shedCode) scope.assert(query.shedCode);
    const page = parsePage(query);
    const qb = this.alerts
      .createQueryBuilder('a')
      .orderBy('a.createdAt', 'DESC');
    this.applyScope(qb, scope);
    if (query.shedCode)
      qb.andWhere('a.shedCode = :shedCode', { shedCode: query.shedCode });
    if (query.status)
      qb.andWhere('a.status = :status', { status: query.status });
    if (query.level) qb.andWhere('a.level = :level', { level: query.level });
    const [items, total] = await qb
      .skip(page.skip)
      .take(page.pageSize)
      .getManyAndCount();
    return { items, total, page: page.page, pageSize: page.pageSize };
  }

  async create(
    user: AuthUser,
    input: {
      shedCode: string;
      cameraCode?: string;
      level: string;
      title: string;
      message: string;
    },
  ) {
    ShedScope.fromUser(user).assert(input.shedCode);
    if (!isAlertLevel(input.level))
      throw new BadRequestException('告警等级无效');
    return this.alerts.save(
      this.alerts.create({
        ruleId: null,
        metric: null,
        shedCode: input.shedCode,
        cameraCode: input.cameraCode ?? null,
        level: input.level,
        status: 'open',
        title: input.title,
        message: input.message,
        metricValue: null,
        threshold: null,
        ackedBy: null,
        ackedAt: null,
        ackNote: null,
        closedBy: null,
        closedAt: null,
        closeNote: null,
      }),
    );
  }

  async ack(user: AuthUser, id: string, note?: string) {
    const alert = await this.require(user, id);
    const error = transitionError(alert.status, 'acked');
    if (error) {
      throw new BadRequestException({
        code: ERROR_CODES.INVALID_TRANSITION,
        message: error,
      });
    }
    alert.status = 'acked';
    alert.ackedBy = user.username;
    alert.ackedAt = new Date();
    alert.ackNote = note ?? null;
    return this.alerts.save(alert);
  }

  async close(user: AuthUser, id: string, note?: string) {
    const alert = await this.require(user, id);
    const error = transitionError(alert.status, 'closed');
    if (error) {
      throw new BadRequestException({
        code: ERROR_CODES.INVALID_TRANSITION,
        message: error,
      });
    }
    alert.status = 'closed';
    alert.closedBy = user.username;
    alert.closedAt = new Date();
    alert.closeNote = note ?? null;
    if (!alert.ackedAt) {
      alert.ackedBy = user.username;
      alert.ackedAt = alert.closedAt;
      alert.ackNote = alert.ackNote ?? '关闭时自动确认';
    }
    return this.alerts.save(alert);
  }

  async listRules(user: AuthUser) {
    const scope = ShedScope.fromUser(user);
    const rules = await this.rules.find({ order: { createdAt: 'ASC' } });
    return rules.filter(
      (rule) => !rule.shedCode || scope.allows(rule.shedCode),
    );
  }

  async createRule(
    user: AuthUser,
    input: {
      name: string;
      metric: string;
      threshold: number;
      level: string;
      shedCode?: string | null;
      windowMinutes?: number;
    },
  ) {
    if (input.shedCode) ShedScope.fromUser(user).assert(input.shedCode);
    if (!isAlertMetric(input.metric))
      throw new BadRequestException('告警指标无效');
    if (!isAlertLevel(input.level))
      throw new BadRequestException('告警等级无效');
    return this.rules.save(
      this.rules.create({
        name: input.name,
        metric: input.metric as AlertMetric,
        threshold: Number(input.threshold),
        level: input.level as AlertLevel,
        shedCode: input.shedCode ?? null,
        enabled: true,
        windowMinutes: input.windowMinutes ?? 720,
      }),
    );
  }

  async updateRule(
    user: AuthUser,
    id: string,
    patch: {
      enabled?: boolean;
      threshold?: number;
      level?: string;
      name?: string;
      windowMinutes?: number;
    },
  ) {
    const rule = await this.rules.findOne({ where: { id } });
    if (!rule) throw new NotFoundException('规则不存在');
    if (rule.shedCode) ShedScope.fromUser(user).assert(rule.shedCode);
    if (patch.name !== undefined) rule.name = patch.name;
    if (patch.enabled !== undefined) rule.enabled = patch.enabled;
    if (patch.threshold !== undefined) rule.threshold = Number(patch.threshold);
    if (patch.windowMinutes !== undefined)
      rule.windowMinutes = patch.windowMinutes;
    if (patch.level !== undefined) {
      if (!isAlertLevel(patch.level))
        throw new BadRequestException('告警等级无效');
      rule.level = patch.level;
    }
    return this.rules.save(rule);
  }

  private async require(user: AuthUser, id: string) {
    const alert = await this.alerts.findOne({ where: { id } });
    if (!alert) throw new NotFoundException('告警不存在');
    ShedScope.fromUser(user).assert(alert.shedCode);
    return alert;
  }

  private applyScope(
    qb: ReturnType<Repository<Alert>['createQueryBuilder']>,
    scope: ShedScope,
  ) {
    if (!scope.codes) return;
    if (!scope.codes.length) qb.andWhere('1 = 0');
    else qb.andWhere('a.shedCode IN (:...codes)', { codes: scope.codes });
  }
}
