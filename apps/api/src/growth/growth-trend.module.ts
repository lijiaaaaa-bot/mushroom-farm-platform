import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DailyAggregate } from '../entities/daily-aggregate.entity';
import {
  MetricBucketDay,
  MetricBucketHour,
} from '../entities/metric-bucket.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import { GrowthTrendsController } from './growth-trend.controller';
import { GrowthTrendService } from './growth-trend.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DailyAggregate,
      RecognitionRecord,
      MetricBucketHour,
      MetricBucketDay,
    ]),
  ],
  controllers: [GrowthTrendsController],
  providers: [GrowthTrendService],
  exports: [GrowthTrendService],
})
export class GrowthTrendModule {}
