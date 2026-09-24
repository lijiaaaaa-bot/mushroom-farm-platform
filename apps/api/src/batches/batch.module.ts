import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FlushBatch, FlushPhaseEvent } from '../entities/flush-batch.entity';
import { MetricBucketDay } from '../entities/metric-bucket.entity';
import { BatchController } from './batch.controller';
import { BatchService } from './batch.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([FlushBatch, FlushPhaseEvent, MetricBucketDay]),
  ],
  controllers: [BatchController],
  providers: [BatchService],
})
export class BatchModule {}
