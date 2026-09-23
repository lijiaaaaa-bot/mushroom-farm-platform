import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertRule } from '../entities/alert-rule.entity';
import { Device } from '../entities/device.entity';
import { Shed } from '../entities/shed.entity';
import { User } from '../entities/user.entity';
import { SeedService } from './seed.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, Shed, Device, AlertRule])],
  providers: [SeedService],
})
export class SeedModule {}
