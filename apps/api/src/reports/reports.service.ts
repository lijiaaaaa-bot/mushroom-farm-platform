import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import ExcelJS from 'exceljs';
import { Repository } from 'typeorm';
import { AuthUser } from '../common/auth-user';
import { ShedScope } from '../common/shed-scope';
import { Alert } from '../entities/alert.entity';
import { Device } from '../entities/device.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(RecognitionRecord)
    private readonly records: Repository<RecognitionRecord>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @InjectRepository(Alert) private readonly alerts: Repository<Alert>,
  ) {}

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
        { header: '最后心跳', key: 'lastSeenAt', width: 24 },
      ],
      rows.map((row) => ({ ...row })),
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
