import assert from 'node:assert/strict';
import test from 'node:test';
import { readFixture } from './lib/ingest-wire.mjs';
import {
  CONTRAST_CODES,
  DEMO_DEVICES,
  EXPECTED_CLEAN,
  EXPECTED_CLEAN_NOTE,
  HEARTBEAT_FIXTURE,
  SEED_DEVICES,
  assertOverviewDeviceOnline,
  buildOnlineHeartbeat,
  formatDeviceOnlineByTypeProof,
  validateOnlineHeartbeats,
} from './demo-device-online-by-type.mjs';

function cleanInventory() {
  const seed = SEED_DEVICES.map((row) => ({
    code: row.code,
    type: row.type,
    onlineStatus: 'offline',
    shedCode: 'S01',
  }));
  const demo = DEMO_DEVICES.map((row) => ({
    code: row.code,
    type: row.type,
    onlineStatus: row.online ? 'online' : 'offline',
    shedCode: row.shedCode,
  }));
  return [...seed, ...demo];
}

function overviewFrom(counts, extra = {}) {
  return {
    ...counts,
    deviceOnline: counts.cameraOnline + counts.aiBoxOnline + counts.sensorOnline,
    deviceTotal: counts.cameraTotal + counts.aiBoxTotal + counts.sensorTotal,
    envAnomalyPointCount: 2,
    todayDiseaseCount: 3,
    ...extra,
  };
}

test('online heartbeats stay off the fixture file', () => {
  const before = readFixture(HEARTBEAT_FIXTURE);
  assert.equal(before.body.deviceCode, 'EDGE-SIM-BOX');
  assert.equal(before.body.deviceType, 'ai_box');
  const now = new Date('2026-10-16T04:00:00.000Z');
  const beats = validateOnlineHeartbeats(now);
  assert.equal(beats.length, 3);
  assert.deepEqual(
    beats.map((body) => body.deviceCode),
    ['CAM-DOT-01', 'BOX-DOT-01', 'SENSOR-DOT-01'],
  );
  assert.deepEqual(
    beats.map((body) => body.deviceType),
    ['camera', 'ai_box', 'sensor'],
  );
  assert.equal(buildOnlineHeartbeat(DEMO_DEVICES[0], now).online, true);
  assert.equal(DEMO_DEVICES.filter((row) => !row.online).length, 3);
  assert.deepEqual(CONTRAST_CODES, ['CAM-DOT-NONE', 'BOX-DOT-NONE', 'SENSOR-DOT-NONE']);
  const after = readFixture(HEARTBEAT_FIXTURE);
  assert.deepEqual(after, before);
});

test('clean inventory note is camera 1/6, box 1/4, sensor 1/4', () => {
  const devices = cleanInventory();
  const checked = assertOverviewDeviceOnline(overviewFrom(EXPECTED_CLEAN), devices);
  assert.equal(checked.clean, true);
  assert.equal(checked.note, EXPECTED_CLEAN_NOTE);
  assert.equal(checked.note, '摄像头 1/6 · AI盒子 1/4 · 传感器 1/4');
  const proof = formatDeviceOnlineByTypeProof(checked);
  assert.equal(proof.split('\n')[0], EXPECTED_CLEAN_NOTE);
  assert.match(proof, /CAM-DOT-01/);
  assert.match(proof, /不改值班看板/);
  assert.match(proof, /CAM-DOT-NONE/);
});

test('extra devices keep the same formula and are not the clean note', () => {
  const devices = [
    ...cleanInventory(),
    { code: 'CAM-OTHER', type: 'camera', onlineStatus: 'online', shedCode: 'S03' },
  ];
  const counts = {
    ...EXPECTED_CLEAN,
    cameraOnline: 2,
    cameraTotal: 7,
  };
  const mixed = assertOverviewDeviceOnline(overviewFrom(counts), devices);
  assert.equal(mixed.clean, false);
  assert.equal(mixed.note, '摄像头 2/7 · AI盒子 1/4 · 传感器 1/4');
  assert.throws(
    () => assertOverviewDeviceOnline(overviewFrom(EXPECTED_CLEAN), devices),
    /设备列表算出/,
  );
  assert.throws(
    () =>
      assertOverviewDeviceOnline(
        { ...overviewFrom(EXPECTED_CLEAN), cameraOnline: 1.5 },
        cleanInventory(),
      ),
    /契约|整数/,
  );
  assert.throws(
    () =>
      assertOverviewDeviceOnline(
        overviewFrom({ ...EXPECTED_CLEAN, cameraOnline: 9, cameraTotal: 6 }),
        cleanInventory(),
      ),
    /契约|在线数不能大于总数/,
  );
  const missing = cleanInventory().filter((row) => row.code !== 'SENSOR-DOT-01');
  assert.throws(() => assertOverviewDeviceOnline(overviewFrom(EXPECTED_CLEAN), missing), /SENSOR-DOT-01/);
  const contrast = [
    ...cleanInventory(),
    { code: 'CAM-DOT-NONE', type: 'camera', onlineStatus: 'offline', shedCode: 'S01' },
  ];
  assert.throws(
    () =>
      assertOverviewDeviceOnline(
        overviewFrom({ ...EXPECTED_CLEAN, cameraTotal: 7 }),
        contrast,
      ),
    /CAM-DOT-NONE/,
  );
});
