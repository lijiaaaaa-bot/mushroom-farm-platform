import { createHash } from 'crypto';
import { z } from 'zod';

export const CONTRACT_VERSION = 1;

export const ERROR_CODES = {
  UNKNOWN_FIELD: 'UNKNOWN_FIELD',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
} as const;

export const errorCodeSchema = z.enum([
  ERROR_CODES.UNKNOWN_FIELD,
  ERROR_CODES.VALIDATION_FAILED,
  ERROR_CODES.INVALID_TRANSITION,
  ERROR_CODES.UNAUTHORIZED,
  ERROR_CODES.FORBIDDEN,
  ERROR_CODES.NOT_FOUND,
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const roleSchema = z.enum([
  'super_admin',
  'production_admin',
  'shed_manager',
  'viewer',
]);
export type Role = z.infer<typeof roleSchema>;

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: '超管',
  production_admin: '生产管理员',
  shed_manager: '棚区负责人',
  viewer: '查看',
};

export const alertStatusSchema = z.enum(['open', 'acked', 'closed']);
export type AlertStatus = z.infer<typeof alertStatusSchema>;

export const ALERT_STATUS_LABEL: Record<AlertStatus, string> = {
  open: '待确认',
  acked: '已确认',
  closed: '已关闭',
};

/** 关闭原因。误报与普通关闭都落到 closed，用枚举区分。 */
export const alertCloseReasonSchema = z.enum(['resolved', 'false_positive']);
export type AlertCloseReason = z.infer<typeof alertCloseReasonSchema>;

export const ALERT_CLOSE_REASON_LABEL: Record<AlertCloseReason, string> = {
  resolved: '正常关闭',
  false_positive: '误报',
};

export const alertLevelSchema = z.enum(['info', 'warning', 'severe']);
export type AlertLevel = z.infer<typeof alertLevelSchema>;

export const ALERT_LEVEL_LABEL: Record<AlertLevel, string> = {
  info: '提示',
  warning: '一般',
  severe: '严重',
};

export const alertMetricSchema = z.enum([
  'mature_ratio',
  'mature_count',
  'disease_count',
  'disease_level',
  'growth_stall',
  'temperature_high',
  'temperature_low',
  'humidity_high',
  'humidity_low',
  'co2_high',
  'substrate_moisture_low',
]);
export type AlertMetric = z.infer<typeof alertMetricSchema>;

export const ALERT_METRIC_LABEL: Record<AlertMetric, string> = {
  mature_ratio: '成熟占比',
  mature_count: '成熟数量',
  disease_count: '病害数量',
  disease_level: '病害等级',
  growth_stall: '生长停滞',
  temperature_high: '温度过高',
  temperature_low: '温度过低',
  humidity_high: '湿度过高',
  humidity_low: '湿度过低',
  co2_high: 'CO₂过高',
  substrate_moisture_low: '基质含水率过低',
};

export const deviceTypeSchema = z.enum(['camera', 'ai_box', 'sensor']);
export type DeviceType = z.infer<typeof deviceTypeSchema>;

export const DEVICE_TYPE_LABEL: Record<DeviceType, string> = {
  camera: '摄像头',
  ai_box: 'AI盒',
  sensor: '传感器',
};

export const MQTT_RECOGNITION_TOPIC = 'mushroom/+/+/recognition';
export const MQTT_HEARTBEAT_TOPIC = 'mushroom/+/+/heartbeat';
export const MQTT_ENVIRONMENT_TOPIC = 'mushroom/+/+/environment';
export const INGEST_HTTP_PATH = '/api/v1/ingest/recognition';
export const INGEST_ENVIRONMENT_HTTP_PATH = '/api/v1/ingest/environment';
export const IMAGE_RETENTION_DAYS = 30;
export const TIMESERIES_RETENTION_DAYS = 90;
export const DEVICE_OFFLINE_AFTER_MS = 5 * 60 * 1000;
export const IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 3600;
export const SNAPSHOT_KEY_PATTERN =
  'snapshots/{shedCode}/{yyyy-MM-dd}/{cameraCode}/{epochMs}.jpg';

export const LIMITS = {
  mushroomCount: { min: 0, max: 100_000 },
  capDiameterCm: { min: 0, max: 40 },
  diseaseLevel: { min: 0, max: 3 },
  temperatureC: { min: -5, max: 45 },
  humidityPct: { min: 0, max: 100 },
  co2Ppm: { min: 0, max: 20_000 },
  substrateMoisturePct: { min: 0, max: 100 },
  recognizedAtPastDays: 7,
  recognizedAtFutureMinutes: 10,
} as const;

const countField = z.union([z.number(), z.string()]);
const optionalCount = countField.optional();

/** 接入报文唯一 schema。未声明字段会被 .strict() 拒绝。 */
export const recognitionIngressSchema = z
  .object({
    idempotencyKey: z.string().optional(),
    幂等键: z.string().optional(),
    shedCode: z.string().optional(),
    棚区编号: z.string().optional(),
    cameraCode: z.string().optional(),
    摄像头编号: z.string().optional(),
    recognizedAt: z.string().optional(),
    识别时间: z.string().optional(),
    mushroomCount: optionalCount,
    蘑菇数量: optionalCount,
    matureCount: optionalCount,
    成熟数量: optionalCount,
    capDiameters: z.union([z.array(z.number()), z.string()]).optional(),
    各菌盖直径: z.union([z.array(z.number()), z.string()]).optional(),
    菌盖直径: z.union([z.array(z.number()), z.string()]).optional(),
    diseaseCount: optionalCount,
    病害数量: optionalCount,
    diseaseLevel: z.union([z.number(), z.string()]).optional(),
    病害等级: z.union([z.number(), z.string()]).optional(),
    snapshotUrl: z.string().optional(),
    抓拍图URL: z.string().optional(),
    AI抓拍图URL: z.string().optional(),
    snapshotBase64: z.string().optional(),
    抓拍图Base64: z.string().optional(),
    AI抓拍图: z.string().optional(),
    抓拍图: z.string().optional(),
    temperature: optionalCount,
    温度: optionalCount,
    环境温度: optionalCount,
    humidity: optionalCount,
    湿度: optionalCount,
    环境湿度: optionalCount,
    co2: optionalCount,
    CO2: optionalCount,
    'CO₂': optionalCount,
    co2浓度: optionalCount,
    二氧化碳: optionalCount,
    substrateMoisture: optionalCount,
    基质含水率: optionalCount,
  })
  .strict();

export type RecognitionIngress = z.infer<typeof recognitionIngressSchema>;

export const canonicalRecognitionSchema = z
  .object({
    idempotencyKey: z.string().optional(),
    shedCode: z.string().min(1),
    cameraCode: z.string().min(1),
    recognizedAt: z.string().min(1),
    mushroomCount: z.number().int(),
    matureCount: z.number().int(),
    capDiameters: z.array(z.number()),
    diseaseCount: z.number().int(),
    diseaseLevel: z.number().int(),
    snapshotUrl: z.string().optional(),
    snapshotBase64: z.string().optional(),
    temperature: z.number().optional(),
    humidity: z.number().optional(),
    co2: z.number().optional(),
    substrateMoisture: z.number().optional(),
  })
  .strict();

export type CanonicalRecognition = z.infer<typeof canonicalRecognitionSchema>;

/** 环境上报与识别报文分开。未声明字段会被 .strict() 拒绝。 */
export const environmentIngressSchema = z
  .object({
    idempotencyKey: z.string().optional(),
    幂等键: z.string().optional(),
    shedCode: z.string().optional(),
    棚区编号: z.string().optional(),
    sensorCode: z.string().optional(),
    传感器编号: z.string().optional(),
    observedAt: z.string().optional(),
    观测时间: z.string().optional(),
    temperature: optionalCount,
    温度: optionalCount,
    环境温度: optionalCount,
    humidity: optionalCount,
    湿度: optionalCount,
    环境湿度: optionalCount,
    co2: optionalCount,
    CO2: optionalCount,
    'CO₂': optionalCount,
    co2浓度: optionalCount,
    二氧化碳: optionalCount,
    substrateMoisture: optionalCount,
    基质含水率: optionalCount,
  })
  .strict();

export type EnvironmentIngress = z.infer<typeof environmentIngressSchema>;

export const canonicalEnvironmentSchema = z
  .object({
    idempotencyKey: z.string().optional(),
    shedCode: z.string().min(1),
    sensorCode: z.string().min(1),
    observedAt: z.string().min(1),
    temperature: z.number().optional(),
    humidity: z.number().optional(),
    co2: z.number().optional(),
    substrateMoisture: z.number().optional(),
  })
  .strict();

export type CanonicalEnvironment = z.infer<typeof canonicalEnvironmentSchema>;

/** 心跳与识别、环境报文分开。未声明字段会被 .strict() 拒绝。 */
export const heartbeatIngressSchema = z
  .object({
    shedCode: z.string().optional(),
    棚区编号: z.string().optional(),
    deviceCode: z.string().optional(),
    设备编号: z.string().optional(),
    deviceType: z.string().optional(),
    设备类型: z.string().optional(),
    online: z.boolean().optional(),
    在线: z.boolean().optional(),
    reportedAt: z.string().optional(),
    心跳时间: z.string().optional(),
  })
  .strict();

export type HeartbeatIngress = z.infer<typeof heartbeatIngressSchema>;

export const canonicalHeartbeatSchema = z
  .object({
    shedCode: z.string().min(1),
    deviceCode: z.string().min(1),
    deviceType: deviceTypeSchema.optional(),
    online: z.boolean(),
    reportedAt: z.string().optional(),
  })
  .strict();

export type CanonicalHeartbeat = z.infer<typeof canonicalHeartbeatSchema>;

export const createAlertSchema = z
  .object({
    shedCode: z.string().min(1),
    cameraCode: z.string().min(1).optional(),
    level: alertLevelSchema,
    title: z.string().min(1).max(80),
    message: z.string().min(1),
  })
  .strict();
export type CreateAlertInput = z.infer<typeof createAlertSchema>;

export const alertNoteSchema = z
  .object({
    note: z.string().max(500).optional(),
  })
  .strict();
export type AlertNoteInput = z.infer<typeof alertNoteSchema>;

/** 误报关闭必须写处置备注；认领与普通关闭备注可选。 */
export const alertFalsePositiveSchema = z
  .object({
    note: z.string().trim().min(1).max(500),
  })
  .strict();
export type AlertFalsePositiveInput = z.infer<typeof alertFalsePositiveSchema>;

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ErrorCode; errors: string[] };

