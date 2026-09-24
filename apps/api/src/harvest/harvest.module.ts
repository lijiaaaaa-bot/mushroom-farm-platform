import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HarvestTask } from '../entities/harvest-task.entity';
import { MetricBucketDay } from '../entities/metric-bucket.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import { GrowthTrendModule } from '../growth';
import { HarvestController } from './harvest.controller';
import { HarvestService } from './harvest.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([RecognitionRecord, HarvestTask, MetricBucketDay]),
    GrowthTrendModule,
  ],
  controllers: [HarvestController],
  providers: [HarvestService],
  exports: [HarvestService],
})
export class HarvestModule {}
