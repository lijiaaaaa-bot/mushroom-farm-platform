import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

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
const recognitionPost = /@Post\(\s*['"]recognition['"]\s*\)/;

const requiredPaths = [
  'apps/api/src/ingest/ingest.controller.ts',
  'apps/api/src/ingest/mqtt.adapter.ts',
  'apps/api/src/ingest/ingest.service.ts',
  'apps/api/src/ingest/ingest.wall.spec.ts',
  'apps/api/src/main.ts',
  'apps/api/src/configure-app.ts',
  'packages/contracts/src/index.ts',
];

function normalize(filePath) {
  return filePath.split('\\').join('/');
}

export function importViolations(filePath, text) {
  const path = normalize(filePath);
  const failures = [];
  deepImport.lastIndex = 0;
  webForbidden.lastIndex = 0;
  duplicatedDto.lastIndex = 0;
  if (path.startsWith('apps/api/') && deepImport.test(text)) {
    failures.push(`${path}: 深入了其他模块内部文件`);
  }
  if (path.startsWith('apps/web/')) {
    if (webForbidden.test(text)) failures.push(`${path}: web 不能引用 Nest 内部`);
    if (duplicatedDto.test(text)) {
      failures.push(`${path}: 手写了 CanonicalRecognition，应从 @mushroom/contracts 导入`);
    }
  }
  return failures;
}

export function ingestViolations(filePath, text) {
  const path = normalize(filePath);
  if (!path.startsWith('apps/api/') || !path.endsWith('.ts')) return [];
  if (path.endsWith('apps/api/src/ingest/ingest.wall.spec.ts')) {
    const failures = [];
    if (!text.includes('UNKNOWN_FIELD')) failures.push(`${path}: 必须断言 UNKNOWN_FIELD`);
    if (!/from\s+['"]\.\.\/configure-app['"]/.test(text)) {
      failures.push(`${path}: 必须从 configure-app 导入 configureApp`);
    }
    if (!text.includes('onMessage')) failures.push(`${path}: 必须覆盖 MQTT onMessage`);
    if (!text.includes("'mqtt'") && !text.includes('"mqtt"')) {
      failures.push(`${path}: 必须断言 mqtt 来源`);
    }
    return failures;
  }
  if (path.endsWith('.spec.ts')) return [];
  const failures = [];
  const isController = path.endsWith('.controller.ts');
  const isAdapter = path.endsWith('.adapter.ts');
  const inIngest = path.includes('/ingest/');

  if (inIngest && (isController || isAdapter)) {
    const source = isController ? 'http' : 'mqtt';
    if (!text.includes('IngestService')) {
      failures.push(`${path}: 必须引用 IngestService`);
    }
    const call = new RegExp(
      String.raw`this\.ingest\.handle\(\s*body\s*,\s*'${source}'\s*\)`,
    );
    if (!call.test(text)) {
      failures.push(`${path}: 必须调用 this.ingest.handle(body, '${source}')`);
    }
    if (text.includes('RecognitionRecord') || /parseRecognitionIngress\s*\(/.test(text)) {
      failures.push(`${path}: 不能绕过 IngestService 直接解析或写识别记录`);
    }
  }

  if (path.endsWith('apps/api/src/ingest/ingest.controller.ts')) {
    if (!/@Body\(\)\s+body:\s*unknown/.test(text)) {
      failures.push(`${path}: 识别报文参数必须是 @Body() body: unknown`);
    }
  }

  if (path.endsWith('apps/api/src/ingest/mqtt.adapter.ts')) {
    if (!/on\(\s*['"]message['"][\s\S]*?onMessage\(/.test(text)) {
      failures.push(`${path}: MQTT message 回调必须进入 onMessage`);
    }
  }

  if (path.endsWith('apps/api/src/ingest/ingest.service.ts')) {
    if (!/parseRecognitionIngress\s*\(/.test(text)) {
      failures.push(`${path}: 必须调用 parseRecognitionIngress`);
    }
  } else if (/parseRecognitionIngress\s*\(/.test(text)) {
    failures.push(`${path}: parseRecognitionIngress 只能在 IngestService 内调用`);
  }

  recognitionPost.lastIndex = 0;
  if (recognitionPost.test(text) && !path.endsWith('apps/api/src/ingest/ingest.controller.ts')) {
    failures.push(`${path}: recognition POST 只能在 ingest.controller.ts`);
  }

  if (path.endsWith('apps/api/src/main.ts')) {
    if (!/from\s+['"]\.\/configure-app['"]/.test(text) || !/configureApp\s*\(/.test(text)) {
      failures.push(`${path}: 必须调用 configureApp`);
    }
  }

  return failures;
}

export function contractsViolations(text) {
  const marker = 'export function parseRecognitionIngress';
  const start = text.indexOf(marker);
  if (start < 0) return ['packages/contracts/src/index.ts: 缺少 parseRecognitionIngress'];
  const rest = text.slice(start + marker.length);
  const next = rest.search(/\nexport function /);
  const body = next < 0 ? rest : rest.slice(0, next);
  if (!body.includes('recognitionIngressSchema.safeParse(')) {
    return ['parseRecognitionIngress 必须调用 recognitionIngressSchema.safeParse'];
  }
  return [];
}

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, acc);
    else if (/\.(ts|vue)$/.test(name)) acc.push(path);
  }
  return acc;
}

export function scanRepository(root = '.') {
  const failures = [];
  const seen = new Set();
  const files = [
    ...walk(join(root, 'apps/api/src')),
    ...walk(join(root, 'apps/web/src')),
    join(root, 'packages/contracts/src/index.ts'),
  ];
  for (const file of files) {
    const rel = normalize(relative(root, file));
    seen.add(rel);
    const text = readFileSync(file, 'utf8');
    failures.push(...importViolations(rel, text));
    failures.push(...ingestViolations(rel, text));
    if (rel === 'packages/contracts/src/index.ts') failures.push(...contractsViolations(text));
  }
  for (const required of requiredPaths) {
    if (!seen.has(required)) failures.push(`缺少 ${required}`);
  }
  const boundarySpec = join(root, 'scripts/boundaries.spec.mjs');
  if (!existsSync(boundarySpec)) failures.push('缺少 scripts/boundaries.spec.mjs');
  else {
    const text = readFileSync(boundarySpec, 'utf8');
    if (!text.includes('no-restricted-imports')) {
      failures.push('scripts/boundaries.spec.mjs 必须检查 no-restricted-imports');
    }
    if (!text.includes('ingestViolations')) {
      failures.push('scripts/boundaries.spec.mjs 必须检查 ingestViolations');
    }
    if (!text.includes('importViolations')) {
      failures.push('scripts/boundaries.spec.mjs 必须检查 importViolations');
    }
  }
  return failures;
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(realpathSync(entry)).href;
}

if (invokedDirectly()) {
  const failures = scanRepository('.');
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  console.log('module boundaries ok');
}