const NEXT_ALERT: Record<AlertStatus, AlertStatus[]> = {
  open: ['acked', 'closed'],
  acked: ['closed'],
  closed: [],
};

export function transitionError(from: string, to: AlertStatus): string | null {
  const parsed = alertStatusSchema.safeParse(from);
  if (!parsed.success || !NEXT_ALERT[parsed.data].includes(to)) {
    return `告警状态不允许从 ${from} 变为 ${to}`;
  }
  return null;
}

export function shanghaiDate(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

export function todayShanghai(now = new Date()): string {
  return shanghaiDate(now);
}

export function shanghaiDayRange(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00+08:00`);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

export function buildSnapshotObjectKey(
  shedCode: string,
  cameraCode: string,
  recognizedAt: Date,
): string {
  return `snapshots/${shedCode}/${shanghaiDate(recognizedAt)}/${cameraCode}/${recognizedAt.getTime()}.jpg`;
}

export function buildIdempotencyKey(input: {
  shedCode: string;
  cameraCode: string;
  recognizedAt: string;
}): string {
  const stamp = new Date(input.recognizedAt).toISOString();
  return createHash('sha1')
    .update(`${input.shedCode}|${input.cameraCode}|${stamp}`)
    .digest('hex');
}

export function buildEnvironmentIdempotencyKey(input: {
  shedCode: string;
  sensorCode: string;
  observedAt: string;
}): string {
  const stamp = new Date(input.observedAt).toISOString();
  return createHash('sha1')
    .update(`environment|${input.shedCode}|${input.sensorCode}|${stamp}`)
    .digest('hex');
}

export function averageDiameter(values: number[]): number | null {
  if (!values.length) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return Math.round((sum / values.length) * 100) / 100;
}

/** 冒烟只允许改识别时间到当前时钟，其余字段必须来自 fixture。 */
export function withRuntimeClock(
  body: Record<string, unknown>,
  now = new Date(),
): Record<string, unknown> {
  const next = { ...body };
  const iso = now.toISOString();
  if ('recognizedAt' in next) next.recognizedAt = iso;
  if ('识别时间' in next) next['识别时间'] = iso;
  return next;
}

const DISEASE_LEVEL: Record<string, number> = {
  '0': 0,
  无: 0,
  正常: 0,
  none: 0,
  '1': 1,
  轻: 1,
  轻度: 1,
  low: 1,
  '2': 2,
  中: 2,
  中度: 2,
  medium: 2,
  '3': 3,
  重: 3,
  严重: 3,
  high: 3,
  severe: 3,
};

function fail(code: ErrorCode, errors: string[]): ParseResult<never> {
  return { ok: false, code, errors };
}

function zodErrors(error: z.ZodError): { code: ErrorCode; errors: string[] } {
  const unknown = error.issues.some((issue) => issue.code === 'unrecognized_keys');
  const errors = error.issues.map((issue) => {
    if (issue.code === 'unrecognized_keys') {
      return `未知字段 ${(issue.keys || []).join(', ')}`;
    }
    const path = issue.path.join('.') || '报文';
    return `${path}: ${issue.message}`;
  });
  return {
    code: unknown ? ERROR_CODES.UNKNOWN_FIELD : ERROR_CODES.VALIDATION_FAILED,
    errors,
  };
}

function num(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function integer(value: unknown): number | undefined {
  const parsed = num(value);
  if (parsed === undefined) return undefined;
  if (Number.isNaN(parsed)) return Number.NaN;
  return Math.round(parsed);
}

function diameters(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  }
  if (typeof value === 'string') {
    return value
      .split(/[,，\s]+/)
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item));
  }
  return [];
}

function diseaseLevel(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value === 'string') {
    const mapped = DISEASE_LEVEL[value.trim()] ?? DISEASE_LEVEL[value.trim().toLowerCase()];
    if (mapped !== undefined) return mapped;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : Number.NaN;
  }
  return 0;
}

function pick(body: RecognitionIngress, keys: (keyof RecognitionIngress)[]): unknown {
  for (const key of keys) {
    const value = body[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function rangeError(
  errors: string[],
  value: number | undefined,
  range: { min: number; max: number },
  label: string,
) {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value < range.min || value > range.max) {
    errors.push(`${label}超出允许范围`);
  }
}

export function parseRecognitionIngress(
  raw: unknown,
  now = new Date(),
): ParseResult<CanonicalRecognition> {
  const parsed = recognitionIngressSchema.safeParse(raw);
  if (!parsed.success) return fail(zodErrors(parsed.error).code, zodErrors(parsed.error).errors);
  const body = parsed.data;
  const image = pick(body, ['snapshotBase64', '抓拍图Base64', 'AI抓拍图', '抓拍图']);
  const imageUrl = pick(body, ['snapshotUrl', '抓拍图URL', 'AI抓拍图URL']);
  let snapshotUrl = typeof imageUrl === 'string' ? imageUrl : undefined;
  let snapshotBase64: string | undefined;
  if (typeof image === 'string') {
    if (/^https?:\/\//i.test(image)) snapshotUrl = snapshotUrl ?? image;
    else snapshotBase64 = image.replace(/^data:image\/\w+;base64,/, '');
  }
  const recognized = pick(body, ['recognizedAt', '识别时间']);
  const idempotencyKey = pick(body, ['idempotencyKey', '幂等键']);
  const canonical: CanonicalRecognition = {
    idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : undefined,
    shedCode: String(pick(body, ['shedCode', '棚区编号']) ?? '').trim(),
    cameraCode: String(pick(body, ['cameraCode', '摄像头编号']) ?? '').trim(),
    recognizedAt: String(recognized ?? ''),
    mushroomCount: integer(pick(body, ['mushroomCount', '蘑菇数量'])) ?? Number.NaN,
    matureCount: integer(pick(body, ['matureCount', '成熟数量'])) ?? Number.NaN,
    capDiameters: diameters(
      pick(body, ['capDiameters', '各菌盖直径', '菌盖直径']),
    ),
    diseaseCount: integer(pick(body, ['diseaseCount', '病害数量'])) ?? 0,
    diseaseLevel: diseaseLevel(pick(body, ['diseaseLevel', '病害等级'])),
    snapshotUrl,
    snapshotBase64,
    temperature: num(pick(body, ['temperature', '温度', '环境温度'])),
    humidity: num(pick(body, ['humidity', '湿度', '环境湿度'])),
    co2: num(pick(body, ['co2', 'CO2', 'CO₂', 'co2浓度', '二氧化碳'])),
    substrateMoisture: num(pick(body, ['substrateMoisture', '基质含水率'])),
  };
  const errors: string[] = [];
  if (!canonical.shedCode) errors.push('缺少棚区编号');
  if (!canonical.cameraCode) errors.push('缺少摄像头编号');
  const time = new Date(canonical.recognizedAt);
  if (!canonical.recognizedAt || Number.isNaN(time.getTime())) errors.push('识别时间无效');
  else {
    if (time.getTime() > now.getTime() + LIMITS.recognizedAtFutureMinutes * 60 * 1000) {
      errors.push('识别时间超前过多');
    }
    if (now.getTime() - time.getTime() > LIMITS.recognizedAtPastDays * 24 * 60 * 60 * 1000) {
      errors.push('识别时间超出补传窗口');
    }
  }
  if (
    !Number.isFinite(canonical.mushroomCount) ||
    canonical.mushroomCount < LIMITS.mushroomCount.min ||
    canonical.mushroomCount > LIMITS.mushroomCount.max
  ) {
    errors.push('蘑菇数量超出允许范围');
  }
  if (
    !Number.isFinite(canonical.matureCount) ||
    canonical.matureCount < 0 ||
    (Number.isFinite(canonical.mushroomCount) &&
      canonical.matureCount > canonical.mushroomCount)
  ) {
    errors.push('成熟数量无效或大于蘑菇数量');
  }
  if (
    canonical.capDiameters.some(
      (value) => value < LIMITS.capDiameterCm.min || value > LIMITS.capDiameterCm.max,
    )
  ) {
    errors.push('菌盖直径超出允许范围');
  }
  if (
    !Number.isFinite(canonical.diseaseCount) ||
    canonical.diseaseCount < 0 ||
    canonical.diseaseCount > LIMITS.mushroomCount.max
  ) {
    errors.push('病害数量无效');
  }
  if (
    !Number.isFinite(canonical.diseaseLevel) ||
    canonical.diseaseLevel < LIMITS.diseaseLevel.min ||
    canonical.diseaseLevel > LIMITS.diseaseLevel.max
  ) {
    errors.push('病害等级无效');
  }
  rangeError(errors, canonical.temperature, LIMITS.temperatureC, '温度');
  rangeError(errors, canonical.humidity, LIMITS.humidityPct, '湿度');
  rangeError(errors, canonical.co2, LIMITS.co2Ppm, 'CO₂');
  rangeError(errors, canonical.substrateMoisture, LIMITS.substrateMoisturePct, '基质含水率');
  if (errors.length) return fail(ERROR_CODES.VALIDATION_FAILED, errors);
  return { ok: true, value: canonical };
}

function pickEnv(body: EnvironmentIngress, keys: (keyof EnvironmentIngress)[]): unknown {
  for (const key of keys) {
    const value = body[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

export function parseEnvironmentIngress(
  raw: unknown,
  now = new Date(),
): ParseResult<CanonicalEnvironment> {
  const parsed = environmentIngressSchema.safeParse(raw);
  if (!parsed.success) return fail(zodErrors(parsed.error).code, zodErrors(parsed.error).errors);
  const body = parsed.data;
  const observed = pickEnv(body, ['observedAt', '观测时间']);
  const idempotencyKey = pickEnv(body, ['idempotencyKey', '幂等键']);
  const canonical: CanonicalEnvironment = {
    idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : undefined,
    shedCode: String(pickEnv(body, ['shedCode', '棚区编号']) ?? '').trim(),
    sensorCode: String(pickEnv(body, ['sensorCode', '传感器编号']) ?? '').trim(),
    observedAt: String(observed ?? ''),
    temperature: num(pickEnv(body, ['temperature', '温度', '环境温度'])),
    humidity: num(pickEnv(body, ['humidity', '湿度', '环境湿度'])),
    co2: num(pickEnv(body, ['co2', 'CO2', 'CO₂', 'co2浓度', '二氧化碳'])),
    substrateMoisture: num(pickEnv(body, ['substrateMoisture', '基质含水率'])),
  };
  const errors: string[] = [];
  if (!canonical.shedCode) errors.push('缺少棚区编号');
  if (!canonical.sensorCode) errors.push('缺少传感器编号');
  const time = new Date(canonical.observedAt);
  if (!canonical.observedAt || Number.isNaN(time.getTime())) errors.push('观测时间无效');
  else {
    if (time.getTime() > now.getTime() + LIMITS.recognizedAtFutureMinutes * 60 * 1000) {
      errors.push('观测时间超前过多');
    }
    if (now.getTime() - time.getTime() > LIMITS.recognizedAtPastDays * 24 * 60 * 60 * 1000) {
      errors.push('观测时间超出补传窗口');
    }
  }
  if (canonical.temperature === undefined && canonical.humidity === undefined) {
    errors.push('缺少温度或湿度');
  }
  rangeError(errors, canonical.temperature, LIMITS.temperatureC, '温度');
  rangeError(errors, canonical.humidity, LIMITS.humidityPct, '湿度');
  rangeError(errors, canonical.co2, LIMITS.co2Ppm, 'CO₂');
  rangeError(errors, canonical.substrateMoisture, LIMITS.substrateMoisturePct, '基质含水率');
  if (errors.length) return fail(ERROR_CODES.VALIDATION_FAILED, errors);
  return { ok: true, value: canonical };
}

function pickHeartbeat(
  body: HeartbeatIngress,
  keys: (keyof HeartbeatIngress)[],
): unknown {
  for (const key of keys) {
    const value = body[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

export function parseHeartbeatIngress(
  raw: unknown,
): ParseResult<CanonicalHeartbeat> {
  const parsed = heartbeatIngressSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = zodErrors(parsed.error);
    return fail(issue.code, issue.errors);
  }
  const body = parsed.data;
  const deviceTypeRaw = pickHeartbeat(body, ['deviceType', '设备类型']);
  const reported = pickHeartbeat(body, ['reportedAt', '心跳时间']);
  const onlineRaw = pickHeartbeat(body, ['online', '在线']);
  const errors: string[] = [];
  let deviceType: DeviceType | undefined;
  if (deviceTypeRaw !== undefined) {
    const text = String(deviceTypeRaw).trim();
    if (!isDeviceType(text)) errors.push('设备类型无效');
    else deviceType = text;
  }
  const canonical: CanonicalHeartbeat = {
    shedCode: String(pickHeartbeat(body, ['shedCode', '棚区编号']) ?? '').trim(),
    deviceCode: String(
      pickHeartbeat(body, ['deviceCode', '设备编号']) ?? '',
    ).trim(),
    deviceType,
    online: onlineRaw === undefined ? true : onlineRaw === true,
    reportedAt: reported === undefined ? undefined : String(reported),
  };
  if (!canonical.shedCode) errors.push('缺少棚区编号');
  if (!canonical.deviceCode) errors.push('缺少设备编号');
  if (
    canonical.reportedAt !== undefined &&
    Number.isNaN(new Date(canonical.reportedAt).getTime())
  ) {
    errors.push('心跳时间无效');
  }
  if (errors.length) return fail(ERROR_CODES.VALIDATION_FAILED, errors);
  return { ok: true, value: canonical };
}

export function parseCreateAlert(raw: unknown): ParseResult<CreateAlertInput> {
  const parsed = createAlertSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = zodErrors(parsed.error);
    return fail(issue.code, issue.errors);
  }
  return { ok: true, value: parsed.data };
}

export function parseAlertNote(raw: unknown): ParseResult<AlertNoteInput> {
  const parsed = alertNoteSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const issue = zodErrors(parsed.error);
    return fail(issue.code, issue.errors);
  }
  return { ok: true, value: parsed.data };
}

export function parseAlertFalsePositive(
  raw: unknown,
): ParseResult<AlertFalsePositiveInput> {
  const parsed = alertFalsePositiveSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const issue = zodErrors(parsed.error);
    return fail(issue.code, issue.errors);
  }
  return { ok: true, value: parsed.data };
}

export function isRole(value: string): value is Role {
  return roleSchema.safeParse(value).success;
}

export function isAlertLevel(value: string): value is AlertLevel {
  return alertLevelSchema.safeParse(value).success;
}

export function isAlertMetric(value: string): value is AlertMetric {
  return alertMetricSchema.safeParse(value).success;
}

export function isDeviceType(value: string): value is DeviceType {
  return deviceTypeSchema.safeParse(value).success;
}

export const ROLES = roleSchema.options;
export const ALERT_STATUSES = alertStatusSchema.options;
export const ALERT_CLOSE_REASONS = alertCloseReasonSchema.options;
export const ALERT_LEVELS = alertLevelSchema.options;
export const ALERT_METRICS = alertMetricSchema.options;
export const DEVICE_TYPES = deviceTypeSchema.options;
