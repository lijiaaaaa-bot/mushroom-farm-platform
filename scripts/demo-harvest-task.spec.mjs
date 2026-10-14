import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { readFixture, repoRoot } from './lib/ingest-wire.mjs';
import {
  DEMO_CAMERA as FIXTURE_CAMERA,
  DEMO_FIXTURE,
  validateDemoPayload,
} from './demo-one-http-recognition.mjs';
import {
  AFTERNOON_ASSIGNEE,
  AFTERNOON_CAMERA,
  AFTERNOON_MATURE,
  AFTERNOON_MUSHROOM,
  DEMO_SHED,
  MORNING_ASSIGNEE,
  MORNING_CAMERA,
  MORNING_MATURE,
  MORNING_MUSHROOM,
  TASK_CAMERAS,
  assertGeneratedTasks,
  assertScheduledTasks,
  buildHarvestTaskPayload,
  contrastText,
  formatHarvestTaskProof,
  harvestTaskUrl,
  scheduleHarvestTasks,
  schedulePatch,
  shanghaiDay,
} from './demo-harvest-task.mjs';

const now = new Date('2026-10-14T01:02:03.004Z');
const date = '2026-10-14';
const morningId = '11111111-1111-4111-8111-111111111111';
const afternoonId = '22222222-2222-4222-8222-222222222222';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

function taskRow(camera, overrides = {}) {
  return {
    id: camera.cameraCode === MORNING_CAMERA ? morningId : afternoonId,
    taskDate: date,
    shedCode: camera.shedCode,
    cameraCode: camera.cameraCode,
    matureCount: camera.matureCount,
    mushroomCount: camera.mushroomCount,
    status: 'open',
    assignee: null,
    shift: null,
    note: null,
    ...overrides,
  };
}

function taskPage(rows, schedule) {
  return {
    date,
    schedule,
    items: rows,
  };
}

test('payload keeps the fixture file and changes only this request', () => {
  const fixture = readFixture(DEMO_FIXTURE);
  assert.equal(fixture.body.cameraCode, FIXTURE_CAMERA);
  assert.equal(fixture.body.cameraCode, 'CAM-DEMO-01');
  assert.equal(fixture.body.matureCount, MORNING_MATURE);
  assert.equal(fixture.body.mushroomCount, MORNING_MUSHROOM);
  const morning = buildHarvestTaskPayload(now, TASK_CAMERAS[0]);
  const afternoon = buildHarvestTaskPayload(now, TASK_CAMERAS[1]);
  assert.equal(morning.cameraCode, MORNING_CAMERA);
  assert.equal(afternoon.cameraCode, AFTERNOON_CAMERA);
  assert.equal(morning.shedCode, DEMO_SHED);
  assert.equal(afternoon.shedCode, DEMO_SHED);
  assert.equal(morning.matureCount, MORNING_MATURE);
  assert.equal(morning.mushroomCount, MORNING_MUSHROOM);
  assert.equal(afternoon.matureCount, AFTERNOON_MATURE);
  assert.equal(afternoon.mushroomCount, AFTERNOON_MUSHROOM);
  assert.equal(morning.recognizedAt, now.toISOString());
  assert.equal(afternoon.recognizedAt, now.toISOString());
  assert.match(morning.idempotencyKey, /^demo-harvest-task-CAM-HT-01-\d+$/);
  assert.match(afternoon.idempotencyKey, /^demo-harvest-task-CAM-HT-02-\d+$/);
  assert.notEqual(morning.idempotencyKey, afternoon.idempotencyKey);
  assert.equal(morning.temperature, fixture.body.temperature);
  assert.equal(morning.snapshotBase64, fixture.body.snapshotBase64);
  assert.deepEqual(morning.capDiameters, fixture.body.capDiameters);
  assert.equal(validateDemoPayload(morning, now).cameraCode, MORNING_CAMERA);
  assert.equal(validateDemoPayload(afternoon, now).matureCount, AFTERNOON_MATURE);
  assert.equal(readFixture(DEMO_FIXTURE).body.cameraCode, 'CAM-DEMO-01');
  assert.equal(shanghaiDay(now), date);
  assert.deepEqual(schedulePatch(TASK_CAMERAS[0]), {
    assignee: MORNING_ASSIGNEE,
    shift: 'morning',
    status: 'scheduled',
  });
  assert.deepEqual(schedulePatch(TASK_CAMERAS[1]), {
    assignee: AFTERNOON_ASSIGNEE,
    shift: 'afternoon',
    status: 'scheduled',
  });
});

