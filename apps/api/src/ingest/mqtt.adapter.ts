import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import mqtt, { MqttClient } from 'mqtt';
import {
  MQTT_HEARTBEAT_TOPIC,
  MQTT_RECOGNITION_TOPIC,
} from '@mushroom/contracts';
import { DevicesService } from '../devices';
import { IngestService } from './ingest.service';

/** MQTT 适配器：只解析 topic，然后交给与 HTTP 相同的规范 DTO 管道。 */
@Injectable()
export class MqttIngestAdapter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttIngestAdapter.name);
  private client: MqttClient | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly ingest: IngestService,
    private readonly devices: DevicesService,
  ) {}

  onModuleInit() {
    if (this.config.get<boolean>('mqttEnabled') === false) return;
    const url = this.config.get<string>('mqttUrl') || 'mqtt://127.0.0.1:1883';
    this.client = mqtt.connect(url, {
      reconnectPeriod: 5000,
      connectTimeout: 3000,
      clientId: `mushroom-api-${process.pid}`,
    });
    this.client.on('connect', () => {
      this.client?.subscribe(
        [MQTT_RECOGNITION_TOPIC, MQTT_HEARTBEAT_TOPIC],
        (error) => {
          if (error) this.logger.warn(`MQTT 订阅失败：${error.message}`);
          else this.logger.log(`MQTT 已订阅 ${MQTT_RECOGNITION_TOPIC}`);
        },
      );
    });
    this.client.on('error', (error) =>
      this.logger.warn(`MQTT 错误：${error.message}`),
    );
    this.client.on('message', (topic, payload) => {
      void this.onMessage(topic, payload);
    });
  }

  onModuleDestroy() {
    this.client?.end(true);
  }

  private async onMessage(topic: string, payload: Buffer) {
    const parts = topic.split('/');
    if (parts.length < 4 || parts[0] !== 'mushroom') return;
    const shedFromTopic = parts[1];
    const deviceFromTopic = parts[2];
    const kind = parts[3];
    let body: Record<string, unknown> = {};
    if (payload.length) {
      try {
        const parsed = JSON.parse(payload.toString('utf8')) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          body = parsed as Record<string, unknown>;
        }
      } catch {
        this.logger.warn(`MQTT 载荷不是 JSON：${topic}`);
        return;
      }
    }
    if (kind === 'recognition') {
      if (!body.shedCode && !body['棚区编号']) body.shedCode = shedFromTopic;
      if (!body.cameraCode && !body['摄像头编号'])
        body.cameraCode = deviceFromTopic;
      await this.ingest.handle(body, 'mqtt');
      return;
    }
    if (kind === 'heartbeat') {
      const code = String(
        body.deviceCode || body['设备编号'] || deviceFromTopic,
      );
      const deviceType =
        typeof body.deviceType === 'string' ? body.deviceType : undefined;
      await this.devices.heartbeat(
        shedFromTopic,
        code,
        deviceType,
        body.online !== false,
      );
    }
  }
}
