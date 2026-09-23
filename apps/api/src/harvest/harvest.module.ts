import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import { GrowthTrendModule } from '../growth';
import { HarvestController } from './harvest.controller';
import { HarvestService } from './harvest.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([RecognitionRecord]),
    GrowthTrendModule,
  ],
  controllers: [HarvestController],
  providers: [HarvestService],
  exports: [HarvestService],
})
export class HarvestModule {}
