import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const plan = JSON.parse(
  readFileSync(join(root, 'infra/object-lifecycle.json'), 'utf8'),
);
const hotDays = Number(process.env.OBJECT_HOT_DAYS || plan.hotDays);

console.log(
  `对象生命周期计划：桶 ${plan.bucket} 前缀 ${plan.prefix} 热 ${hotDays} 天后转 ${plan.coldStorageClass}。`,
);
console.log('PostgreSQL 只存对象键。本脚本不上传图片。');

const apply = process.env.MINIO_APPLY_LIFECYCLE === '1';
const alias = process.env.MC_ALIAS?.trim();
if (!apply || !alias) {
  console.log(
    '本地 MinIO 生命周期未下发。默认 compose 没有冷存储类。要下发请同时设置 MINIO_APPLY_LIFECYCLE=1 与 MC_ALIAS，并安装 mc。',
  );
  process.exit(0);
}

const mc = spawnSync('mc', ['--version'], { encoding: 'utf8' });
if (mc.status !== 0) {
  console.log('mc 不在 PATH 中，生命周期未下发。');
  process.exit(0);
}

const rule = spawnSync(
  'mc',
  [
    'ilm',
    'rule',
    'add',
    `${alias}/${plan.bucket}`,
    '--prefix',
    plan.prefix,
    '--transition-days',
    String(hotDays),
    '--transition-storage-class',
    String(plan.coldStorageClass),
  ],
  { encoding: 'utf8' },
);
if (rule.status !== 0) {
  console.error(rule.stderr || rule.stdout || 'mc ilm rule add failed');
  process.exit(rule.status ?? 1);
}
console.log(rule.stdout);
process.exit(0);
