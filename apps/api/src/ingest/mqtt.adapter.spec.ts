import { readFileSync } from 'fs';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { DevicesService } from '../devices';
import { IngestService } from './ingest.service';
import { MqttIngestAdapter } from './mqtt.adapter';

function loadFixture(name: string): {
  body: Record<string, unknown>;
  shedCode?: string;
  deviceCode?: string;
} {
  return JSON.parse(
    readFileSync(
      join(__dirname, '../../../../packages/contracts/fixtures', name),
      'utf8',
    ),
  ) as { body: Record<string, unknown> };
}

describe('MqttIngestAdapter', () => {
  const handle = jest.fn();
  const handleEnvironment = jest.fn();
  const recordReject = jest.fn();
  const recordHeartbeat = jest.fn();
  const heartbeat = jest.fn();

  function adapter() {
    return new MqttIngestAdapter(
      { get: () => false } as unknown as ConfigService,
      {
        handle,
        handleEnvironment,
        recordReject,
        recordHeartbeat,
      } as unknown as IngestService,
      { heartbeat } as unknown as DevicesService,
    );
  }

  async function deliver(topic: string, payload: unknown) {
    const bytes =
      typeof payload === 'string' ? payload : JSON.stringify(payload);
    await adapter().onMessage(topic, Buffer.from(bytes));
  }

  beforeEach(() => {
    handle.mockReset();
    handleEnvironment.mockReset();
    recordReject.mockReset();
    recordHeartbeat.mockReset();
    heartbeat.mockReset();
    handle.mockResolvedValue({ accepted: true });
    handleEnvironment.mockResolvedValue({ accepted: true });
    heartbeat.mockResolvedValue(undefined);
  });

  it('forwards the golden mqtt fixture into the shared ingest pipeline', async () => {
    const fixture = loadFixture('recognition.mqtt.json');
    const topic = `mushroom/${String(fixture.body.shedCode)}/${String(fixture.body.cameraCode)}/recognition`;
    await deliver(topic, fixture.body);
    expect(handle).toHaveBeenCalledWith(fixture.body, 'mqtt');
    expect(handleEnvironment).not.toHaveBeenCalled();
    expect(heartbeat).not.toHaveBeenCalled();
  });

  it('keeps unknown fields so the shared schema can reject UNKNOWN_FIELD', async () => {
    const fixture = loadFixture('recognition.unknown-field.json');
    await deliver('mushroom/S01/CAM-S01-01/recognition', fixture.body);
    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({ unexpectedSensor: 1 }),
      'mqtt',
    );
  });

  it('fills shed and camera from the topic when the payload omits them', async () => {
    const fixture = loadFixture('recognition.mqtt.json');
    const body = { ...fixture.body };
    delete body.shedCode;
    delete body.cameraCode;
    await deliver('mushroom/S09/CAM-TOPIC/recognition', body);
    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({
        shedCode: 'S09',
        cameraCode: 'CAM-TOPIC',
        idempotencyKey: fixture.body.idempotencyKey,
      }),
      'mqtt',
    );
  });

  it('does not ingest a payload that is not JSON', async () => {
    await deliver('mushroom/S01/CAM-S01-01/recognition', '{');
    expect(handle).not.toHaveBeenCalled();
    expect(recordReject).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'mqtt',
        channel: 'recognition',
        shedCode: 'S01',
        errors: ['载荷不是 JSON'],
      }),
    );
  });

  it('routes heartbeat to devices and leaves recognition ingest alone', async () => {
    await deliver('mushroom/S01/BOX-1/heartbeat', {
      deviceType: 'ai_box',
      online: true,
    });
    expect(handle).not.toHaveBeenCalled();
    expect(handleEnvironment).not.toHaveBeenCalled();
    expect(heartbeat).toHaveBeenCalledWith('S01', 'BOX-1', 'ai_box', true);
    expect(recordHeartbeat).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'mqtt',
        shedCode: 'S01',
        deviceCode: 'BOX-1',
      }),
    );
  });

  it('routes the heartbeat fixture and drops unknown heartbeat fields', async () => {
    const fixture = loadFixture('heartbeat.mqtt.json');
    await deliver(
      `mushroom/${fixture.shedCode}/${fixture.deviceCode}/heartbeat`,
      fixture.body,
    );
    expect(heartbeat).toHaveBeenCalledWith(
      'S01',
      'EDGE-SIM-BOX',
      'ai_box',
      true,
    );
    heartbeat.mockClear();
    await deliver('mushroom/S01/BOX-1/heartbeat', {
      deviceType: 'ai_box',
      online: true,
      firmware: '1.2.3',
    });
    expect(heartbeat).not.toHaveBeenCalled();
    expect(handle).not.toHaveBeenCalled();
    expect(recordReject).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'mqtt',
        channel: 'heartbeat',
        shedCode: 'S01',
        code: 'UNKNOWN_FIELD',
      }),
    );
  });

  it('routes environment topics away from recognition ingest', async () => {
    const body = {
      observedAt: '2026-09-23T01:40:00.000Z',
      temperature: 19.2,
      humidity: 90,
    };
    await deliver('mushroom/S03/SENSOR-S03/environment', body);
    expect(handle).not.toHaveBeenCalled();
    expect(heartbeat).not.toHaveBeenCalled();
    expect(handleEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({
        ...body,
        shedCode: 'S03',
        sensorCode: 'SENSOR-S03',
      }),
      'mqtt',
    );
  });

  it('does not ingest an environment payload that is not JSON', async () => {
    await deliver('mushroom/S01/SENSOR-S01/environment', '{');
    expect(handle).not.toHaveBeenCalled();
    expect(handleEnvironment).not.toHaveBeenCalled();
    expect(recordReject).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'environment',
        shedCode: 'S01',
        errors: ['载荷不是 JSON'],
      }),
    );
  });
});
