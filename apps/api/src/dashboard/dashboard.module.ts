import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DevicesModule } from '../devices';
import { Alert } from '../entities/alert.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import { Shed } from '../entities/shed.entity';
import { GrowthTrendModule } from '../growth';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Alert, Shed, RecognitionRecord]),
    GrowthTrendModule,
    DevicesModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
