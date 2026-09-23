import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Public } from '../common/decorators';
import {
  ALERT_LEVELS,
  ALERT_METRICS,
  ALERT_STATUSES,
  CONTRACT_VERSION,
  DEVICE_TYPES,
  IMAGE_RETENTION_DAYS,
  INGEST_HTTP_PATH,
  LIMITS,
  MQTT_HEARTBEAT_TOPIC,
  MQTT_RECOGNITION_TOPIC,
  ROLES,
  SNAPSHOT_KEY_PATTERN,
  TIMESERIES_RETENTION_DAYS,
} from '@mushroom/contracts';

@Controller()
export class MetaController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Public()
  @Get('health')
  async health() {
    await this.dataSource.query('SELECT 1');
    return {
      ok: true,
      service: 'mushroom-farm-api',
      time: new Date().toISOString(),
    };
  }

  @Public()
  @Get('meta/contracts')
  contracts() {
    return {
      version: CONTRACT_VERSION,
      frozen: ['ingestDto', 'alertStates', 'rbac', 'mqttTopics', 'snapshotKey'],
      ingest: {
        http: `POST ${INGEST_HTTP_PATH}`,
        header: 'X-Ingest-Token',
        mqttRecognition: MQTT_RECOGNITION_TOPIC,
        mqttHeartbeat: MQTT_HEARTBEAT_TOPIC,
      },
      alertStatuses: ALERT_STATUSES,
      alertLevels: ALERT_LEVELS,
      alertMetrics: ALERT_METRICS,
      roles: ROLES,
      deviceTypes: DEVICE_TYPES,
      snapshotKey: SNAPSHOT_KEY_PATTERN,
      retention: {
        imageDays: IMAGE_RETENTION_DAYS,
        timeseriesDays: TIMESERIES_RETENTION_DAYS,
      },
      limits: LIMITS,
    };
  }
}
