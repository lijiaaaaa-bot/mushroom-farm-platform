export interface AppConfig {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  mqttUrl: string;
  mqttEnabled: boolean;
  minio: {
    endPoint: string;
    port: number;
    useSSL: boolean;
    accessKey: string;
    secretKey: string;
    bucket: string;
    publicBaseUrl: string;
  };
  jwtSecret: string;
  ingestToken: string;
  seedOnStart: boolean;
  typeormSync: boolean;
  wecomWebhookUrl: string;
  dingtalkWebhookUrl: string;
  dingtalkWebhookSecret: string;
}

export default function configuration(): AppConfig {
  return {
    port: Number.parseInt(process.env.PORT || '41821', 10),
    databaseUrl:
      process.env.DATABASE_URL ||
      'postgres://mushroom:mushroom@127.0.0.1:5432/mushroom',
    redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
    mqttUrl: process.env.MQTT_URL || 'mqtt://127.0.0.1:1883',
    mqttEnabled: process.env.MQTT_ENABLED !== 'false',
    minio: {
      endPoint: process.env.MINIO_ENDPOINT || '127.0.0.1',
      port: Number.parseInt(process.env.MINIO_PORT || '9000', 10),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
      secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
      bucket: process.env.MINIO_BUCKET || 'mushroom-snapshots',
      publicBaseUrl:
        process.env.MINIO_PUBLIC_BASE_URL ||
        'http://127.0.0.1:9000/mushroom-snapshots',
    },
    jwtSecret: process.env.JWT_SECRET || 'dev-only-change-me',
    ingestToken: process.env.INGEST_TOKEN || 'dev-ingest-token',
    seedOnStart: process.env.SEED_ON_START !== 'false',
    typeormSync: process.env.TYPEORM_SYNC === 'true',
    wecomWebhookUrl: (process.env.WECOM_WEBHOOK_URL ?? '').trim(),
    dingtalkWebhookUrl: (process.env.DINGTALK_WEBHOOK_URL ?? '').trim(),
    dingtalkWebhookSecret: (process.env.DINGTALK_WEBHOOK_SECRET ?? '').trim(),
  };
}
