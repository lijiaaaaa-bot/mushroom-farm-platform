import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const features = [
  'alerts',
  'audit',
  'auth',
  'dashboard',
  'devices',
  'harvest',
  'ingest',
  'maintenance',
  'meta',
  'phase2',
  'redis',
  'reports',
  'seed',
  'sheds',
  'storage',
];
const deepImport = new RegExp(
  String.raw`from\s+['"](?:\./|\.\./)(?:${features.join('|')})/[^'"]+['"]`,
);
const webForbidden = /from\s+['"](?:@nestjs\/|[^'"]*apps\/api|[^'"]*\/entities\/)/;
const duplicatedDto = /(?:interface|type)\s+CanonicalRecognition\b/;

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, acc);
    else if (/\.(ts|vue)$/.test(name)) acc.push(path);
  }
  return acc;
}

const failures = [];
for (const file of walk('apps/api/src')) {
  const text = readFileSync(file, 'utf8');
  if (deepImport.test(text)) failures.push(`${file}: 深入了其他模块内部文件`);
}
for (const file of walk('apps/web/src')) {
  const text = readFileSync(file, 'utf8');
  if (webForbidden.test(text)) failures.push(`${file}: web 不能引用 Nest 内部`);
  if (duplicatedDto.test(text)) failures.push(`${file}: 手写了 CanonicalRecognition，应从 @mushroom/contracts 导入`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('module boundaries ok');
