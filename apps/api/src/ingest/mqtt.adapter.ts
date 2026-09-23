import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import mqtt, { MqttClient } from 'mqtt';
import {
  MQTT_ENVIRONMENT_TOPIC,
  MQTT_HEARTBEAT_TOPIC,
  MQTT_RECOGNITION_TOPIC,
  parseHeartbeatIngress,
} from '@mushroom/contracts';
import { DevicesService } from '../devices';
import { IngestService } from './ingest.service';

/** MQTT 适配器：只解析 topic。识别与环境各自进入对应的规范报文管道。 */
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
        [MQTT_RECOGNITION_TOPIC, MQTT_HEARTBEAT_TOPIC, MQTT_ENVIRONMENT_TOPIC],
        { qos: 1 },
        (error) => {
          if (error) this.logger.warn(`MQTT 订阅失败：${error.message}`);
          else
            this.logger.log(
              `MQTT 已订阅 ${MQTT_RECOGNITION_TOPIC} ${MQTT_ENVIRONMENT_TOPIC}`,
            );
        },
      );
    });
    this.client.on('error', (error) =>
      this.logger.warn(`MQTT 错误：${error.message}`),
    );
    this.client.on('message', (topic, payload) => {
      void this.onMessage(topic, payload).catch((error: Error) => {
        this.logger.warn(`MQTT 处理失败 ${topic}：${error.message}`);
      });
    });
  }

  onModuleDestroy() {
    this.client?.end(true);
  }

  async onMessage(topic: string, payload: Buffer) {
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
        const channel =
          kind === 'environment' ||
          kind === 'heartbeat' ||
          kind === 'recognition'
            ? kind
            : null;
        if (channel) {
          await this.ingest.recordReject({
            source: 'mqtt',
            channel,
            code: 'VALIDATION_FAILED',
            errors: ['载荷不是 JSON'],
            shedCode: shedFromTopic,
            payload: null,
          });
        }
        this.logger.warn(`MQTT 载荷不是 JSON：${topic}`);
        return;
      }
    }
    if (kind === 'recognition') {
      if (!body.shedCode && !body['棚区编号']) body.shedCode = shedFromTopic;
      if (!body.cameraCode && !body['摄像头编号'])
        body.cameraCode = deviceFromTopic;
      const result = await this.ingest.handle(body, 'mqtt');
      if (!result.accepted) {
        this.logger.warn(
          `MQTT 识别被拒绝 ${topic}：${result.code || ''} ${(result.errors || []).join('；')}`,
        );
      }
      return;
    }
    if (kind === 'environment') {
      if (!body.shedCode && !body['棚区编号']) body.shedCode = shedFromTopic;
      if (!body.sensorCode && !body['传感器编号'])
        body.sensorCode = deviceFromTopic;
      const result = await this.ingest.handleEnvironment(body, 'mqtt');
      if (!result.accepted) {
        this.logger.warn(
          `MQTT 环境报文被拒绝 ${topic}：${result.code || ''} ${(result.errors || []).join('；')}`,
        );
      }
      return;
    }
    if (kind === 'heartbeat') {
      if (!body.shedCode && !body['棚区编号']) body.shedCode = shedFromTopic;
      if (!body.deviceCode && !body['设备编号'])
        body.deviceCode = deviceFromTopic;
      const parsed = parseHeartbeatIngress(body);
      if (!parsed.ok) {
        await this.ingest.recordReject({
          source: 'mqtt',
          channel: 'heartbeat',
          code: parsed.code,
          errors: parsed.errors,
          payload: body,
          shedCode: shedFromTopic,
        });
        this.logger.warn(
          `MQTT 心跳被拒绝 ${topic}：${parsed.code} ${parsed.errors.join('；')}`,
        );
        return;
      }
      const beat = parsed.value;
      const result = beat.reportedAt
        ? await this.devices.heartbeat(
            beat.shedCode,
            beat.deviceCode,
            beat.deviceType,
            beat.online,
            beat.reportedAt,
          )
        : await this.devices.heartbeat(
            beat.shedCode,
            beat.deviceCode,
            beat.deviceType,
            beat.online,
          );
      await this.ingest.recordHeartbeat({
        source: 'mqtt',
        shedCode: beat.shedCode,
        deviceCode: beat.deviceCode,
        duplicate: result?.duplicate === true,
        reportedAt: beat.reportedAt,
      });
    }
  }
}
