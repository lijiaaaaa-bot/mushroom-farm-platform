import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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
