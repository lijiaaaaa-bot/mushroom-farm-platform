import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { repoRoot } from './lib/ingest-wire.mjs';
import {
  DEMO_CAMERA,
  DEMO_FIXTURE,
  DEMO_KIND,
  DEMO_MATURE,
  DEMO_MUSHROOM,
  DEMO_SHED,
  FIXTURE_CAMERA,
  assertGrowthPreview,
  assertWorkbook,
  buildReportPayload,
  formatReportProof,
  previewSearch,
  readZipEntries,
  reportPageUrl,
  sendReportXlsxDemo,
  validateReportPayload,
} from './demo-report-xlsx.mjs';

const root = repoRoot();
const recordId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function storedZip(files) {
  const parts = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const data = file.data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(file.method || 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(file.method || 0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuf, end]);
}

function workbookBytes() {
  const sheet = Buffer.from(
    '<?xml version="1.0"?><worksheet><sheetData><row r="1"><c><v>棚区</v></c></row><row r="2"><c><v>S02</v></c></row></sheetData></worksheet>',
  );
  return storedZip([
    {
      name: 'xl/workbook.xml',
      data: Buffer.from('<?xml version="1.0"?><workbook><sheets><sheet name="园区生长"/></sheets></workbook>'),
    },
    { name: 'xl/worksheets/sheet1.xml', method: 8, data: deflateRawSync(sheet) },
    {
      name: 'xl/sharedStrings.xml',
      data: Buffer.from('<?xml version="1.0"?><sst><si><t>S02</t></si></sst>'),
    },
  ]);
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get() { return ''; } },
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

function fileResponse(bytes) {
  return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        const key = String(name).toLowerCase();
        if (key === 'content-type') {
          return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        }
        if (key === 'content-disposition') return 'attachment; filename="export.xlsx"';
        return '';
      },
    },
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
    async json() {
      return {};
    },
  };
}

test('buildReportPayload keeps the fixture camera and retargets this demo', () => {
  const now = new Date('2026-10-14T04:00:00.000Z');
  const before = readFileSync(join(root, 'packages/contracts/fixtures', DEMO_FIXTURE), 'utf8');
  const body = buildReportPayload(now);
  validateReportPayload(body, now);
  assert.equal(body.cameraCode, DEMO_CAMERA);
  assert.equal(body.shedCode, DEMO_SHED);
  assert.equal(body.mushroomCount, DEMO_MUSHROOM);
  assert.equal(body.matureCount, DEMO_MATURE);
  assert.equal(body.idempotencyKey, `demo-report-xlsx-${now.getTime()}`);
  assert.equal(body.recognizedAt, now.toISOString());
  assert.equal(readFileSync(join(root, 'packages/contracts/fixtures', DEMO_FIXTURE), 'utf8'), before);
  assert.match(before, new RegExp(`"cameraCode": "${FIXTURE_CAMERA}"`));
});

test('preview address names growth, the day, and S02', () => {
  const day = '2026-10-14';
  assert.deepEqual(previewSearch(day), {
    kind: DEMO_KIND,
    grain: 'day',
    from: day,
    to: day,
    shedCode: DEMO_SHED,
  });
  assert.equal(previewSearch(day, '').shedCode, undefined);
  const filtered = reportPageUrl(day, { webOrigin: 'http://127.0.0.1:43123/' });
  const all = reportPageUrl(day, { shedCode: '', webOrigin: 'http://127.0.0.1:43123' });
  assert.equal(
    filtered,
    'http://127.0.0.1:43123/reports?kind=growth&grain=day&from=2026-10-14&to=2026-10-14&shedCode=S02',
  );
  assert.equal(all.includes('shedCode'), false);
  assert.match(all, /\/reports\?kind=growth/);
});

test('growth preview requires an S02 row and a real workbook', () => {
  const day = '2026-10-14';
  const preview = {
    kind: 'growth',
    grain: 'day',
    title: '园区生长',
    from: day,
    to: day,
    shedCode: DEMO_SHED,
    rows: [
      { shedCode: DEMO_SHED, period: day, mushroomCount: 20, matureCount: DEMO_MATURE },
      { shedCode: 'S01', period: day, mushroomCount: 1, matureCount: 1 },
    ],
  };
  assert.throws(() => assertGrowthPreview(preview, {
    day,
    shedFilter: DEMO_SHED,
    mushroom: DEMO_MUSHROOM,
    mature: DEMO_MATURE,
    onlyShed: true,
  }), /其他棚区/);
  const filtered = assertGrowthPreview(
    { ...preview, rows: [preview.rows[0]] },
    {
      day,
      shedFilter: DEMO_SHED,
      mushroom: DEMO_MUSHROOM,
      mature: DEMO_MATURE,
      onlyShed: true,
    },
  );
  assert.equal(filtered.count, 1);
  assert.throws(() => assertGrowthPreview({ ...preview, rows: [] }, {
    day,
    shedFilter: DEMO_SHED,
    mushroom: DEMO_MUSHROOM,
    mature: DEMO_MATURE,
    onlyShed: true,
  }), /没有行/);
  const book = assertWorkbook(workbookBytes());
  assert.equal(book.rows, 2);
  assert.ok(book.bytes > 0);
  assert.throws(() => readZipEntries(Buffer.from('not-a-zip')), /不是 xlsx/);
});

