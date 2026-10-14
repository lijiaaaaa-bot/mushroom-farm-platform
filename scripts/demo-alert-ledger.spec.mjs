import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { repoRoot } from './lib/ingest-wire.mjs';
import {
  CLOSED_CAMERA,
  CLOSED_STATUS,
  CLOSED_TITLE,
  CLOSE_NOTE,
  CLOSE_REASON,
  LEDGER_SHED,
  OPEN_CAMERA,
  OPEN_STATUS,
  OPEN_TITLE,
  SHEET_ALERTS,
  SHEET_PREVIEW,
  assertAlertWorkbook,
  assertLedgerPreview,
  coveringRange,
  formatLedgerProof,
  previewSearch,
  readZipEntries,
  reportPageUrl,
  sendAlertLedgerDemo,
} from './demo-alert-ledger.mjs';

const root = repoRoot();
const openId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const closedId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const createdAt = '2026-10-14T04:00:00.000Z';
const day = '2026-10-14';

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

function workbookBytes(sheetName, text) {
  const sheet = Buffer.from(
    `<?xml version="1.0"?><worksheet><sheetData><row r="1"><c><v>标题</v></c></row><row r="2"><c><v>${text}</v></c></row></sheetData></worksheet>`,
  );
  return storedZip([
    {
      name: 'xl/workbook.xml',
      data: Buffer.from(`<?xml version="1.0"?><workbook><sheets><sheet name="${sheetName}"/></sheets></workbook>`),
    },
    { name: 'xl/worksheets/sheet1.xml', method: 8, data: deflateRawSync(sheet) },
    {
      name: 'xl/sharedStrings.xml',
      data: Buffer.from(`<?xml version="1.0"?><sst><si><t>${text}</t></si><si><t>${CLOSED_CAMERA}</t></si></sst>`),
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

function fileResponse(bytes, filename) {
  return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        const key = String(name).toLowerCase();
        if (key === 'content-type') {
          return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        }
        if (key === 'content-disposition') return `attachment; filename="${filename}"`;
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

function alertRow(overrides) {
  return {
    id: openId,
    shedCode: LEDGER_SHED,
    cameraCode: OPEN_CAMERA,
    level: 'warning',
    status: OPEN_STATUS,
    title: OPEN_TITLE,
    closeNote: null,
    closeReason: null,
    createdAt,
    ...overrides,
  };
}

const openRow = alertRow({});
const closedRow = alertRow({
  id: closedId,
  cameraCode: CLOSED_CAMERA,
  status: CLOSED_STATUS,
  title: CLOSED_TITLE,
  closeNote: CLOSE_NOTE,
  closeReason: CLOSE_REASON,
});

function previewBody(status, rows) {
  return {
    kind: 'alerts',
    title: SHEET_PREVIEW,
    from: day,
    to: day,
    shedCode: LEDGER_SHED,
    rows: rows.map((row) => ({
      level: row.level,
      status: row.status,
      closeReason: row.closeReason,
      shedCode: row.shedCode,
      cameraCode: row.cameraCode,
      title: row.title,
    })),
    echoedStatus: status,
  };
}

test('covering range uses Shanghai dates of both alerts', () => {
  const same = coveringRange(['2026-10-14T04:00:00.000Z', '2026-10-14T10:00:00.000Z']);
  assert.deepEqual(same, { from: day, to: day });
  const span = coveringRange(['2026-10-14T02:00:00.000Z', '2026-10-14T16:30:00.000Z']);
  assert.deepEqual(span, { from: '2026-10-14', to: '2026-10-15' });
});

test('preview addresses name alerts, the window, S01, and status', () => {
  const range = { from: day, to: day };
  assert.deepEqual(previewSearch(range), {
    kind: 'alerts',
    from: day,
    to: day,
    shedCode: LEDGER_SHED,
  });
  assert.equal(previewSearch(range, { status: OPEN_STATUS }).status, OPEN_STATUS);
  const openUrl = reportPageUrl(range, { status: OPEN_STATUS, webOrigin: 'http://127.0.0.1:43123/' });
  const closedUrl = reportPageUrl(range, { status: CLOSED_STATUS, webOrigin: 'http://127.0.0.1:43123' });
  const allUrl = reportPageUrl(range, { webOrigin: 'http://127.0.0.1:43123' });
  assert.equal(
    openUrl,
    'http://127.0.0.1:43123/reports?kind=alerts&from=2026-10-14&to=2026-10-14&shedCode=S01&status=open',
  );
  assert.match(closedUrl, /status=closed/);
  assert.equal(allUrl.includes('status='), false);
});

test('alert preview keeps the open row out of the closed filter', () => {
  const range = { from: day, to: day };
  const both = previewBody('', [openRow, closedRow]);
  const all = assertLedgerPreview(both, {
    range,
    required: [openRow, closedRow],
    forbiddenTitles: [],
  });
  assert.equal(all.count, 2);
  const openOnly = assertLedgerPreview(previewBody(OPEN_STATUS, [openRow]), {
    range,
    required: [openRow],
    forbiddenTitles: [CLOSED_TITLE],
    onlyStatus: OPEN_STATUS,
  });
  assert.equal(openOnly.count, 1);
  assert.throws(
    () =>
      assertLedgerPreview(both, {
        range,
        required: [closedRow],
        forbiddenTitles: [OPEN_TITLE],
        onlyStatus: CLOSED_STATUS,
      }),
    /其他状态|仍有/,
  );
  const book = assertAlertWorkbook(workbookBytes(SHEET_PREVIEW, CLOSED_TITLE), {
    sheetName: SHEET_PREVIEW,
    requiredText: [CLOSED_TITLE, CLOSED_CAMERA],
    forbiddenText: [OPEN_TITLE],
  });
  assert.equal(book.rows, 2);
  assert.throws(() => readZipEntries(Buffer.from('not-a-zip')), /不是 xlsx/);
});

function installFetch({ reuse = false } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const target = new URL(String(url));
    const method = init?.method || 'GET';
    calls.push(`${method} ${target.pathname}${target.search}`);
    if (target.pathname.endsWith('/auth/login')) {
      assert.deepEqual(JSON.parse(init.body), { username: 'admin', password: 'Admin@123456' });
      return jsonResponse(200, { accessToken: 'tok' });
    }
    if (target.pathname.endsWith('/alerts') && method === 'GET') {
      assert.equal(init.headers.authorization, 'Bearer tok');
      assert.equal(target.searchParams.get('shedCode'), LEDGER_SHED);
      const title = target.searchParams.get('q');
      if (!reuse) return jsonResponse(200, { items: [], total: 0 });
      if (title === OPEN_TITLE) return jsonResponse(200, { items: [openRow], total: 1 });
      if (title === CLOSED_TITLE) return jsonResponse(200, { items: [closedRow], total: 1 });
      return jsonResponse(200, { items: [], total: 0 });
    }
    if (target.pathname.endsWith('/alerts') && method === 'POST') {
      const body = JSON.parse(init.body);
      assert.equal(body.shedCode, LEDGER_SHED);
      assert.equal(body.level, 'warning');
      const created = body.title === OPEN_TITLE ? openRow : { ...closedRow, status: OPEN_STATUS, closeNote: null, closeReason: null };
      return jsonResponse(201, created);
    }
    if (method === 'POST' && target.pathname.endsWith('/close')) {
      const body = JSON.parse(init.body);
      assert.equal(body.note, CLOSE_NOTE);
      assert.match(target.pathname, new RegExp(closedId));
      return jsonResponse(200, closedRow);
    }
    if (method === 'GET' && /\/alerts\/[^/]+$/.test(target.pathname)) {
      if (target.pathname.endsWith(openId)) return jsonResponse(200, openRow);
      if (target.pathname.endsWith(closedId)) return jsonResponse(200, closedRow);
    }
    if (target.pathname.endsWith('/reports/preview')) {
      assert.equal(target.searchParams.get('kind'), 'alerts');
      assert.equal(target.searchParams.get('from'), day);
      assert.equal(target.searchParams.get('to'), day);
      assert.equal(target.searchParams.get('shedCode'), LEDGER_SHED);
      const status = target.searchParams.get('status');
      if (status === OPEN_STATUS) return jsonResponse(200, previewBody(status, [openRow]));
      if (status === CLOSED_STATUS) return jsonResponse(200, previewBody(status, [closedRow]));
      assert.equal(status, null);
      return jsonResponse(200, previewBody('', [openRow, closedRow]));
    }
    if (target.pathname.endsWith('/reports/export.xlsx')) {
      assert.equal(target.searchParams.get('status'), CLOSED_STATUS);
      assert.equal(target.searchParams.get('kind'), 'alerts');
      return fileResponse(workbookBytes(SHEET_PREVIEW, CLOSED_TITLE), 'export.xlsx');
    }
    if (target.pathname.endsWith('/reports/alerts.xlsx')) {
      return fileResponse(workbookBytes(SHEET_ALERTS, CLOSED_TITLE), 'alerts.xlsx');
    }
    throw new Error(`unexpected ${method} ${target.pathname}`);
  };
  return calls;
}

test('sendAlertLedgerDemo creates, closes, and checks both filters plus xlsx', async () => {
  const original = globalThis.fetch;
  const calls = installFetch();
  try {
    const result = await sendAlertLedgerDemo();
    assert.equal(result.openHow, 'created');
    assert.equal(result.closedHow, 'created');
    assert.equal(result.allCount, 2);
    assert.equal(result.openCount, 1);
    assert.equal(result.closedCount, 1);
    assert.equal(result.workbook.sheetName, SHEET_PREVIEW);
    assert.equal(result.alertsBook.sheetName, SHEET_ALERTS);
    const proof = formatLedgerProof(result);
    assert.match(proof, /台账待确认告警/);
    assert.match(proof, /台账已关闭告警/);
    assert.match(proof, /status=open/);
    assert.match(proof, /status=closed/);
    assert.match(proof, /预览（全部）/);
    assert.equal(
      calls.filter((line) => line.startsWith('POST /api/v1/alerts') && !line.includes('/close')).length,
      2,
    );
    assert.equal(calls.filter((line) => line.includes('/close')).length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('sendAlertLedgerDemo reuses the same title and status', async () => {
  const original = globalThis.fetch;
  const calls = installFetch({ reuse: true });
  try {
    const result = await sendAlertLedgerDemo();
    assert.equal(result.openHow, 'reused');
    assert.equal(result.closedHow, 'reused');
    assert.equal(calls.filter((line) => line.startsWith('POST /api/v1/alerts')).length, 0);
    assert.equal(calls.filter((line) => line.includes('/close')).length, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test('sendAlertLedgerDemo fails when the API is down', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('connect ECONNREFUSED');
  };
  try {
    await assert.rejects(sendAlertLedgerDemo(), /make up、make migrate、make api/);
  } finally {
    globalThis.fetch = original;
  }
});

test('alert ledger docs and make target stay beside the growth report demo', () => {
  const doc = readFileSync(join(root, 'docs/DEMO_ALERT_LEDGER.md'), 'utf8');
  const caps = readFileSync(join(root, 'docs/CURRENT_CAPABILITIES.md'), 'utf8');
  const status = readFileSync(join(root, 'STATUS.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const makefile = readFileSync(join(root, 'Makefile'), 'utf8');
  const growthDoc = readFileSync(join(root, 'docs/DEMO_REPORT_XLSX.md'), 'utf8');
  assert.match(doc, /make demo-alert-ledger/);
  assert.match(doc, /CAM-ALED-OPEN/);
  assert.match(doc, /CAM-ALED-CLOSED/);
  assert.match(doc, /台账待确认告警/);
  assert.match(doc, /台账已关闭告警/);
  assert.match(doc, /已开始下载 alerts\.xlsx/);
  assert.match(doc, /\/reports\?kind=alerts/);
  assert.match(doc, /status=open/);
  assert.match(doc, /status=closed/);
  assert.match(caps, /make demo-alert-ledger/);
  assert.match(caps, /DEMO_ALERT_LEDGER\.md/);
  assert.match(status, /make demo-alert-ledger/);
  assert.match(readme, /DEMO_ALERT_LEDGER\.md/);
  assert.match(makefile, /^demo-alert-ledger:.*\n\tnode scripts\/demo-alert-ledger\.mjs\s*$/m);
  assert.match(makefile, /scripts\/demo-alert-ledger\.spec\.mjs/);
  assert.match(growthDoc, /make demo-report-xlsx/);
  assert.match(growthDoc, /CAM-RPT-01/);
  const growthScript = readFileSync(join(root, 'scripts/demo-report-xlsx.mjs'), 'utf8');
  assert.doesNotMatch(growthScript, /CAM-ALED|demo-alert-ledger/);
  const ledgerScript = readFileSync(join(root, 'scripts/demo-alert-ledger.mjs'), 'utf8');
  assert.doesNotMatch(ledgerScript, /ingest\/observability|demo-report-xlsx/);
});
