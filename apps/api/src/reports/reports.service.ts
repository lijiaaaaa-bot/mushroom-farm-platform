import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  shanghaiDayRange,
  shiftShanghaiDate,
  todayShanghai,
} from '@mushroom/contracts';
import ExcelJS from 'exceljs';
import { Repository } from 'typeorm';
import { AuthUser } from '../common/auth-user';
import { ShedScope } from '../common/shed-scope';
import { Alert } from '../entities/alert.entity';
import { Device } from '../entities/device.entity';
import { MetricBucketDay } from '../entities/metric-bucket.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import {
  METRIC_CAP_DIAMETER_MEAN,
  METRIC_DISEASE_COUNT,
  METRIC_ENV_CO2,
  METRIC_ENV_HUMIDITY,
  METRIC_ENV_MOISTURE,
  METRIC_ENV_TEMPERATURE,
  METRIC_MATURE_COUNT,
  METRIC_MUSHROOM_COUNT,
} from '../growth';
import {
  BucketFact,
  DISEASE_COLUMNS,
  ENVIRONMENT_COLUMNS,
  GROWTH_PREVIEW_COLUMNS,
  ReportColumn,
  ReportGrain,
  ReportKind,
  ReportPreview,
  YIELD_COLUMNS,
  isReportKind,
  rollupDisease,
  rollupEnvironment,
  rollupGrowth,
  rollupYield,
} from './report-rollup';

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(RecognitionRecord)
    private readonly records: Repository<RecognitionRecord>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @InjectRepository(Alert) private readonly alerts: Repository<Alert>,
    @InjectRepository(MetricBucketDay)
    private readonly dayBuckets: Repository<MetricBucketDay>,
  ) {}

  async preview(
    user: AuthUser,
    query: {
      kind?: string;
      grain?: string;
      from?: string;
      to?: string;
      shedCode?: string;
      online?: string;
      status?: string;
    },
  ): Promise<ReportPreview> {
    const kind = parseKind(query.kind);
    const range = parseRange(query.from, query.to);
    const shedCode = query.shedCode?.trim() || null;
    if (shedCode) ShedScope.fromUser(user).assert(shedCode);
    const grain = kind === 'growth' ? parseGrain(query.grain) : null;
    const rows = await this.previewRows(
      user,
      kind,
      grain,
      range,
      shedCode,
      query,
    );
    return {
      kind,
      grain,
      from: range.from,
      to: range.to,
      shedCode,
      title: REPORT_TITLE[kind],
      columns: columnsFor(kind),
      rows,
    };
  }

  async exportPreview(
    user: AuthUser,
    query: {
      kind?: string;
      grain?: string;
      from?: string;
      to?: string;
      shedCode?: string;
      online?: string;
      status?: string;
    },
  ) {
    const preview = await this.preview(user, query);
    return this.workbook(preview.title, preview.columns, preview.rows);
  }

  growth(user: AuthUser, from?: string, to?: string) {
    return this.recognitionSheet(user, '生长', from, to, [
      { header: '棚区', key: 'shedCode', width: 12 },
      { header: '摄像头', key: 'cameraCode', width: 16 },
      { header: '识别时间', key: 'recognizedAt', width: 24 },
      { header: '蘑菇数量', key: 'mushroomCount', width: 12 },
      { header: '成熟数量', key: 'matureCount', width: 12 },
      { header: '平均菌盖直径cm', key: 'avgCapDiameter', width: 18 },
    ]);
  }

  disease(user: AuthUser, from?: string, to?: string) {
    return this.recognitionSheet(user, '病害', from, to, [
      { header: '棚区', key: 'shedCode', width: 12 },
      { header: '摄像头', key: 'cameraCode', width: 16 },
      { header: '识别时间', key: 'recognizedAt', width: 24 },
      { header: '病害数量', key: 'diseaseCount', width: 12 },
      { header: '病害等级', key: 'diseaseLevel', width: 12 },
      { header: '抓拍对象键', key: 'snapshotObjectKey', width: 42 },
    ]);
  }

  environment(user: AuthUser, from?: string, to?: string) {
    return this.recognitionSheet(user, '环境', from, to, [
      { header: '棚区', key: 'shedCode', width: 12 },
      { header: '摄像头', key: 'cameraCode', width: 16 },
      { header: '识别时间', key: 'recognizedAt', width: 24 },
      { header: '温度', key: 'temperature', width: 10 },
      { header: '湿度', key: 'humidity', width: 10 },
      { header: 'CO2', key: 'co2', width: 10 },
      { header: '基质含水率', key: 'substrateMoisture', width: 14 },
    ]);
  }

  async devicesSheet(user: AuthUser) {
    const scope = ShedScope.fromUser(user);
    const qb = this.devices.createQueryBuilder('d').orderBy('d.code', 'ASC');
    if (scope.codes) {
      if (!scope.codes.length) qb.andWhere('1 = 0');
      else qb.andWhere('d.shedCode IN (:...codes)', { codes: scope.codes });
    }
    const rows = await qb.getMany();
    return this.workbook(
      '设备',
      [
        { header: '编号', key: 'code', width: 16 },
        { header: '名称', key: 'name', width: 18 },
        { header: '类型', key: 'type', width: 12 },
        { header: '棚区', key: 'shedCode', width: 12 },
        { header: '在线状态', key: 'onlineStatus', width: 12 },
        { header: '最近心跳', key: 'lastHeartbeatAt', width: 24 },
        { header: '最后在线', key: 'lastSeenAt', width: 24 },
      ],
      rows.map((row) => ({
        ...row,
        lastHeartbeatAt: row.lastHeartbeatAt ?? row.lastSeenAt,
      })),
    );
  }

  async alertsSheet(user: AuthUser) {
    const scope = ShedScope.fromUser(user);
    const qb = this.alerts
      .createQueryBuilder('a')
      .orderBy('a.createdAt', 'DESC')
      .take(5000);
    if (scope.codes) {
      if (!scope.codes.length) qb.andWhere('1 = 0');
      else qb.andWhere('a.shedCode IN (:...codes)', { codes: scope.codes });
    }
    const rows = await qb.getMany();
    return this.workbook(
      '告警',
      [
        { header: '等级', key: 'level', width: 12 },
        { header: '状态', key: 'status', width: 12 },
        { header: '棚区', key: 'shedCode', width: 12 },
        { header: '摄像头', key: 'cameraCode', width: 16 },
        { header: '标题', key: 'title', width: 24 },
        { header: '指标值', key: 'metricValue', width: 12 },
        { header: '阈值', key: 'threshold', width: 12 },
        { header: '创建时间', key: 'createdAt', width: 24 },
        { header: '确认人', key: 'ackedBy', width: 14 },
        { header: '关闭时间', key: 'closedAt', width: 24 },
      ],
      rows.map((row) => ({ ...row })),
    );
  }

  private async recognitionSheet(
    user: AuthUser,
    name: string,
    from: string | undefined,
    to: string | undefined,
    columns: { header: string; key: string; width: number }[],
  ) {
    const scope = ShedScope.fromUser(user);
    const end = to ? new Date(to) : new Date();
    const start = from
      ? new Date(from)
      : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    const qb = this.records
      .createQueryBuilder('r')
      .where('r.recognizedAt >= :start AND r.recognizedAt <= :end', {
        start,
        end,
      })
      .orderBy('r.recognizedAt', 'DESC')
      .take(5000);
    if (scope.codes) {
      if (!scope.codes.length) qb.andWhere('1 = 0');
      else qb.andWhere('r.shedCode IN (:...codes)', { codes: scope.codes });
    }
    const rows = await qb.getMany();
    return this.workbook(
      name,
      columns,
      rows.map((row) => ({ ...row })),
    );
  }

  private async previewRows(
    user: AuthUser,
    kind: ReportKind,
    grain: ReportGrain | null,
    range: { from: string; to: string },
    shedCode: string | null,
    query: { online?: string; status?: string },
  ) {
    if (kind === 'devices')
      return this.deviceRows(user, shedCode, query.online);
    if (kind === 'alerts') {
      return this.alertRows(user, shedCode, range, query.status);
    }
    const metrics = metricsFor(kind);
    const facts = await this.loadFacts(user, range, shedCode, metrics);
    if (kind === 'growth') return rollupGrowth(facts, grain ?? 'day');
    if (kind === 'yield') return rollupYield(facts);
    if (kind === 'disease') return rollupDisease(facts);
    return rollupEnvironment(facts);
  }

  private async loadFacts(
    user: AuthUser,
    range: { from: string; to: string },
    shedCode: string | null,
    metrics: string[],
  ): Promise<BucketFact[]> {
    const scope = ShedScope.fromUser(user);
    const start = shanghaiDayRange(range.from).start;
    const end = shanghaiDayRange(range.to).end;
    const rows = await this.dayBuckets
      .createQueryBuilder('b')
      .where('b.bucketStart >= :start AND b.bucketStart < :end', { start, end })
      .andWhere('b.cameraCode = :camera', { camera: '' })
      .andWhere('b.metric IN (:...metrics)', { metrics })
      .getMany();
    return rows
      .filter((row) => scope.allows(row.shedCode))
      .filter((row) => !shedCode || row.shedCode === shedCode)
      .filter((row) => row.cameraCode === '' && metrics.includes(row.metric))
      .map((row) => ({
        shedCode: row.shedCode,
        bucketStart: row.bucketStart,
        metric: row.metric,
        value: row.value,
      }));
  }

  private async deviceRows(
    user: AuthUser,
    shedCode: string | null,
    online?: string,
  ) {
    const scope = ShedScope.fromUser(user);
    const qb = this.devices.createQueryBuilder('d').orderBy('d.code', 'ASC');
    const rows = await qb.getMany();
    const wanted = online === 'online' || online === 'offline' ? online : null;
    return rows
      .filter((row) => scope.allows(row.shedCode))
      .filter((row) => !shedCode || row.shedCode === shedCode)
      .filter((row) => !wanted || row.onlineStatus === wanted)
      .map((row) => ({
        code: row.code,
        name: row.name,
        type: row.type,
        shedCode: row.shedCode,
        onlineStatus: row.onlineStatus,
        lastHeartbeatAt: stamp(row.lastHeartbeatAt ?? row.lastSeenAt),
      }));
  }

  private async alertRows(
    user: AuthUser,
    shedCode: string | null,
    range: { from: string; to: string },
    status?: string,
  ) {
    const scope = ShedScope.fromUser(user);
    const start = shanghaiDayRange(range.from).start.getTime();
    const end = shanghaiDayRange(range.to).end.getTime();
    const rows = await this.alerts
      .createQueryBuilder('a')
      .orderBy('a.createdAt', 'DESC')
      .take(5000)
      .getMany();
    const wanted = status === 'open' || status === 'closed' ? status : null;
    return rows
      .filter((row) => scope.allows(row.shedCode))
      .filter((row) => !shedCode || row.shedCode === shedCode)
      .filter((row) => {
        const at = new Date(row.createdAt).getTime();
        return at >= start && at < end;
      })
      .filter((row) => {
        if (!wanted) return true;
        if (wanted === 'open') return row.status !== 'closed';
        return row.status === 'closed';
      })
      .map((row) => ({
        level: row.level,
        status: row.status,
        closeReason: row.closeReason,
        shedCode: row.shedCode,
        cameraCode: row.cameraCode,
        title: row.title,
        claimedBy: row.claimedBy,
        closedBy: row.closedBy,
        createdAt: stamp(row.createdAt),
        closedAt: stamp(row.closedAt),
      }));
  }

  private async workbook(
    name: string,
    columns: { header: string; key: string; width: number }[],
    rows: Record<string, unknown>[],
  ) {
    const book = new ExcelJS.Workbook();
    book.creator = 'mushroom-farm';
    const sheet = book.addWorksheet(name);
    sheet.columns = columns;
    sheet.addRows(rows);
    sheet.getRow(1).font = { bold: true };
    const buffer = await book.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}

