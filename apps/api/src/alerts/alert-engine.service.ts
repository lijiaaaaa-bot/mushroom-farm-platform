import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  ALERT_METRIC_LABEL,
  AlertMetric,
  isAlertMetric,
} from '@mushroom/contracts';
import { AlertRule } from '../entities/alert-rule.entity';
import { Alert } from '../entities/alert.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';

@Injectable()
export class AlertEngineService {
  private readonly logger = new Logger(AlertEngineService.name);

  constructor(
    @InjectRepository(AlertRule) private readonly rules: Repository<AlertRule>,
    @InjectRepository(Alert) private readonly alerts: Repository<Alert>,
    @InjectRepository(RecognitionRecord)
    private readonly records: Repository<RecognitionRecord>,
  ) {}

  async evaluate(record: RecognitionRecord): Promise<void> {
    const rules = await this.rules.find({ where: { enabled: true } });
    for (const rule of rules) {
      if (rule.shedCode && rule.shedCode !== record.shedCode) continue;
      if (!isAlertMetric(rule.metric)) continue;
      const previous =
        rule.metric === 'growth_stall'
          ? await this.previous(record, rule.windowMinutes)
          : null;
      const value = this.metricValue(rule.metric, record, previous);
      if (value === null || !this.triggered(rule.metric, value, rule.threshold))
        continue;
      const open = await this.alerts.findOne({
        where: {
          ruleId: rule.id,
          cameraCode: record.cameraCode,
          status: In(['open', 'acked']),
        },
      });
      if (open) continue;
      const label = ALERT_METRIC_LABEL[rule.metric];
      await this.alerts.save(
        this.alerts.create({
          ruleId: rule.id,
          metric: rule.metric,
          shedCode: record.shedCode,
          cameraCode: record.cameraCode,
          level: rule.level,
          status: 'open',
          title: `${label}告警`,
          message: this.message(
            rule.metric,
            label,
            record,
            value,
            rule.threshold,
          ),
          metricValue: value,
          threshold: rule.threshold,
          ackedBy: null,
          ackedAt: null,
          ackNote: null,
          closedBy: null,
          closedAt: null,
          closeNote: null,
        }),
      );
      this.logger.log(
        `告警 ${rule.metric} ${record.shedCode}/${record.cameraCode}`,
      );
    }
  }

  private async previous(record: RecognitionRecord, windowMinutes: number) {
    const before = new Date(
      record.recognizedAt.getTime() - windowMinutes * 60 * 1000,
    );
    return this.records
      .createQueryBuilder('r')
      .where('r.cameraCode = :camera', { camera: record.cameraCode })
      .andWhere('r.recognizedAt <= :before', { before })
      .orderBy('r.recognizedAt', 'DESC')
      .getOne();
  }

  private metricValue(
    metric: AlertMetric,
    record: RecognitionRecord,
    previous: RecognitionRecord | null,
  ): number | null {
    switch (metric) {
      case 'mature_ratio':
        return record.mushroomCount > 0
          ? record.matureCount / record.mushroomCount
          : 0;
      case 'mature_count':
        return record.matureCount;
      case 'disease_count':
        return record.diseaseCount;
      case 'disease_level':
        return record.diseaseLevel;
      case 'temperature_high':
      case 'temperature_low':
        return record.temperature;
      case 'humidity_high':
      case 'humidity_low':
        return record.humidity;
      case 'co2_high':
        return record.co2;
      case 'substrate_moisture_low':
        return record.substrateMoisture;
      case 'growth_stall':
        if (
          !previous ||
          previous.avgCapDiameter === null ||
          record.avgCapDiameter === null
        ) {
          return null;
        }
        return record.avgCapDiameter - previous.avgCapDiameter;
      default:
        return null;
    }
  }

  private triggered(
    metric: AlertMetric,
    value: number,
    threshold: number,
  ): boolean {
    if (metric === 'growth_stall' || metric.endsWith('_low'))
      return value < threshold;
    if (metric.endsWith('_high')) return value > threshold;
    return value >= threshold;
  }

  private message(
    metric: AlertMetric,
    label: string,
    record: RecognitionRecord,
    value: number,
    threshold: number,
  ): string {
    const shown =
      metric === 'mature_ratio' ? `${Math.round(value * 100)}%` : `${value}`;
    const limit =
      metric === 'mature_ratio'
        ? `${Math.round(threshold * 100)}%`
        : `${threshold}`;
    return `棚区 ${record.shedCode} 摄像头 ${record.cameraCode} ${label} ${shown}，阈值 ${limit}`;
  }
}