test('proof prints the date, the row count, the schedule and the contrast', () => {
  const generated = taskPage(
    [taskRow(TASK_CAMERAS[0]), taskRow(TASK_CAMERAS[1])],
    { morning: 0, afternoon: 0, unassigned: 2 },
  );
  const checked = assertGeneratedTasks(generated, date);
  assert.equal(checked.count, 2);
  const morning = taskRow(TASK_CAMERAS[0], {
    assignee: MORNING_ASSIGNEE,
    shift: 'morning',
    status: 'scheduled',
  });
  const afternoon = taskRow(TASK_CAMERAS[1], {
    assignee: AFTERNOON_ASSIGNEE,
    shift: 'afternoon',
    status: 'scheduled',
  });
  const scheduled = assertScheduledTasks(
    taskPage([morning, afternoon], { morning: 1, afternoon: 1, unassigned: 0 }),
  );
  assert.throws(
    () => assertGeneratedTasks(taskPage([taskRow(TASK_CAMERAS[0])], { morning: 0, afternoon: 0, unassigned: 1 }), date),
    /CAM-HT-02/,
  );
  assert.throws(
    () => assertScheduledTasks(taskPage([morning, taskRow(TASK_CAMERAS[1])], { morning: 1, afternoon: 0, unassigned: 1 })),
    /CAM-HT-02/,
  );
  const proof = formatHarvestTaskProof({
    date,
    generatedCount: checked.count,
    schedule: scheduled.schedule,
    morning,
    afternoon,
    webOrigin: 'http://127.0.0.1:43123',
  });
  const url = harvestTaskUrl(date, 'http://127.0.0.1:43123');
  assert.equal(url, 'http://127.0.0.1:43123/harvest?date=2026-10-14');
  assert.match(proof, /采摘任务: 已生成并排班/);
  assert.match(proof, /日期: 2026-10-14/);
  assert.match(proof, /生成行数: 2/);
  assert.match(proof, /排班: 上午 1 条，下午 1 条，未排 0 条/);
  assert.match(proof, new RegExp(`对照: ${contrastText(morning, afternoon).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(proof, /CAM-HT-01 王早 上午/);
  assert.match(proof, /CAM-HT-02 李午 下午/);
  assert.match(proof, new RegExp(`打开: ${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.doesNotMatch(proof, /CAM-DEMO-01/);
  assert.doesNotMatch(proof, /CAM-HAR-01/);
});

test('schedule posts generate then patches morning and afternoon', async () => {
  const calls = [];
  const original = global.fetch;
  try {
    global.fetch = async (url, init = {}) => {
      const target = String(url);
      const method = init.method || 'GET';
      calls.push({ target, method, body: init.body });
      if (method === 'POST' && target.includes('/harvest/tasks/generate?date=2026-10-14')) {
        return jsonResponse(201, taskPage(
          [taskRow(TASK_CAMERAS[1]), taskRow(TASK_CAMERAS[0])],
          { morning: 0, afternoon: 0, unassigned: 2 },
        ));
      }
      if (method === 'PATCH' && target.endsWith(`/harvest/tasks/${morningId}`)) {
        assert.deepEqual(JSON.parse(init.body), schedulePatch(TASK_CAMERAS[0]));
        return jsonResponse(200, taskRow(TASK_CAMERAS[0], schedulePatch(TASK_CAMERAS[0])));
      }
      if (method === 'PATCH' && target.endsWith(`/harvest/tasks/${afternoonId}`)) {
        assert.deepEqual(JSON.parse(init.body), schedulePatch(TASK_CAMERAS[1]));
        return jsonResponse(200, taskRow(TASK_CAMERAS[1], schedulePatch(TASK_CAMERAS[1])));
      }
      if (method === 'GET' && target.includes('/harvest/tasks?date=2026-10-14')) {
        return jsonResponse(200, taskPage(
          [
            taskRow(TASK_CAMERAS[0], schedulePatch(TASK_CAMERAS[0])),
            taskRow(TASK_CAMERAS[1], schedulePatch(TASK_CAMERAS[1])),
          ],
          { morning: 1, afternoon: 1, unassigned: 0 },
        ));
      }
      throw new Error(`unexpected ${method} ${target}`);
    };
    const result = await scheduleHarvestTasks('token', date);
    assert.equal(result.generatedCount, 2);
    assert.equal(result.schedule.morning, 1);
    assert.equal(result.schedule.afternoon, 1);
    assert.equal(result.schedule.unassigned, 0);
    assert.equal(result.morning.assignee, MORNING_ASSIGNEE);
    assert.equal(result.afternoon.shift, 'afternoon');
    assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
    assert.equal(calls.filter((call) => call.method === 'PATCH').length, 2);
    assert.equal(calls.filter((call) => call.method === 'GET').length, 1);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls.at(-1).method, 'GET');
  } finally {
    global.fetch = original;
  }
});

test('make target and the demo doc name the task list and the shifts', () => {
  const root = repoRoot();
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  assert.match(makefile, /^demo-harvest-task:.*\n\tnode scripts\/demo-harvest-task\.mjs\s*$/m);
  assert.match(makefile, /scripts\/demo-harvest-task\.spec\.mjs/);
  assert.match(makefile, /^demo-harvest-list:.*\n\tnode scripts\/demo-harvest-list\.mjs\s*$/m);
  assert.match(makefile, /^demo-harvest-filter:.*\n\tnode scripts\/demo-harvest-filter\.mjs\s*$/m);
  const doc = readFileSync(join(root, 'docs/DEMO_HARVEST_TASK.md'), 'utf8');
  assert.match(doc, /make demo-harvest-task/);
  assert.match(doc, /CAM-HT-01/);
  assert.match(doc, /CAM-HT-02/);
  assert.match(doc, /王早/);
  assert.match(doc, /李午/);
  assert.match(doc, /上午/);
  assert.match(doc, /下午/);
  assert.match(doc, /未排/);
  assert.match(doc, /生成当日清单/);
  assert.match(doc, /保存排班/);
  assert.match(doc, /docs\/evidence\/demo-harvest-task\/after-generate\.png/);
  assert.match(doc, /docs\/evidence\/demo-harvest-task\/after-assign\.png/);
  assert.doesNotMatch(doc, /假定|假设/);
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  assert.match(caps, /make demo-harvest-task/);
  assert.match(caps, /DEMO_HARVEST_TASK\.md/);
  assert.match(caps, /CAM-HT-01/);
  assert.match(caps, /CAM-HT-02/);
  const listDoc = readFileSync(join(root, 'docs/DEMO_HARVEST_LIST.md'), 'utf8');
  assert.match(listDoc, /不生成采摘任务/);
  const filterDoc = readFileSync(join(root, 'docs/DEMO_HARVEST_FILTER.md'), 'utf8');
  assert.match(filterDoc, /不生成采摘任务/);
});