const REPORT_TITLE: Record<ReportKind, string> = {
  growth: '园区生长',
  yield: '分棚产量',
  disease: '病害统计',
  environment: '环境监控',
  devices: '设备在线',
  alerts: '告警闭环',
};

const DEVICE_COLUMNS: ReportColumn[] = [
  { header: '编号', key: 'code', width: 16 },
  { header: '名称', key: 'name', width: 18 },
  { header: '类型', key: 'type', width: 12 },
  { header: '棚区', key: 'shedCode', width: 12 },
  { header: '在线状态', key: 'onlineStatus', width: 12 },
  { header: '最近心跳', key: 'lastHeartbeatAt', width: 24 },
];

const ALERT_COLUMNS: ReportColumn[] = [
  { header: '等级', key: 'level', width: 12 },
  { header: '状态', key: 'status', width: 12 },
  { header: '关闭原因', key: 'closeReason', width: 16 },
  { header: '棚区', key: 'shedCode', width: 12 },
  { header: '摄像头', key: 'cameraCode', width: 16 },
  { header: '标题', key: 'title', width: 24 },
  { header: '认领人', key: 'claimedBy', width: 14 },
  { header: '关闭人', key: 'closedBy', width: 14 },
  { header: '创建时间', key: 'createdAt', width: 24 },
  { header: '关闭时间', key: 'closedAt', width: 24 },
];

