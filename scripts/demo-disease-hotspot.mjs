#!/usr/bin/env node
/**
 * 写入两棚病害识别，病害页按小时和按日都能看出高发时段与高发棚区。
 * 样例文件 recognition.demo-disease-hotspot.json 不改。
 * S03 当前小时三台摄像头各 4，棚合计 12；S02 在 3 小时前是 1；S03 在 2 日前是 1。
 * 同一小时再跑沿用幂等键，不另建一行。
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  apiBase,
  ingestRecognitionUrl,
  ingestToken,
  postJson,
  readFixture,
  repoRoot,
} from './lib/ingest-wire.mjs';
import { webOriginFromEnv } from './demo-one-http-recognition.mjs';

const require = createRequire(import.meta.url);
const HOUR_MS = 60 * 60 * 1000;

export const DEMO_FIXTURE = 'recognition.demo-disease-hotspot.json';
export const PEAK_SHED = 'S03';
export const LOW_SHED = 'S02';
export const PEAK_CAMERAS = ['CAM-DH-A', 'CAM-DH-B', 'CAM-DH-C'];
export const LOW_HOUR_CAMERA = 'CAM-DH-LOW';
export const LOW_DAY_CAMERA = 'CAM-DH-DAY';
export const PEAK_EACH = 4;
export const LOW_COUNT = 1;
export const PEAK_HOUR_TOTAL = PEAK_CAMERAS.length * PEAK_EACH;
export const DISEASE_LEVEL = 1;
export const LOW_HOUR_OFFSET = 3;
export const LOW_DAY_OFFSET = 48;

function contracts() {
  return require(join(repoRoot(), 'packages/contracts/dist/index.js'));
}

export function bucketStartFor(at, grain) {
  if (grain === 'hour') return contracts().shanghaiHourStart(at).toISOString();
  return contracts().shanghaiDayRange(contracts().shanghaiDate(at)).start.toISOString();
}

function inGrainWindow(at, grain, now) {
  if (grain === 'hour') {
    const end = contracts().shanghaiHourStart(now);
    const start = new Date(end.getTime() - 23 * HOUR_MS);
    const bucket = contracts().shanghaiHourStart(at).getTime();
    return bucket >= start.getTime() && bucket <= end.getTime();
  }
  const to = contracts().shanghaiDate(now);
  const from = contracts().shiftShanghaiDate(to, -6);
  const day = contracts().shanghaiDate(at);
  return day >= from && day <= to;
}

export function buildHotspotPayloads(now = new Date()) {
  const fixture = readFixture(DEMO_FIXTURE);
  return fixture.points.map((point) => {
    const at = new Date(now.getTime() - point.offsetHours * HOUR_MS);
    const stamp =
      point.offsetHours >= 24
        ? contracts().shanghaiDate(at)
        : contracts().shanghaiHourStart(at).toISOString();
    return {
      role: point.role,
      shedCode: point.shedCode,
      cameraCode: point.cameraCode,
      offsetHours: point.offsetHours,
      diseaseCount: point.diseaseCount,
      at,
      body: {
        idempotencyKey: `demo-disease-hotspot-${point.cameraCode}-${stamp}`,
        shedCode: point.shedCode,
        cameraCode: point.cameraCode,
        recognizedAt: at.toISOString(),
        mushroomCount: fixture.mushroomCount,
        matureCount: fixture.matureCount,
        capDiameters: [...fixture.body.capDiameters],
        diseaseCount: point.diseaseCount,
        diseaseLevel: fixture.diseaseLevel,
        snapshotBase64: fixture.snapshotBase64,
        temperature: fixture.temperature,
        humidity: fixture.humidity,
        co2: fixture.co2,
        substrateMoisture: fixture.substrateMoisture,
      },
    };
  });
}

export function validateHotspotPayloads(samples, now = new Date()) {
  if (samples.length !== 5) throw new Error(`样例是 ${samples.length} 条，应为 5 条`);
  const peaks = samples.filter((sample) => sample.role === 'peak');
  const lowHour = samples.find((sample) => sample.role === 'low-hour');
  const lowDay = samples.find((sample) => sample.role === 'low-day');
  if (peaks.length !== PEAK_CAMERAS.length || !lowHour || !lowDay) {
    throw new Error('样例缺少峰值、低小时或低日');
  }
  if (peaks.some((sample) => sample.diseaseCount !== PEAK_EACH)) {
    throw new Error(`峰值摄像头的病害数量不是 ${PEAK_EACH}`);
  }
  if (lowHour.diseaseCount !== LOW_COUNT || lowDay.diseaseCount !== LOW_COUNT) {
    throw new Error(`对照病害数量不是 ${LOW_COUNT}`);
  }
  if (peaks.reduce((sum, sample) => sum + sample.diseaseCount, 0) !== PEAK_HOUR_TOTAL) {
    throw new Error(`当前小时合计不是 ${PEAK_HOUR_TOTAL}`);
  }
  const peakHour = bucketStartFor(peaks[0].at, 'hour');
  if (peaks.some((sample) => bucketStartFor(sample.at, 'hour') !== peakHour)) {
    throw new Error('三台峰值摄像头不在同一个小时');
  }
  if (bucketStartFor(lowHour.at, 'hour') === peakHour) {
    throw new Error('低小时和峰值小时是同一个桶');
  }
  if (bucketStartFor(lowDay.at, 'hour') === peakHour) {
    throw new Error('两日前和峰值小时是同一个桶');
  }
  if (!inGrainWindow(lowHour.at, 'hour', now) || inGrainWindow(lowDay.at, 'hour', now)) {
    throw new Error('低小时应在近 24 小时内，两日前应在这 24 小时外');
  }
  if (!inGrainWindow(lowDay.at, 'day', now) || !inGrainWindow(peaks[0].at, 'day', now)) {
    throw new Error('峰值和两日前都应在近 7 日内');
  }
  const keys = new Set();
  for (const sample of samples) {
    const result = contracts().parseRecognitionIngress(sample.body, now);
    if (!result.ok) throw new Error(`样例未通过契约：${result.errors.join('；')}`);
    const value = result.value;
    if (value.diseaseLevel !== DISEASE_LEVEL) throw new Error('病害等级不是 1');
    if (value.diseaseCount >= 5) throw new Error('病害数量达到种子规则「病害数量一般」的 5');
    if (value.diseaseLevel >= 2) throw new Error('病害等级达到种子规则「病害等级一般」的 2');
    if (value.matureCount / value.mushroomCount >= 0.6) {
      throw new Error('成熟占比达到种子规则「成熟占比一般」的 0.6');
    }
    if (value.temperature !== 22.5) throw new Error(`温度是 ${value.temperature}，应为 22.5`);
    if (value.diseaseCount !== sample.diseaseCount) throw new Error('报文病害数量和样例不一致');
    if (value.shedCode !== sample.shedCode || value.cameraCode !== sample.cameraCode) {
      throw new Error('报文棚区或摄像头和样例不一致');
    }
    if (keys.has(sample.body.idempotencyKey)) throw new Error('幂等键重复了');
    keys.add(sample.body.idempotencyKey);
  }
  if (peaks.some((sample) => sample.shedCode !== PEAK_SHED)) throw new Error(`峰值棚区不是 ${PEAK_SHED}`);
  if (lowHour.shedCode !== LOW_SHED) throw new Error(`低小时棚区不是 ${LOW_SHED}`);
  if (lowDay.shedCode !== PEAK_SHED) throw new Error('两日前不在峰值棚');
  const cameras = samples.map((sample) => sample.cameraCode);
  if (new Set(cameras).size !== cameras.length) throw new Error('摄像头编号重复了');
  return samples;
}

export function hotspotUrl(grain, webOrigin = webOriginFromEnv()) {
  const origin = String(webOrigin).replace(/\/$/, '');
  return `${origin}/diseases?grain=${encodeURIComponent(grain)}`;
}

function shedCount(peaks, shedCode) {
  const row = (peaks.byShed || []).find((item) => item?.shedCode === shedCode);
  return row ? Number(row.diseaseCount) : null;
}

export function assertHotspot(peaks, samples, grain, now = new Date()) {
  if (peaks?.grain !== grain) throw new Error(`粒度是 ${peaks?.grain || '空'}，应为 ${grain}`);
  const byTime = Array.isArray(peaks.byTime) ? peaks.byTime : [];
  const byShed = Array.isArray(peaks.byShed) ? peaks.byShed : [];
  if (byTime.length < 2) throw new Error('高发时段少于两段');
  if (byShed.length < 2) throw new Error('高发棚区少于两棚');
  const counts = byTime.map((row) => Number(row.diseaseCount));
  const maxTime = Math.max(...counts);
  if (!peaks.peak || Number(peaks.peak.diseaseCount) !== maxTime) {
    throw new Error('峰值不是时段里的最大病害数量');
  }
  if (!byTime.some((row) => row.bucketStart === peaks.peak.bucketStart && Number(row.diseaseCount) === maxTime)) {
    throw new Error('峰值时段不在高发时段表里');
  }
  for (let index = 1; index < byShed.length; index += 1) {
    const prev = Number(byShed[index - 1].diseaseCount);
    const next = Number(byShed[index].diseaseCount);
    if (prev < next || (prev === next && byShed[index - 1].shedCode > byShed[index].shedCode)) {
      throw new Error('棚区没有按病害数量从高到低排');
    }
  }
  const inWindow = samples.filter((sample) => inGrainWindow(sample.at, grain, now));
  const sumOf = (list) => list.reduce((sum, sample) => sum + sample.diseaseCount, 0);
  const bucketOf = (sample) => bucketStartFor(sample.at, grain);
  const peakSamples = inWindow.filter((sample) => sample.role === 'peak');
  const contrast = inWindow.find((sample) => sample.role === (grain === 'hour' ? 'low-hour' : 'low-day'));
  if (!peakSamples.length || !contrast) throw new Error('窗口里没有峰值或对照');
  const peakBucket = bucketOf(peakSamples[0]);
  const contrastBucket = bucketOf(contrast);
  if (peakBucket === contrastBucket) throw new Error('峰值时段和对照时段落在同一个桶');
  const peakRow = byTime.find((row) => row.bucketStart === peakBucket);
  const contrastRow = byTime.find((row) => row.bucketStart === contrastBucket);
  if (!peakRow) throw new Error('高发时段没有峰值这一小时或这一日');
  if (!contrastRow) throw new Error('高发时段没有对照这一小时或这一日');
  const peakMinimum = sumOf(inWindow.filter((sample) => bucketOf(sample) === peakBucket));
  const contrastMinimum = sumOf(inWindow.filter((sample) => bucketOf(sample) === contrastBucket));
  if (Number(peakRow.diseaseCount) < peakMinimum) {
    throw new Error(`峰值时段病害数量是 ${peakRow.diseaseCount}，至少应为 ${peakMinimum}`);
  }
  if (Number(contrastRow.diseaseCount) < contrastMinimum) {
    throw new Error(`对照时段病害数量是 ${contrastRow.diseaseCount}，至少应为 ${contrastMinimum}`);
  }
  if (!(Number(peakRow.diseaseCount) > Number(contrastRow.diseaseCount))) {
    throw new Error(
      `峰值时段病害数量 ${peakRow.diseaseCount} 没有高于对照时段 ${contrastRow.diseaseCount}`,
    );
  }
  const peakShed = byShed.find((row) => row.shedCode === PEAK_SHED);
  const lowShed = byShed.find((row) => row.shedCode === LOW_SHED);
  if (!peakShed) throw new Error(`高发棚区没有 ${PEAK_SHED}`);
  if (!lowShed) throw new Error(`高发棚区没有 ${LOW_SHED}`);
  const peakShedMinimum = sumOf(inWindow.filter((sample) => sample.shedCode === PEAK_SHED));
  const lowShedMinimum = sumOf(inWindow.filter((sample) => sample.shedCode === LOW_SHED));
  if (Number(peakShed.diseaseCount) < peakShedMinimum) {
    throw new Error(`${PEAK_SHED} 病害数量是 ${peakShed.diseaseCount}，至少应为 ${peakShedMinimum}`);
  }
  if (Number(lowShed.diseaseCount) < lowShedMinimum) {
    throw new Error(`${LOW_SHED} 病害数量是 ${lowShed.diseaseCount}，至少应为 ${lowShedMinimum}`);
  }
  if (!(Number(peakShed.diseaseCount) > Number(lowShed.diseaseCount))) {
    throw new Error(
      `${PEAK_SHED} 病害数量 ${peakShed.diseaseCount} 没有高于 ${LOW_SHED} 的 ${lowShed.diseaseCount}`,
    );
  }
  return { peakRow, contrastRow, peakShed, lowShed };
}

export function formatHotspotProof({
  hour,
  day,
  samples,
  duplicates,
  webOrigin = webOriginFromEnv(),
}) {
  const lines = [
    '病害高发: 小时与日',
    `峰值棚区: ${PEAK_SHED}`,
    `对照棚区: ${LOW_SHED}`,
    `小时峰值病害数量: ${hour.peak.diseaseCount}`,
    `小时最高棚区: ${hour.byShed[0].shedCode}`,
    `小时最高棚区病害数量: ${hour.byShed[0].diseaseCount}`,
    `小时 ${PEAK_SHED}: ${shedCount(hour, PEAK_SHED)}`,
    `小时 ${LOW_SHED}: ${shedCount(hour, LOW_SHED)}`,
    `日峰值病害数量: ${day.peak.diseaseCount}`,
    `日最高棚区: ${day.byShed[0].shedCode}`,
    `日 ${PEAK_SHED}: ${shedCount(day, PEAK_SHED)}`,
    `日 ${LOW_SHED}: ${shedCount(day, LOW_SHED)}`,
    '登录: admin / Admin@123456',
    `小时: ${hotspotUrl('hour', webOrigin)}`,
    `日: ${hotspotUrl('day', webOrigin)}`,
  ];
  for (const sample of samples) {
    const reused = duplicates.get(sample.body.idempotencyKey) ? '沿用' : '新建';
    lines.push(`${sample.cameraCode} ${sample.shedCode} 病害数量 ${sample.diseaseCount}（${reused}）`);
  }
  return lines.join('\n');
}

function messageText(payload) {
  const message = payload?.message ?? payload?.error;
  if (Array.isArray(message)) return message.join('；');
  if (typeof message === 'string') return message;
  return '';
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

async function login() {
  let response;
  try {
    response = await fetch(`${apiBase()}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'Admin@123456' }),
    });
  } catch (error) {
    throw new Error(`API 连不上（${apiBase()}）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const session = await readJson(response);
  if (!response.ok || !session.accessToken) {
    throw new Error(`登录失败 ${response.status}。确认 API 已用种子账号启动。`);
  }
  return session.accessToken;
}

function nestedFlag(payload, key) {
  return payload?.[key] === true || payload?.message?.[key] === true;
}

async function postRecognition(body) {
  let posted;
  try {
    posted = await postJson(ingestRecognitionUrl(), JSON.stringify(body), {
      'content-type': 'application/json',
      'x-ingest-token': ingestToken(),
    });
  } catch (error) {
    throw new Error(`API 连不上（${ingestRecognitionUrl()}）。先执行 make up、make migrate、make api。${error.message}`);
  }
  const payload = posted.responseBody;
  const accepted = payload?.accepted === true || payload?.message?.accepted === true;
  const id = payload?.id || payload?.message?.id;
  const duplicate = Boolean(payload?.duplicate || payload?.message?.duplicate);
  if (posted.responseStatus < 200 || posted.responseStatus >= 300 || !accepted || !id) {
    throw new Error(
      `接入拒绝 ${posted.responseStatus} ${messageText(payload) || JSON.stringify(payload)}`,
    );
  }
  if (!duplicate && !nestedFlag(payload, 'snapshotStored')) {
    throw new Error(
      '识别已入库，但 AI抓拍图没有写入对象存储。先执行 make up，确认对象存储在 127.0.0.1:9000，然后重新 make api。',
    );
  }
  return { id, duplicate };
}

async function getJson(token, url) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const body = await readJson(response);
  return { response, body };
}

async function readPeaks(token, grain) {
  const listed = await getJson(token, `${apiBase()}/diseases/peaks?grain=${grain}`);
  if (!listed.response.ok) {
    throw new Error(
      `高发统计失败 ${listed.response.status} ${messageText(listed.body) || JSON.stringify(listed.body)}`,
    );
  }
  return listed.body;
}

async function assertArchive(token, sample) {
  const listed = await getJson(
    token,
    `${apiBase()}/diseases?cameraCode=${encodeURIComponent(sample.cameraCode)}&pageSize=50`,
  );
  if (!listed.response.ok) {
    throw new Error(
      `病害列表失败 ${listed.response.status} ${messageText(listed.body) || JSON.stringify(listed.body)}`,
    );
  }
  const items = Array.isArray(listed.body?.items) ? listed.body.items : [];
  const row = items.find((item) => item?.cameraCode === sample.cameraCode);
  if (!row) throw new Error(`病害列表没有 ${sample.cameraCode}`);
  if (row.shedCode !== sample.shedCode) {
    throw new Error(`${sample.cameraCode} 的棚区是 ${row.shedCode || '空'}，应为 ${sample.shedCode}`);
  }
  if (row.diseaseCount !== sample.diseaseCount) {
    throw new Error(`${sample.cameraCode} 的病害数量是 ${row.diseaseCount}，应为 ${sample.diseaseCount}`);
  }
  if (row.diseaseLevel !== DISEASE_LEVEL) {
    throw new Error(`${sample.cameraCode} 的病害等级是 ${row.diseaseLevel}，应为 ${DISEASE_LEVEL}`);
  }
}

export async function sendHotspotDemo({ now = new Date() } = {}) {
  const samples = buildHotspotPayloads(now);
  validateHotspotPayloads(samples, now);
  const ordered = [...samples].sort((a, b) => a.at.getTime() - b.at.getTime());
  const duplicates = new Map();
  for (const sample of ordered) {
    const sent = await postRecognition(sample.body);
    duplicates.set(sample.body.idempotencyKey, sent.duplicate);
  }
  const token = await login();
  for (const sample of samples) {
    await assertArchive(token, sample);
  }
  const hour = await readPeaks(token, 'hour');
  const day = await readPeaks(token, 'day');
  assertHotspot(hour, samples, 'hour', now);
  assertHotspot(day, samples, 'day', now);
  return { hour, day, samples, duplicates };
}

function usage() {
  return `用法:
  node scripts/demo-disease-hotspot.mjs

写入 S03 与 S02 的病害高发对照，并打印小时和日两个地址。步骤见 docs/DEMO_DISEASE_HOTSPOT.md。`;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  try {
    const sent = await sendHotspotDemo();
    process.stdout.write(`${formatHotspotProof(sent)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
