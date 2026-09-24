import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const plan = JSON.parse(
  readFileSync(join(root, 'infra/object-lifecycle.json'), 'utf8'),
);

export function buildLifecycleConfig(source, hotDays) {
  return {
    Rule: [
      {
        ID: 'snapshots-hot-to-cold',
        Status: 'Enabled',
        Filter: { Prefix: source.prefix },
        Transition: {
          Days: hotDays,
          StorageClass: source.coldStorageClass,
        },
      },
    ],
  };
}

export function lifecycleRuleMatches(saved, prefix) {
  const raw = saved?.Rule ?? saved?.Rules ?? [];
  const rules = Array.isArray(raw) ? raw : [raw];
  return rules.some((rule) => {
    const rulePrefix = rule?.Filter?.Prefix ?? rule?.Prefix ?? '';
    return rulePrefix === prefix && String(rule?.Status || '').toLowerCase() === 'enabled';
  });
}

export function parseEndpoint(raw, useSSL) {
  let value = String(raw || '').trim();
  let ssl = useSSL;
  if (value.startsWith('https://')) {
    ssl = true;
    value = value.slice('https://'.length);
  } else if (value.startsWith('http://')) {
    ssl = false;
    value = value.slice('http://'.length);
  }
  value = value.replace(/\/$/, '');
  const colon = value.lastIndexOf(':');
  const host = colon > 0 ? value.slice(0, colon) : value;
  const portText = colon > 0 ? value.slice(colon + 1) : '';
  if (!host) throw new Error(`MINIO_ENDPOINT 无法解析：${raw}`);
  const port = portText ? Number(portText) : ssl ? 443 : 9000;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`MINIO_ENDPOINT 端口无效：${raw}`);
  }
  return { endPoint: host, port, useSSL: ssl };
}

export async function defaultClientFactory({ endpoint, accessKey, secretKey, useSSL }) {
  const parsed = parseEndpoint(endpoint, useSSL);
  let minio;
  try {
    minio = require(join(root, 'apps/api/node_modules/minio'));
  } catch (error) {
    throw new Error(`无法加载 minio 客户端：${error.message}`);
  }
  const Client = minio.Client;
  return new Client({
    endPoint: parsed.endPoint,
    port: parsed.port,
    useSSL: parsed.useSSL,
    accessKey,
    secretKey,
  });
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
    return `MinIO 不可达，生命周期未下发：${message}`;
  }
  return `MinIO 生命周期下发失败：${message}`;
}

/**
 * 未设置 MINIO_APPLY_LIFECYCLE=1 时只打印计划，退出码 0。
 * 已要求下发时必须连上 MinIO 并读回规则；失败则非零退出。
 */
export async function runObjectLifecycle({
  env = process.env,
  log = console.log,
  error = console.error,
  clientFactory = defaultClientFactory,
  source = plan,
} = {}) {
  const hotDays = Number(env.OBJECT_HOT_DAYS || source.hotDays);
  log(
    `对象生命周期计划：桶 ${source.bucket} 前缀 ${source.prefix} 热 ${hotDays} 天后转 ${source.coldStorageClass}。`,
  );
  log('PostgreSQL 只存对象键。本脚本不上传图片。');

  if (env.MINIO_APPLY_LIFECYCLE !== '1') {
    log(
      '本地 MinIO 生命周期未下发。要下发请设置 MINIO_APPLY_LIFECYCLE=1、MINIO_ENDPOINT、MINIO_ACCESS_KEY、MINIO_SECRET_KEY。',
    );
    return { applied: false, exitCode: 0 };
  }

  const endpoint = env.MINIO_ENDPOINT?.trim();
  const accessKey = env.MINIO_ACCESS_KEY?.trim();
  const secretKey = env.MINIO_SECRET_KEY?.trim();
  if (!endpoint || !accessKey || !secretKey) {
    error(
      '已要求下发对象生命周期，但缺少 MINIO_ENDPOINT、MINIO_ACCESS_KEY 或 MINIO_SECRET_KEY。未改桶。',
    );
    return { applied: false, exitCode: 1 };
  }
  if (!Number.isInteger(hotDays) || hotDays < 1) {
    error(`OBJECT_HOT_DAYS 必须是正整数。未改桶。当前值：${env.OBJECT_HOT_DAYS}`);
    return { applied: false, exitCode: 1 };
  }

  const bucket = env.MINIO_BUCKET?.trim() || source.bucket;
  const config = buildLifecycleConfig(source, hotDays);
  let client;
  try {
    client = await clientFactory({
      endpoint,
      accessKey,
      secretKey,
      useSSL: env.MINIO_USE_SSL === '1',
    });
    if (typeof client.setBucketLifecycle !== 'function' || typeof client.getBucketLifecycle !== 'function') {
      throw new Error('客户端缺少生命周期读写方法');
    }
    await client.setBucketLifecycle(bucket, config);
    const saved = await client.getBucketLifecycle(bucket);
    if (!lifecycleRuleMatches(saved, source.prefix)) {
      error(`MinIO 未读回前缀 ${source.prefix} 的启用规则。未确认下发。`);
      return { applied: false, exitCode: 1 };
    }
  } catch (cause) {
    error(failureText(cause));
    return { applied: false, exitCode: 1 };
  }

  log(
    `对象生命周期已下发：桶 ${bucket} 前缀 ${source.prefix} 热 ${hotDays} 天后转 ${source.coldStorageClass}。`,
  );
  return { applied: true, exitCode: 0 };
}

const invokedDirectly =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  const result = await runObjectLifecycle();
  process.exit(result.exitCode);
}
