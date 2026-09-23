import { Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser } from '../common/auth-user';
import { parsePage, ListQuery } from '../common/pagination';
import { ShedScope } from '../common/shed-scope';
import {
  DEVICE_OFFLINE_AFTER_MS,
  DeviceType,
  isDeviceType,
} from '@mushroom/contracts';
import { Device } from '../entities/device.entity';
import { Shed } from '../entities/shed.entity';

@Injectable()
export class DevicesService {
  constructor(
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @InjectRepository(Shed) private readonly sheds: Repository<Shed>,
  ) {}

  async list(user: AuthUser, query: ListQuery) {
    const scope = ShedScope.fromUser(user);
    if (query.shedCode) scope.assert(query.shedCode);
    const page = parsePage(query);
    const qb = this.devices.createQueryBuilder('d').orderBy('d.code', 'ASC');
    if (scope.codes) {
      if (!scope.codes.length) qb.andWhere('1 = 0');
      else qb.andWhere('d.shedCode IN (:...codes)', { codes: scope.codes });
    }
    if (query.shedCode)
      qb.andWhere('d.shedCode = :shedCode', { shedCode: query.shedCode });
    if (query.type) qb.andWhere('d.type = :type', { type: query.type });
    if (query.online)
      qb.andWhere('d.onlineStatus = :online', { online: query.online });
    const [items, total] = await qb
      .skip(page.skip)
      .take(page.pageSize)
      .getManyAndCount();
    return { items, total, page: page.page, pageSize: page.pageSize };
  }

  async create(
    user: AuthUser,
    input: {
      code: string;
      name: string;
      type: string;
      shedCode: string;
      parentCode?: string | null;
    },
  ) {
    const scope = ShedScope.fromUser(user);
    scope.assert(input.shedCode);
    if (!isDeviceType(input.type)) {
      throw new NotFoundException('设备类型无效');
    }
    await this.ensureShed(input.shedCode);
    return this.devices.save(
      this.devices.create({
        code: input.code.trim(),
        name: input.name.trim(),
        type: input.type,
        shedCode: input.shedCode,
        parentCode: input.parentCode ?? null,
        onlineStatus: 'offline',
        lastSeenAt: null,
        meta: {},
      }),
    );
  }

  async update(
    user: AuthUser,
    id: string,
    patch: {
      name?: string;
      shedCode?: string;
      parentCode?: string | null;
      type?: string;
    },
  ) {
    const device = await this.devices.findOne({ where: { id } });
    if (!device) throw new NotFoundException('设备不存在');
    const scope = ShedScope.fromUser(user);
    scope.assert(device.shedCode);
    if (patch.shedCode) scope.assert(patch.shedCode);
    if (patch.name !== undefined) device.name = patch.name;
    if (patch.shedCode !== undefined) device.shedCode = patch.shedCode;
    if (patch.parentCode !== undefined) device.parentCode = patch.parentCode;
    if (patch.type !== undefined && isDeviceType(patch.type))
      device.type = patch.type;
    return this.devices.save(device);
  }

  async counts(user: AuthUser) {
    const scope = ShedScope.fromUser(user);
    const qb = this.devices.createQueryBuilder('d');
    if (scope.codes) {
      if (!scope.codes.length) return { total: 0, online: 0 };
      qb.andWhere('d.shedCode IN (:...codes)', { codes: scope.codes });
    }
    const total = await qb.getCount();
    const online = await qb
      .clone()
      .andWhere('d.onlineStatus = :s', { s: 'online' })
      .getCount();
    return { total, online };
  }

  async touchCamera(shedCode: string, cameraCode: string) {
    await this.ensureShed(shedCode);
    await this.touch(shedCode, cameraCode, 'camera', true);
  }

  async heartbeat(
    shedCode: string,
    deviceCode: string,
    deviceType: string | undefined,
    online: boolean,
  ) {
    await this.ensureShed(shedCode);
    const type: DeviceType =
      deviceType && isDeviceType(deviceType) ? deviceType : 'sensor';
    await this.touch(shedCode, deviceCode, type, online);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async markStaleOffline() {
    const cutoff = Date.now() - DEVICE_OFFLINE_AFTER_MS;
    const online = await this.devices.find({
      where: { onlineStatus: 'online' },
    });
    const stale = online.filter(
      (device) => !device.lastSeenAt || device.lastSeenAt.getTime() < cutoff,
    );
    if (!stale.length) return;
    for (const device of stale) device.onlineStatus = 'offline';
    await this.devices.save(stale);
  }

  private async touch(
    shedCode: string,
    code: string,
    type: DeviceType,
    online: boolean,
  ) {
    let device = await this.devices.findOne({ where: { code } });
    if (!device) {
      device = this.devices.create({
        code,
        name: code,
        type,
        shedCode,
        parentCode: null,
        onlineStatus: online ? 'online' : 'offline',
        lastSeenAt: online ? new Date() : null,
        meta: { autoRegistered: true },
      });
    } else {
      device.shedCode = shedCode;
      device.onlineStatus = online ? 'online' : 'offline';
      if (online) device.lastSeenAt = new Date();
    }
    await this.devices.save(device);
  }

  private async ensureShed(code: string) {
    const found = await this.sheds.findOne({ where: { code } });
    if (found) return found;
    return this.sheds.save(
      this.sheds.create({ code, name: code, location: null, enabled: true }),
    );
  }
}
