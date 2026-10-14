import { AlertMetric } from '@mushroom/contracts';
import { Alert } from '../entities/alert.entity';
import { AlertRule } from '../entities/alert-rule.entity';
import { EnvironmentReading } from '../entities/environment-reading.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import { AlertEngineService } from './alert-engine.service';

function rule(
  id: string,
  metric: AlertMetric,
  threshold: number,
  extra: Partial<AlertRule> = {},
): AlertRule {
  return {
    id,
    name: id,
    metric,
    threshold,
    level: metric === 'temperature_high' ? 'severe' : 'warning',
    shedCode: null,
    enabled: true,
    windowMinutes: 720,
    createdAt: new Date('2026-10-14T00:00:00.000Z'),
    ...extra,
  } as AlertRule;
}

const seedRules = [
  rule('temp-high', 'temperature_high', 28),
  rule('temp-low', 'temperature_low', 12),
  rule('hum-low', 'humidity_low', 70),
  rule('hum-high', 'humidity_high', 98, { level: 'info' }),
  rule('co2', 'co2_high', 2000, { level: 'severe' }),
  rule('moisture', 'substrate_moisture_low', 50),
  rule('disease', 'disease_count', 5),
  rule('stall', 'growth_stall', 0.05, { level: 'info' }),
];

function reading(extra: Partial<EnvironmentReading> = {}): EnvironmentReading {
  return {
    id: 'env-1',
    idempotencyKey: 'demo-telemetry-threshold-1',
    shedCode: 'S01',
    sensorCode: 'SENSOR-TELEM-01',
    observedAt: new Date('2026-10-14T01:02:03.004Z'),
    temperature: 32,
    humidity: 88,
    co2: 900,
    substrateMoisture: 70,
    source: 'http',
    rawPayload: null,
    createdAt: new Date('2026-10-14T01:02:04.000Z'),
    ...extra,
  } as EnvironmentReading;
}

function memory(rules: AlertRule[]) {
  const rows: Alert[] = [];
  const alerts = {
    findOne: async ({
      where,
    }: {
      where: {
        ruleId?: string;
        sensorCode?: string;
        cameraCode?: string;
        status?: unknown;
      };
    }) =>
      rows.find((row) => {
        if (where.ruleId && row.ruleId !== where.ruleId) return false;
        if (where.sensorCode && row.sensorCode !== where.sensorCode)
          return false;
        if (where.cameraCode && row.cameraCode !== where.cameraCode)
          return false;
        if (row.status !== 'open' && row.status !== 'acked') return false;
        return true;
      }) ?? null,
    create: (input: Partial<Alert>) => input,
    save: async (input: Partial<Alert>) => {
      const saved = {
        ...input,
        id: input.id ?? `alert-${rows.length + 1}`,
      } as Alert;
      const existing = rows.find((row) => row.id === saved.id);
      if (existing) Object.assign(existing, saved);
      else rows.push(saved);
      return saved;
    },
  };
  const engine = new AlertEngineService(
    { find: async () => rules.filter((item) => item.enabled) } as never,
    alerts as never,
    {} as never,
  );
  return { engine, rows };
}

