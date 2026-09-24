import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEndpoint } from './object-lifecycle.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const plan = JSON.parse(readFileSync(join(root, 'infra/object-lifecycle.json'), 'utf8'));

export function sameBytes(left, right) {
  if (!Buffer.isBuffer(left) || !Buffer.isBuffer(right)) return false;
  if (left.length !== right.length) return false;
  return left.equals(right);
}

export async function collectListed(source) {
  if (Array.isArray(source)) return source;
  if (source && typeof source[Symbol.asyncIterator] === 'function') {
    const rows = [];
    for await (const row of source) rows.push(row);
    return rows;
  }
  if (source && typeof source.on === 'function') {
    return await new Promise((resolveList, reject) => {
      const rows = [];
      source.on('data', (row) => rows.push(row));
      source.on('error', reject);
      source.on('end', () => resolveList(rows));
    });
  }
  throw new Error('热端无法列出对象');
}

export async function readBody(client, bucket, name) {
  const body = await client.getObject(bucket, name);
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body);
  const chunks = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function ensureBucket(client, bucket) {
  if (typeof client.bucketExists !== 'function') return;
  if (await client.bucketExists(bucket)) return;
  if (typeof client.makeBucket !== 'function') {
    throw new Error(`冷端没有桶 ${bucket}`);
  }
  await client.makeBucket(bucket);
}

function failureText(error) {
  const code = error?.code || '';
  const message = error?.message || String(error);
  if (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    code === 'EHOSTUNREACH' ||
    /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|socket hang up|connect/i.test(message)
  ) {
    return `MinIO 不可达，热冷复制中断：${message}`;
  }
  return `热冷复制失败：${message}`;
}

function endpointOf(env, name) {
  return env[name]?.trim() || '';
}

async function defaultClients(side, options) {
  void side;
  let minio;
  try {
    minio = require(join(root, 'apps/api/node_modules/minio'));
  } catch (error) {
    throw new Error(`无法加载 minio 客户端：${error.message}`);
  }
  const parsed = parseEndpoint(options.endpoint, options.useSSL);
  return new minio.Client({
    endPoint: parsed.endPoint,
    port: parsed.port,
    useSSL: parsed.useSSL,
    accessKey: options.accessKey,
    secretKey: options.secretKey,
  });
}

/**
 * 未设置 MINIO_APPLY_TIER=1 时只打印计划，退出码 0。
 * 已要求执行时把超龄 snapshots/ 复制到冷 MinIO，读回字节一致后才从热端删除。
 * 不调用 setBucketLifecycle，也不把本地单 MinIO 记成生命周期已下发。
 */
export async function runObjectTier({
  env = process.env,
  log = console.log,
  error = console.error,
  clientFactory = defaultClients,
  now = new Date(),
  source = plan,
} = {}) {
  const hotDays = Number(env.OBJECT_HOT_DAYS || source.hotDays);
  const prefix = source.prefix;
  log(
    `热冷分层计划：前缀 ${prefix} 超过 ${hotDays} 天的对象从热 MinIO 复制到冷 MinIO，读回字节一致后从热端删除。`,
  );
  log('PostgreSQL 只存对象键。管理端打开抓拍仍只读热端。本命令不上传新图片。');
  log('本命令不调用 setBucketLifecycle，也不声明云存储类规则已经生效。');

  if (env.MINIO_APPLY_TIER !== '1') {
    log(
      '热冷复制未执行。要执行请设置 MINIO_APPLY_TIER=1，以及热端 MINIO_ENDPOINT、MINIO_ACCESS_KEY、MINIO_SECRET_KEY 和冷端 MINIO_COLD_ENDPOINT、MINIO_COLD_ACCESS_KEY、MINIO_COLD_SECRET_KEY。',
    );
    return { applied: false, exitCode: 0, moved: 0 };
  }
  if (!Number.isInteger(hotDays) || hotDays < 1) {
    error(`OBJECT_HOT_DAYS 必须是正整数。未改对象。当前值：${env.OBJECT_HOT_DAYS}`);
    return { applied: false, exitCode: 1, moved: 0 };
  }

  const hotEndpoint = endpointOf(env, 'MINIO_ENDPOINT');
  const hotKey = endpointOf(env, 'MINIO_ACCESS_KEY');
  const hotSecret = endpointOf(env, 'MINIO_SECRET_KEY');
  const coldEndpoint = endpointOf(env, 'MINIO_COLD_ENDPOINT');
  const coldKey = endpointOf(env, 'MINIO_COLD_ACCESS_KEY');
  const coldSecret = endpointOf(env, 'MINIO_COLD_SECRET_KEY');
  if (!hotEndpoint || !hotKey || !hotSecret) {
    error('已要求执行热冷复制，但缺少热端 MINIO_ENDPOINT、MINIO_ACCESS_KEY 或 MINIO_SECRET_KEY。未改对象。');
    return { applied: false, exitCode: 1, moved: 0 };
  }
  if (!coldEndpoint || !coldKey || !coldSecret) {
    error(
      '已要求执行热冷复制，但缺少冷端 MINIO_COLD_ENDPOINT、MINIO_COLD_ACCESS_KEY 或 MINIO_COLD_SECRET_KEY。未改对象。',
    );
    return { applied: false, exitCode: 1, moved: 0 };
  }

  const hotBucket = endpointOf(env, 'MINIO_BUCKET') || source.bucket;
  const coldBucket = endpointOf(env, 'MINIO_COLD_BUCKET') || hotBucket;
  const cutoff = now.getTime() - hotDays * 24 * 60 * 60 * 1000;
  let moved = 0;
  try {
    const hot = await clientFactory('hot', {
      endpoint: hotEndpoint,
      accessKey: hotKey,
      secretKey: hotSecret,
      useSSL: env.MINIO_USE_SSL === '1',
    });
    const cold = await clientFactory('cold', {
      endpoint: coldEndpoint,
      accessKey: coldKey,
      secretKey: coldSecret,
      useSSL: env.MINIO_COLD_USE_SSL === '1',
    });
    await ensureBucket(cold, coldBucket);
    const listed = await collectListed(hot.listObjectsV2(hotBucket, prefix, true));
    let skipped = 0;
    for (const object of listed) {
      const name = object?.name || '';
      if (!name.startsWith(prefix)) continue;
      const modified = object.lastModified ? new Date(object.lastModified).getTime() : NaN;
      if (Number.isNaN(modified)) {
        skipped += 1;
        continue;
      }
      if (modified >= cutoff) continue;
      const bytes = await readBody(hot, hotBucket, name);
      await cold.putObject(coldBucket, name, bytes);
      const back = await readBody(cold, coldBucket, name);
      if (!sameBytes(bytes, back)) {
        error(`冷端读回与热端不一致：${name}。热端对象保留。`);
        return { applied: false, exitCode: 1, moved };
      }
      await hot.removeObject(hotBucket, name);
      moved += 1;
    }
    if (skipped) {
      error(`跳过 ${skipped} 个没有修改时间的对象，未从热端删除。`);
    }
  } catch (cause) {
    error(`${failureText(cause)} 已转移 ${moved} 个；当前对象留在热端。`);
    return { applied: false, exitCode: 1, moved };
  }

  log(
    moved
      ? `热冷复制已执行：从热桶 ${hotBucket} 转移 ${moved} 个对象到冷桶 ${coldBucket}，读回一致后已从热端删除。`
      : `热冷复制已执行：没有超过 ${hotDays} 天的 ${prefix} 对象。`,
  );
  return { applied: true, exitCode: 0, moved };
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  const result = await runObjectTier();
  process.exit(result.exitCode);
}
