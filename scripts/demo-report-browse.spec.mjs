import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { repoRoot } from './lib/ingest-wire.mjs';
import {
  BROWSE_ROWS,
  DEMO_FIXTURE,
  FIXTURE_CAMERA,
  NARROW_SHED,
  assertBrowsePreview,
  assertBrowseWorkbook,
  browseKey,
  buildBrowsePayload,
  exportUrl,
  formatBrowseProof,
  sendReportBrowseDemo,
  validateBrowsePayload,
} from './demo-report-browse.mjs';

const root = repoRoot();
const s01 = BROWSE_ROWS[0];
const s02 = BROWSE_ROWS[1];

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

function workbookBytes(sheds) {
  const cells = sheds.map((shed) => `<row><c><v>${shed}</v></c></row>`).join('');
  const sheet = Buffer.from(
    `<?xml version="1.0"?><worksheet><sheetData><row r="1"><c><v>棚区</v></c></row>${cells}</sheetData></worksheet>`,
  );
  return storedZip([
    {
      name: 'xl/workbook.xml',
      data: Buffer.from('<?xml version="1.0"?><workbook><sheets><sheet name="园区生长"/></sheets></workbook>'),
    },
    { name: 'xl/worksheets/sheet1.xml', method: 8, data: deflateRawSync(sheet) },
    {
      name: 'xl/sharedStrings.xml',
      data: Buffer.from(`<?xml version="1.0"?><sst>${sheds.map((shed) => `<si><t>${shed}</t></si>`).join('')}</sst>`),
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

test('buildBrowsePayload keeps the fixture camera and writes both sheds', () => {
  const now = new Date('2026-10-14T04:00:00.000Z');
  const before = readFileSync(join(root, 'packages/contracts/fixtures', DEMO_FIXTURE), 'utf8');
  for (const spec of BROWSE_ROWS) {
    const body = buildBrowsePayload(spec, now);
    validateBrowsePayload(body, spec, now);
    assert.equal(body.cameraCode, spec.cameraCode);
    assert.equal(body.shedCode, spec.shedCode);
    assert.equal(body.mushroomCount, spec.mushroomCount);
    assert.equal(body.matureCount, spec.matureCount);
    assert.equal(body.idempotencyKey, browseKey(spec.shedCode, now));
    assert.equal(body.recognizedAt, now.toISOString());
  }
  assert.equal(readFileSync(join(root, 'packages/contracts/fixtures', DEMO_FIXTURE), 'utf8'), before);
  assert.match(before, new RegExp(`"cameraCode": "${FIXTURE_CAMERA}"`));
  assert.equal(browseKey('S01', now), 'demo-report-browse-S01-2026-10-14');
});

test('browse addresses name the wide preview, the S02 preview, and the export', () => {
  const day = '2026-10-14';
  const wide = 'http://127.0.0.1:43123/reports?kind=growth&grain=day&from=2026-10-14&to=2026-10-14';
  const narrow = `${wide}&shedCode=S02`;
  const proof = formatBrowseProof({
    posted: BROWSE_ROWS.map((spec) => ({ spec, id: 'id', duplicate: false })),
    day,
    wideCount: 2,
    narrowCount: 1,
    workbook: { bytes: 20, rows: 2 },
    webOrigin: 'http://127.0.0.1:43123',
  });
  assert.equal(proof.includes(`预览（全部棚）: ${wide}`), true);
  assert.equal(proof.includes(`预览（S02）: ${narrow}`), true);
  assert.equal(proof.includes('shedCode=S02'), true);
  assert.match(proof, /导出: \S+\/reports\/export\.xlsx\?/);
  const exported = exportUrl(day, NARROW_SHED);
  assert.equal(exported.includes('/reports/export.xlsx'), true);
  assert.equal(new URL(exported).searchParams.get('shedCode'), NARROW_SHED);
  assert.equal(new URL(exportUrl(day, '')).searchParams.has('shedCode'), false);
});

test('wide growth preview must have more rows than S02 alone', () => {
  const day = '2026-10-14';
  const wide = {
    kind: 'growth',
    grain: 'day',
    title: '园区生长',
    from: day,
    to: day,
    shedCode: null,
    rows: [
      { shedCode: 'S01', period: day, mushroomCount: 11, matureCount: 4 },
      { shedCode: 'S02', period: day, mushroomCount: 34, matureCount: 18 },
    ],
  };
  const narrow = {
    ...wide,
    shedCode: 'S02',
    rows: [wide.rows[1]],
  };
  assert.equal(assertBrowsePreview(wide, { day, shedFilter: null, specs: BROWSE_ROWS }).count, 2);
  assert.equal(
    assertBrowsePreview(narrow, {
      day,
      shedFilter: 'S02',
      specs: [s02],
      onlyShed: 'S02',
    }).count,
    1,
  );
  assert.throws(
    () => assertBrowsePreview(
      { ...wide, shedCode: 'S02' },
      { day, shedFilter: 'S02', specs: [s02], onlyShed: 'S02' },
    ),
    /其他棚区/,
  );
  assert.throws(
    () => assertBrowsePreview({ ...narrow, rows: [] }, { day, shedFilter: 'S02', specs: [s02], onlyShed: 'S02' }),
    /没有行/,
  );
  const narrowBook = assertBrowseWorkbook(workbookBytes(['S02']), {
    requireSheds: ['S02'],
    forbidSheds: ['S01'],
  });
  assert.equal(narrowBook.rows, 2);
  assert.throws(
    () => assertBrowseWorkbook(workbookBytes(['S01', 'S02']), { requireSheds: ['S02'], forbidSheds: ['S01'] }),
    /仍有棚区 S01/,
  );
  assert.equal(s01.cameraCode, 'CAM-RB-S01');
});

test('sendReportBrowseDemo posts both sheds and checks the narrower workbook', async () => {
  const now = new Date('2026-10-14T04:00:00.000Z');
  const day = '2026-10-14';
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const target = new URL(String(url));
    const method = init?.method || 'GET';
    calls.push(`${method} ${target.pathname}`);
    if (target.pathname.endsWith('/ingest/recognition')) {
      const body = JSON.parse(init.body);
      const spec = BROWSE_ROWS.find((row) => row.cameraCode === body.cameraCode);
      assert.ok(spec);
      assert.equal(body.shedCode, spec.shedCode);
      assert.equal(body.idempotencyKey, browseKey(spec.shedCode, now));
      assert.equal(init.headers['x-ingest-token'], 'dev-ingest-token');
      return jsonResponse(201, {
        accepted: true,
        id: `id-${spec.shedCode}`,
        duplicate: false,
        snapshotStored: false,
      });
    }
    if (target.pathname.endsWith('/auth/login')) {
      return jsonResponse(200, { accessToken: 'tok' });
    }
    if (target.pathname.endsWith('/ingest/recognitions')) {
      const cameraCode = target.searchParams.get('cameraCode');
      const spec = BROWSE_ROWS.find((row) => row.cameraCode === cameraCode);
      assert.equal(init.headers.authorization, 'Bearer tok');
      return jsonResponse(200, {
        items: [
          {
            id: `id-${spec.shedCode}`,
            shedCode: spec.shedCode,
            cameraCode: spec.cameraCode,
            mushroomCount: spec.mushroomCount,
            matureCount: spec.matureCount,
            idempotencyKey: browseKey(spec.shedCode, now),
          },
        ],
        total: 1,
      });
    }
    if (target.pathname.endsWith('/reports/preview')) {
      const shed = target.searchParams.get('shedCode');
      const rows = [
        { shedCode: 'S01', period: day, mushroomCount: s01.mushroomCount, matureCount: s01.matureCount },
        { shedCode: 'S02', period: day, mushroomCount: s02.mushroomCount, matureCount: s02.matureCount },
      ];
      return jsonResponse(200, {
        kind: 'growth',
        grain: 'day',
        title: '园区生长',
        from: day,
        to: day,
        shedCode: shed,
        rows: shed ? rows.filter((row) => row.shedCode === shed) : rows,
      });
    }
    if (target.pathname.endsWith('/reports/export.xlsx')) {
      assert.equal(target.searchParams.get('shedCode'), NARROW_SHED);
      assert.equal(init.headers.authorization, 'Bearer tok');
      return fileResponse(workbookBytes(['S02']));
    }
    throw new Error(`unexpected ${method} ${target.pathname}`);
  };
  try {
    const result = await sendReportBrowseDemo(now);
    assert.equal(result.wideCount, 2);
    assert.equal(result.narrowCount, 1);
    assert.equal(result.posted.length, 2);
    const proof = formatBrowseProof(result);
    assert.match(proof, /全部棚行数: 2/);
    assert.match(proof, /只看 S02 行数: 1/);
    assert.match(proof, /预览（全部棚）: /);
    assert.match(proof, /预览（S02）: /);
    assert.match(proof, /导出: /);
    assert.match(proof, /export\.xlsx/);
    assert.equal(calls.filter((line) => line.startsWith('POST /api/v1/ingest/recognition')).length, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test('sendReportBrowseDemo fails when the wide preview is not wider', async () => {
  const now = new Date('2026-10-14T04:00:00.000Z');
  const day = '2026-10-14';
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const target = new URL(String(url));
    if (target.pathname.endsWith('/ingest/recognition')) {
      const body = JSON.parse(init.body);
      return jsonResponse(201, { accepted: true, id: `id-${body.shedCode}`, duplicate: false });
    }
    if (target.pathname.endsWith('/auth/login')) return jsonResponse(200, { accessToken: 'tok' });
    if (target.pathname.endsWith('/ingest/recognitions')) {
      const cameraCode = target.searchParams.get('cameraCode');
      const spec = BROWSE_ROWS.find((row) => row.cameraCode === cameraCode);
      return jsonResponse(200, {
        items: [{
          id: `id-${spec.shedCode}`,
          shedCode: spec.shedCode,
          cameraCode: spec.cameraCode,
          mushroomCount: spec.mushroomCount,
          matureCount: spec.matureCount,
          idempotencyKey: browseKey(spec.shedCode, now),
        }],
      });
    }
    if (target.pathname.endsWith('/reports/preview')) {
      return jsonResponse(200, {
        kind: 'growth',
        grain: 'day',
        title: '园区生长',
        from: day,
        to: day,
        shedCode: target.searchParams.get('shedCode'),
        rows: [{ shedCode: 'S02', period: day, mushroomCount: 17, matureCount: 9 }],
      });
    }
    throw new Error(`unexpected ${target.pathname}`);
  };
  try {
    await assert.rejects(sendReportBrowseDemo(now), /没有棚区 S01|不多于/);
  } finally {
    globalThis.fetch = original;
  }
});

test('sendReportBrowseDemo fails when the API is down', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('connect ECONNREFUSED');
  };
  try {
    await assert.rejects(sendReportBrowseDemo(new Date('2026-10-14T04:00:00.000Z')), /make up、make migrate、make api/);
  } finally {
    globalThis.fetch = original;
  }
});

test('report browse docs stay beside the growth xlsx demo', () => {
  const doc = readFileSync(join(root, 'docs/DEMO_REPORT_BROWSE.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  const growthDoc = readFileSync(join(root, 'docs/DEMO_REPORT_XLSX.md'), 'utf8');
  const growthScript = readFileSync(join(root, 'scripts/demo-report-xlsx.mjs'), 'utf8');
  const browseScript = readFileSync(join(root, 'scripts/demo-report-browse.mjs'), 'utf8');
  assert.match(doc, /make demo-report-browse/);
  assert.match(doc, /CAM-RB-S01/);
  assert.match(doc, /CAM-RB-S02/);
  assert.match(doc, /已开始下载 growth\.xlsx/);
  assert.match(doc, /window\.print/);
  assert.match(doc, /预览（全部棚）/);
  assert.match(doc, /预览（S02）/);
  assert.match(doc, /Mac/);
  assert.match(caps, /make demo-report-browse/);
  assert.match(caps, /DEMO_REPORT_BROWSE\.md/);
  assert.match(caps, /棚区 全部/);
  assert.match(status, /make demo-report-browse/);
  assert.match(readme, /DEMO_REPORT_BROWSE\.md/);
  assert.match(makefile, /^demo-report-browse:.*\n\tnode scripts\/demo-report-browse\.mjs\s*$/m);
  assert.match(makefile, /scripts\/demo-report-browse\.spec\.mjs/);
  assert.match(growthDoc, /make demo-report-xlsx/);
  assert.match(growthDoc, /CAM-RPT-01/);
  assert.doesNotMatch(growthScript, /CAM-RB-S01|demo-report-browse/);
  assert.doesNotMatch(browseScript, /ingest\/observability/);
  assert.doesNotMatch(doc, /假定|假设/);
});
