import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { AlertLevel, AlertMetric, DeviceType, Role } from '@mushroom/contracts';
import { AlertRule } from '../entities/alert-rule.entity';
import { Device } from '../entities/device.entity';
import { Shed } from '../entities/shed.entity';
import { User } from '../entities/user.entity';

@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Shed) private readonly sheds: Repository<Shed>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @InjectRepository(AlertRule) private readonly rules: Repository<AlertRule>,
  ) {}

  async onModuleInit() {
    if (this.config.get<boolean>('seedOnStart') === false) return;
    await this.seedSheds();
    await this.seedUsers();
    await this.seedDevices();
    await this.seedRules();
    this.logger.log('种子数据已就绪（已存在的账号与规则不会覆盖）');
  }

  private async seedSheds() {
    const rows = [
      { code: 'S01', name: '一号菇棚', location: '东区', mapX: 25, mapY: 40 },
      { code: 'S02', name: '二号菇棚', location: '西区', mapX: 50, mapY: 40 },
      { code: 'S03', name: '育菇棚', location: '北区', mapX: 75, mapY: 40 },
    ];
    for (const row of rows) {
      const found = await this.sheds.findOne({ where: { code: row.code } });
      if (!found) {
        await this.sheds.save(this.sheds.create({ ...row, enabled: true }));
      }
    }
  }

  private async seedUsers() {
    const rows: {
      username: string;
      password: string;
      displayName: string;
      role: Role;
      shedCodes: string[];
    }[] = [
      {
        username: 'admin',
        password: 'Admin@123456',
        displayName: '系统管理员',
        role: 'super_admin',
        shedCodes: [],
      },
      {
        username: 'producer',
        password: 'Producer@123456',
        displayName: '生产管理员',
        role: 'production_admin',
        shedCodes: [],
      },
      {
        username: 'shedlead',
        password: 'Shed@123456',
        displayName: '一号棚负责人',
        role: 'shed_manager',
        shedCodes: ['S01'],
      },
      {
        username: 'viewer',
        password: 'Viewer@123456',
        displayName: '只读查看',
        role: 'viewer',
        shedCodes: ['S01'],
      },
    ];
    for (const row of rows) {
      const found = await this.users.findOne({
        where: { username: row.username },
      });
      if (found) continue;
      await this.users.save(
        this.users.create({
          username: row.username,
          passwordHash: await bcrypt.hash(row.password, 10),
          displayName: row.displayName,
          role: row.role,
          shedCodes: row.shedCodes,
          enabled: true,
        }),
      );
    }
  }

  private async seedDevices() {
    const rows: {
      code: string;
      name: string;
      type: DeviceType;
      shedCode: string;
      parentCode: string | null;
    }[] = [
      {
        code: 'BOX-01',
        name: '一号棚 AI 盒',
        type: 'ai_box',
        shedCode: 'S01',
        parentCode: null,
      },
      {
        code: 'CAM-S01-01',
        name: '一号棚摄像头 1',
        type: 'camera',
        shedCode: 'S01',
        parentCode: 'BOX-01',
      },
      {
        code: 'CAM-S01-02',
        name: '一号棚摄像头 2',
        type: 'camera',
        shedCode: 'S01',
        parentCode: 'BOX-01',
      },
      {
        code: 'SENSOR-S01',
        name: '一号棚环境传感器',
        type: 'sensor',
        shedCode: 'S01',
        parentCode: null,
      },
      {
        code: 'BOX-02',
        name: '二号棚 AI 盒',
        type: 'ai_box',
        shedCode: 'S02',
        parentCode: null,
      },
      {
        code: 'CAM-S02-01',
        name: '二号棚摄像头 1',
        type: 'camera',
        shedCode: 'S02',
        parentCode: 'BOX-02',
      },
      {
        code: 'SENSOR-S02',
        name: '二号棚环境传感器',
        type: 'sensor',
        shedCode: 'S02',
        parentCode: null,
      },
      {
        code: 'CAM-S03-01',
        name: '育菇棚摄像头 1',
        type: 'camera',
        shedCode: 'S03',
        parentCode: null,
      },
    ];
    for (const row of rows) {
      const found = await this.devices.findOne({ where: { code: row.code } });
      if (found) continue;
      await this.devices.save(
        this.devices.create({
          ...row,
          onlineStatus: 'offline',
          lastSeenAt: null,
          lastHeartbeatAt: null,
          meta: { seeded: true },
        }),
      );
    }
  }

  private async seedRules() {
    const rows: {
      name: string;
      metric: AlertMetric;
      threshold: number;
      level: AlertLevel;
      windowMinutes?: number;
    }[] = [
      {
        name: '成熟占比一般',
        metric: 'mature_ratio',
        threshold: 0.6,
        level: 'warning',
      },
      {
        name: '成熟占比严重',
        metric: 'mature_ratio',
        threshold: 0.85,
        level: 'severe',
      },
      {
        name: '病害数量一般',
        metric: 'disease_count',
        threshold: 5,
        level: 'warning',
      },
      {
        name: '病害数量严重',
        metric: 'disease_count',
        threshold: 15,
        level: 'severe',
      },
      {
        name: '病害等级一般',
        metric: 'disease_level',
        threshold: 2,
        level: 'warning',
      },
      {
        name: '病害等级严重',
        metric: 'disease_level',
        threshold: 3,
        level: 'severe',
      },
      {
        name: '温度过高',
        metric: 'temperature_high',
        threshold: 28,
        level: 'severe',
      },
      {
        name: '温度过低',
        metric: 'temperature_low',
        threshold: 12,
        level: 'warning',
      },
      {
        name: '湿度过低',
        metric: 'humidity_low',
        threshold: 70,
        level: 'warning',
      },
      {
        name: '湿度过高',
        metric: 'humidity_high',
        threshold: 98,
        level: 'info',
      },
      {
        name: '二氧化碳过高',
        metric: 'co2_high',
        threshold: 2000,
        level: 'severe',
      },
      {
        name: '基质偏干',
        metric: 'substrate_moisture_low',
        threshold: 50,
        level: 'warning',
      },
      {
        name: '生长停滞',
        metric: 'growth_stall',
        threshold: 0.05,
        level: 'info',
        windowMinutes: 720,
      },
    ];
    for (const row of rows) {
      const found = await this.rules.findOne({ where: { name: row.name } });
      if (found) continue;
      await this.rules.save(
        this.rules.create({
          name: row.name,
          metric: row.metric,
          threshold: row.threshold,
          level: row.level,
          shedCode: null,
          enabled: true,
          windowMinutes: row.windowMinutes ?? 720,
        }),
      );
    }
  }
}