describe('environment telemetry threshold alerts', () => {
  it('opens one temperature alert when the sample is over the seed threshold', async () => {
    const { engine, rows } = memory(seedRules);
    await engine.evaluateEnvironment(reading());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ruleId: 'temp-high',
      metric: 'temperature_high',
      shedCode: 'S01',
      cameraCode: null,
      sensorCode: 'SENSOR-TELEM-01',
      level: 'severe',
      status: 'open',
      title: '温度过高告警',
      message: '棚区 S01 传感器 SENSOR-TELEM-01 温度过高 32，阈值 28',
      metricValue: 32,
      threshold: 28,
      recognitionId: null,
      snapshotObjectKey: null,
    });
  });

  it('does not open an alert when every reading stays inside the seed rules', async () => {
    const { engine, rows } = memory(seedRules);
    await engine.evaluateEnvironment(
      reading({
        temperature: 22.5,
        humidity: 88,
        co2: 900,
        substrateMoisture: 70,
      }),
    );
    expect(rows).toHaveLength(0);
  });

  it('keeps a second over-threshold reading on the same open alert', async () => {
    const { engine, rows } = memory(seedRules);
    await engine.evaluateEnvironment(reading());
    await engine.evaluateEnvironment(
      reading({ id: 'env-2', temperature: 33, idempotencyKey: 'again' }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].metricValue).toBe(32);
  });

  it('opens a separate alert for another sensor', async () => {
    const { engine, rows } = memory(seedRules);
    await engine.evaluateEnvironment(reading());
    await engine.evaluateEnvironment(
      reading({
        id: 'env-2',
        sensorCode: 'SENSOR-TELEM-02',
        idempotencyKey: 'other',
      }),
    );
    expect(rows.map((row) => row.sensorCode).sort()).toEqual([
      'SENSOR-TELEM-01',
      'SENSOR-TELEM-02',
    ]);
  });

  it('ignores recognition-only rules and a rule scoped to another shed', async () => {
    const { engine, rows } = memory([
      ...seedRules,
      rule('other-shed', 'temperature_high', 20, { shedCode: 'S02' }),
    ]);
    await engine.evaluateEnvironment(reading({ temperature: 22.5 }));
    expect(rows).toHaveLength(0);
  });

  it('opens a humidity alert without a temperature alert when only humidity is over', async () => {
    const { engine, rows } = memory(seedRules);
    await engine.evaluateEnvironment(
      reading({ temperature: 22.5, humidity: 99 }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      metric: 'humidity_high',
      metricValue: 99,
      threshold: 98,
      sensorCode: 'SENSOR-TELEM-01',
      cameraCode: null,
    });
  });

  it('follows an edited shed rule and stays quiet when that threshold is above the reading', async () => {
    const custom = rule('demo-env-temp', 'temperature_high', 30, {
      level: 'warning',
      shedCode: 'S03',
      name: '演示环境温度过高',
    });
    const { engine, rows } = memory([...seedRules, custom]);
    const sample = {
      shedCode: 'S03',
      sensorCode: 'SENSOR-RULE-01',
      temperature: 26,
      humidity: 88,
      co2: 900,
      substrateMoisture: 70,
    };
    await engine.evaluateEnvironment(
      reading({ id: 'env-quiet', idempotencyKey: 'quiet', ...sample }),
    );
    expect(rows).toHaveLength(0);
    custom.threshold = 24;
    await engine.evaluateEnvironment(
      reading({ id: 'env-fire', idempotencyKey: 'fire', ...sample }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ruleId: 'demo-env-temp',
      metric: 'temperature_high',
      level: 'warning',
      status: 'open',
      shedCode: 'S03',
      sensorCode: 'SENSOR-RULE-01',
      cameraCode: null,
      title: '温度过高告警',
      message: '棚区 S03 传感器 SENSOR-RULE-01 温度过高 26，阈值 24',
      metricValue: 26,
      threshold: 24,
    });
    rows[0].status = 'closed';
    custom.threshold = 30;
    await engine.evaluateEnvironment(
      reading({ id: 'env-raised', idempotencyKey: 'raised', ...sample }),
    );
    expect(
      rows.filter((row) => row.status === 'open' || row.status === 'acked'),
    ).toHaveLength(0);
  });

  it('still opens a camera alert from a recognition and leaves the sensor empty', async () => {
    const { engine, rows } = memory(
      seedRules.filter((item) => item.metric !== 'growth_stall'),
    );
    await engine.evaluate({
      id: 'rec-1',
      shedCode: 'S01',
      cameraCode: 'CAM-ALERT-01',
      mushroomCount: 12,
      matureCount: 5,
      diseaseCount: 0,
      diseaseLevel: 0,
      temperature: 30,
      humidity: 88,
      co2: 900,
      substrateMoisture: 70,
      recognizedAt: new Date('2026-10-14T01:02:03.004Z'),
      avgCapDiameter: 2,
      snapshotObjectKey: null,
    } as RecognitionRecord);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      cameraCode: 'CAM-ALERT-01',
      sensorCode: null,
      metric: 'temperature_high',
      metricValue: 30,
      recognitionId: 'rec-1',
      title: '温度过高告警',
      message: '棚区 S01 摄像头 CAM-ALERT-01 温度过高 30，阈值 28',
    });
  });
});
