import { BadRequestException } from '@nestjs/common';

export const MAX_DEVICE_IMPORT_ROWS = 2000;

export interface RawDeviceRow {
  code: string;
  name: string;
  shedCode: string;
  type: string;
  parentCode: string;
  invalid: boolean;
}

export interface DeviceImportMessage {
  row: number;
  reason: string;
}

export interface DeviceImportResult {
  successCount: number;
  failCount: number;
  skippedCount: number;
  errors: DeviceImportMessage[];
  skipped: DeviceImportMessage[];
}

export interface DeviceImportFile {
  buffer?: Buffer;
}

type Field = 'code' | 'shedCode' | 'name' | 'type' | 'parentCode';

const HEADER_MAP: Record<string, Field> = {
  code: 'code',
  devicecode: 'code',
  设备编码: 'code',
  设备编号: 'code',
  编号: 'code',
  shedcode: 'shedCode',
  shed: 'shedCode',
  棚编码: 'shedCode',
  棚区编码: 'shedCode',
  棚区: 'shedCode',
  name: 'name',
  名称: 'name',
  设备名称: 'name',
  type: 'type',
  类型: 'type',
  设备类型: 'type',
  parentcode: 'parentCode',
  上级编码: 'parentCode',
  父设备: 'parentCode',
};

const JSON_KEYS: Record<Field, string[]> = {
  code: ['code', 'deviceCode', 'device_code', '设备编码', '设备编号', '编号'],
  shedCode: ['shedCode', 'shed_code', 'shed', '棚编码', '棚区编码', '棚区'],
  name: ['name', '名称', '设备名称'],
  type: ['type', '类型', '设备类型'],
  parentCode: ['parentCode', 'parent_code', '上级编码', '父设备'],
};

function normHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '');
}

function blankRow(invalid: boolean): RawDeviceRow {
  return {
    code: '',
    name: '',
    shedCode: '',
    type: '',
    parentCode: '',
    invalid,
  };
}

function assertRowLimit(count: number) {
  if (count > MAX_DEVICE_IMPORT_ROWS) {
    throw new BadRequestException(
      `单次导入不超过 ${MAX_DEVICE_IMPORT_ROWS} 行`,
    );
  }
}

export function parseCsv(text: string): string[][] {
  const src = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === ',') {
      row.push(cell.trim());
      cell = '';
      continue;
    }
    if (ch === '\n') {
      row.push(cell.trim());
      cell = '';
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell.trim());
    if (row.some((value) => value !== '')) rows.push(row);
  }
  return rows;
}

function cellsToRow(
  cells: string[],
  index: Partial<Record<Field, number>>,
): RawDeviceRow {
  const at = (field: Field) => {
    const position = index[field];
    if (position === undefined) return '';
    return cells[position] ?? '';
  };
  return {
    code: at('code'),
    name: at('name'),
    shedCode: at('shedCode'),
    type: at('type'),
    parentCode: at('parentCode'),
    invalid: false,
  };
}

export function parseDeviceCsv(text: string): RawDeviceRow[] {
  const table = parseCsv(text);
  if (!table.length) throw new BadRequestException('CSV 缺少表头');
  const index: Partial<Record<Field, number>> = {};
  table[0].forEach((cell, position) => {
    const field = HEADER_MAP[normHeader(cell)];
    if (field && index[field] === undefined) index[field] = position;
  });
  const missing = (['code', 'shedCode', 'name'] as const).filter(
    (field) => index[field] === undefined,
  );
  if (missing.length) {
    throw new BadRequestException('CSV 缺少必填列：设备编码、棚编码、名称');
  }
  const rows = table.slice(1).map((cells) => cellsToRow(cells, index));
  assertRowLimit(rows.length);
  return rows;
}

function pick(record: Record<string, unknown>, keys: string[]): string {
  const wanted = new Set(keys.map((key) => normHeader(key)));
  for (const [key, value] of Object.entries(record)) {
    if (!wanted.has(normHeader(key))) continue;
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value).trim();
    }
    return '';
  }
  return '';
}

export function normalizeJsonRow(input: unknown): RawDeviceRow {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return blankRow(true);
  }
  const record = input as Record<string, unknown>;
  return {
    code: pick(record, JSON_KEYS.code),
    name: pick(record, JSON_KEYS.name),
    shedCode: pick(record, JSON_KEYS.shedCode),
    type: pick(record, JSON_KEYS.type),
    parentCode: pick(record, JSON_KEYS.parentCode),
    invalid: false,
  };
}

export function readDeviceImport(
  file: DeviceImportFile | undefined,
  body: unknown,
): RawDeviceRow[] {
  const record =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  if (file?.buffer && file.buffer.length > 0) {
    return parseDeviceCsv(file.buffer.toString('utf8'));
  }
  if (typeof record.csv === 'string' && record.csv.trim()) {
    return parseDeviceCsv(record.csv);
  }
  if (Array.isArray(record.rows)) {
    assertRowLimit(record.rows.length);
    return record.rows.map((row) => normalizeJsonRow(row));
  }
  throw new BadRequestException('缺少导入内容');
}
