import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const EVIDENCE_NOTE =
  '报文来自 packages/contracts/fixtures 契约黄金报文（心跳为 heartbeat.mqtt.json）。withRuntimeClock 只改 recognizedAt。不是客户现场抓包。';

export function openEvidence(dir) {
  mkdirSync(join(dir, 'steps'), { recursive: true });
  const steps = [];
  return {
    dir,
    addStep(step) {
      if (!step || typeof step !== 'object') throw new Error('证据步骤不是对象');
      if (!step.timestamp) throw new Error('证据步骤缺 timestamp');
      if (step.channel !== 'http' && step.channel !== 'mqtt') {
        throw new Error(`证据步骤 channel 无效: ${step.channel}`);
      }
      if (!step.topic && !step.path) throw new Error('证据步骤缺 topic 或 path');
      if (!('fixture' in step)) throw new Error('证据步骤缺 fixture');
      if (!('rawBody' in step)) throw new Error('证据步骤缺 rawBody');
      if (typeof step.pass !== 'boolean') throw new Error('证据步骤缺 pass');
      const index = String(steps.length + 1).padStart(2, '0');
      const id = step.id || `step-${index}`;
      const wireBytesFile =
        typeof step.rawUtf8 === 'string' ? `steps/${index}-${id}.body.json` : null;
      const record = { ...step, id, wireBytesFile };
      if (wireBytesFile) writeFileSync(join(dir, wireBytesFile), step.rawUtf8);
      writeFileSync(join(dir, 'steps', `${index}-${id}.json`), `${JSON.stringify(record, null, 2)}\n`);
      steps.push(record);
      return record;
    },
    finish({ pass, error = null, startedAt, mqttUrl = null, apiBase = null }) {
      const summary = {
        kind: 'contract-golden-fixture-smoke',
        note: EVIDENCE_NOTE,
        startedAt: startedAt || steps[0]?.timestamp || new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        pass: pass === true,
        error,
        mqttUrl,
        apiBase,
        steps,
      };
      writeFileSync(join(dir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
      return summary;
    },
  };
}
