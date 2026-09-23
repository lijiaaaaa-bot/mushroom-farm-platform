import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertPushModule } from '../alerts';
import { Alert } from '../entities/alert.entity';
import { Device } from '../entities/device.entity';
import { Shed } from '../entities/shed.entity';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

@Module({
  imports: [TypeOrmModule.forFeature([Device, Shed, Alert]), AlertPushModule],
  controllers: [DevicesController],
  providers: [DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