test('sendReportXlsxDemo posts one recognition and checks preview plus xlsx', async () => {
  const now = new Date('2026-10-14T04:00:00.000Z');
  const day = '2026-10-14';
  const calls = [];
  const original = globalThis.fetch;
  const bytes = workbookBytes();
  globalThis.fetch = async (url, init) => {
    const target = new URL(String(url));
    const method = init?.method || 'GET';
    calls.push(`${method} ${target.pathname}${target.search}`);
    if (target.pathname.endsWith('/ingest/recognition')) {
      const body = JSON.parse(init.body);
      assert.equal(body.cameraCode, DEMO_CAMERA);
      assert.equal(body.shedCode, DEMO_SHED);
      assert.equal(init.headers['x-ingest-token'], 'dev-ingest-token');
      return jsonResponse(201, { accepted: true, id: recordId, duplicate: false, snapshotStored: false });
    }
    if (target.pathname.endsWith('/auth/login')) {
      assert.deepEqual(JSON.parse(init.body), { username: 'admin', password: 'Admin@123456' });
      return jsonResponse(200, { accessToken: 'tok' });
    }
    if (target.pathname.endsWith('/ingest/recognitions')) {
      assert.equal(target.searchParams.get('cameraCode'), DEMO_CAMERA);
      assert.equal(init.headers.authorization, 'Bearer tok');
      return jsonResponse(200, {
        items: [
          {
            id: recordId,
            shedCode: DEMO_SHED,
            cameraCode: DEMO_CAMERA,
            mushroomCount: DEMO_MUSHROOM,
            matureCount: DEMO_MATURE,
            idempotencyKey: `demo-report-xlsx-${now.getTime()}`,
          },
        ],
        total: 1,
      });
    }
    if (target.pathname.endsWith('/reports/preview')) {
      assert.equal(target.searchParams.get('kind'), DEMO_KIND);
      assert.equal(target.searchParams.get('from'), day);
      assert.equal(target.searchParams.get('to'), day);
      const shed = target.searchParams.get('shedCode');
      const rows = [{ shedCode: DEMO_SHED, period: day, mushroomCount: DEMO_MUSHROOM, matureCount: DEMO_MATURE }];
      if (!shed) rows.push({ shedCode: 'S01', period: day, mushroomCount: 4, matureCount: 1 });
      return jsonResponse(200, {
        kind: 'growth',
        grain: 'day',
        title: '园区生长',
        from: day,
        to: day,
        shedCode: shed,
        rows,
      });
    }
    if (target.pathname.endsWith('/reports/export.xlsx')) {
      assert.equal(target.searchParams.get('shedCode'), DEMO_SHED);
      assert.equal(init.headers.authorization, 'Bearer tok');
      return fileResponse(bytes);
    }
    throw new Error(`unexpected ${method} ${target.pathname}`);
  };
  try {
    const result = await sendReportXlsxDemo(now);
    assert.equal(result.id, recordId);
    assert.equal(result.filteredCount, 1);
    assert.equal(result.allCount, 2);
    assert.equal(result.workbook.rows, 2);
    const proof = formatReportProof(result);
    assert.match(proof, /只看 S02 的行数: 1/);
    assert.match(proof, /全部棚的行数: 2/);
    assert.match(proof, /shedCode=S02/);
    assert.match(proof, /预览（全部棚）/);
    assert.equal(calls.filter((line) => line.startsWith('POST /api/v1/ingest/recognition')).length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('sendReportXlsxDemo fails when the API is down', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('connect ECONNREFUSED');
  };
  try {
    await assert.rejects(sendReportXlsxDemo(new Date('2026-10-14T04:00:00.000Z')), /make up、make migrate、make api/);
  } finally {
    globalThis.fetch = original;
  }
});

test('demo report docs and make target stay on the existing reports page', () => {
  const doc = readFileSync(join(root, 'docs/DEMO_REPORT_XLSX.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  assert.match(doc, /make demo-report-xlsx/);
  assert.match(doc, /CAM-RPT-01/);
  assert.match(doc, /已开始下载 growth\.xlsx/);
  assert.match(doc, /\/reports\?kind=growth/);
  assert.match(doc, /Mac/);
  assert.match(caps, /make demo-report-xlsx/);
  assert.match(caps, /DEMO_REPORT_XLSX\.md/);
  assert.match(status, /make demo-report-xlsx/);
  assert.match(readme, /DEMO_REPORT_XLSX\.md/);
  assert.match(
    makefile,
    /^demo-report-xlsx:.*\n\tnode scripts\/demo-report-xlsx\.mjs\s*$/m,
  );
  assert.match(makefile, /scripts\/demo-report-xlsx\.spec\.mjs/);
  const oneIngest = readFileSync(join(root, 'scripts/demo-one-http-recognition.mjs'), 'utf8');
  assert.doesNotMatch(oneIngest, /CAM-RPT-01|demo-report-xlsx/);
  const fixture = readFileSync(join(root, 'packages/contracts/fixtures/recognition.demo-one.json'), 'utf8');
  assert.match(fixture, /CAM-DEMO-01/);
});