function columnsFor(kind: ReportKind): ReportColumn[] {
  if (kind === 'growth') return GROWTH_PREVIEW_COLUMNS;
  if (kind === 'yield') return YIELD_COLUMNS;
  if (kind === 'disease') return DISEASE_COLUMNS;
  if (kind === 'environment') return ENVIRONMENT_COLUMNS;
  if (kind === 'devices') return DEVICE_COLUMNS;
  return ALERT_COLUMNS;
}

function metricsFor(kind: ReportKind): string[] {
  if (kind === 'growth' || kind === 'yield') {
    return [
      METRIC_MUSHROOM_COUNT,
      METRIC_MATURE_COUNT,
      METRIC_CAP_DIAMETER_MEAN,
    ];
  }
  if (kind === 'disease') return [METRIC_DISEASE_COUNT];
  return [
    METRIC_ENV_TEMPERATURE,
    METRIC_ENV_HUMIDITY,
    METRIC_ENV_CO2,
    METRIC_ENV_MOISTURE,
  ];
}

function parseKind(kind?: string): ReportKind {
  if (kind && isReportKind(kind)) return kind;
  throw new BadRequestException('报表类型无效');
}

function parseGrain(grain?: string): ReportGrain {
  if (grain === undefined || grain === '' || grain === 'day') return 'day';
  if (grain === 'week' || grain === 'month') return grain;
  throw new BadRequestException('生长报表粒度只支持 day、week、month');
}

function parseRange(from?: string, to?: string) {
  const end = to?.trim() || todayShanghai();
  const start = from?.trim() || shiftShanghaiDate(end, -6);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    throw new BadRequestException('日期格式应为 YYYY-MM-DD');
  }
  if (start > end) throw new BadRequestException('开始日期不能晚于结束日期');
  return { from: start, to: end };
}

function stamp(value: Date | string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
