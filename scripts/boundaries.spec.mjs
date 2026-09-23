import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  contractsViolations,
  importViolations,
  ingestViolations,
  scanRepository,
} from './check-boundaries.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function restrictedImports(packageDir, configPath, filename, code) {
  const require = createRequire(join(packageDir, 'package.json'));
  const { ESLint } = require('eslint');
  const base = require(configPath);
  const eslint = new ESLint({
    cwd: packageDir,
    useEslintrc: false,
    resolvePluginsRelativeTo: packageDir,
    overrideConfig: {
      ...base,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
  });
  const [result] = await eslint.lintText(code, {
    filePath: join(packageDir, filename),
  });
  return result.messages.filter((message) => message.ruleId === 'no-restricted-imports');
}

describe('module boundaries', () => {
  it('flags a deep feature import', () => {
    const hits = importViolations(
      'apps/api/src/sheds/sheds.service.ts',
      "import { AlertsService } from '../alerts/alerts.service';\n",
    );
    assert.ok(hits.some((hit) => hit.includes('深入了其他模块内部文件')));
  });

  it('allows a barrel import', () => {
    const hits = importViolations(
      'apps/api/src/sheds/sheds.service.ts',
      "import { AlertsService } from '../alerts';\n",
    );
    assert.deepEqual(hits, []);
  });

  it('flags a web import of Nest internals', () => {
    const hits = importViolations(
      'apps/web/src/api.ts',
      "import { Module } from '@nestjs/common';\n",
    );
    assert.ok(hits.some((hit) => hit.includes('web 不能引用 Nest 内部')));
  });

  it('flags a controller that skips IngestService', () => {
    const hits = ingestViolations(
      'apps/api/src/ingest/ingest.controller.ts',
      'export class IngestController { async recognition(@Body() body: unknown) { return body; } }\n',
    );
    assert.ok(hits.some((hit) => hit.includes('IngestService')));
    assert.ok(hits.some((hit) => hit.includes("this.ingest.handle(body, 'http')")));
  });

  it('flags an adapter that skips IngestService', () => {
    const hits = ingestViolations(
      'apps/api/src/ingest/mqtt.adapter.ts',
      "export class MqttIngestAdapter { onMessage() { return; } }\n",
    );
    assert.ok(hits.some((hit) => hit.includes("this.ingest.handle(body, 'mqtt')")));
  });

  it('flags a service that skips parseRecognitionIngress', () => {
    const hits = ingestViolations(
      'apps/api/src/ingest/ingest.service.ts',
      'export class IngestService { async handle(raw: unknown) { return { accepted: true }; } }\n',
    );
    assert.ok(hits.some((hit) => hit.includes('parseRecognitionIngress')));
  });

  it('flags parseRecognitionIngress outside IngestService', () => {
    const hits = ingestViolations(
      'apps/api/src/meta/meta.controller.ts',
      'export function sneak(raw: unknown) { return parseRecognitionIngress(raw); }\n',
    );
    assert.ok(hits.some((hit) => hit.includes('只能在 IngestService')));
  });

  it('flags recognitionIngressSchema.safeParse missing from parseRecognitionIngress', () => {
    const hits = contractsViolations(
      'export function parseRecognitionIngress(raw: unknown) { return { ok: true, value: raw }; }\nexport function parseCreateAlert() { return null; }\n',
    );
    assert.ok(hits.some((hit) => hit.includes('recognitionIngressSchema.safeParse')));
  });

  it('accepts the current tree', () => {
    assert.deepEqual(scanRepository(root), []);
  });
});

describe('eslint no-restricted-imports', () => {
  it('rejects an api deep import and allows the barrel', async () => {
    const api = join(root, 'apps/api');
    const config = join(api, '.eslintrc.js');
    const blocked = await restrictedImports(
      api,
      config,
      'src/sheds/boundary-probe.ts',
      "import { AlertsService } from '../alerts/alerts.service';\nexport const probe = AlertsService;\n",
    );
    assert.ok(
      blocked.some((message) => message.message.includes('只能从 alerts 模块公共入口导入')),
    );
    const allowed = await restrictedImports(
      api,
      config,
      'src/sheds/boundary-probe.ts',
      "import { AlertsModule } from '../alerts';\nexport const probe = AlertsModule;\n",
    );
    assert.deepEqual(allowed, []);
  });

  it('rejects a web import of @nestjs and allows @mushroom/contracts', async () => {
    const web = join(root, 'apps/web');
    const config = join(web, '.eslintrc.cjs');
    const blocked = await restrictedImports(
      web,
      config,
      'src/boundary-probe.ts',
      "import { Module } from '@nestjs/common';\nexport const probe = Module;\n",
    );
    assert.ok(blocked.some((message) => message.message.includes('web 只能依赖')));
    const allowed = await restrictedImports(
      web,
      config,
      'src/boundary-probe.ts',
      "import { CONTRACT_VERSION } from '@mushroom/contracts';\nexport const probe = CONTRACT_VERSION;\n",
    );
    assert.deepEqual(allowed, []);
  });
});
