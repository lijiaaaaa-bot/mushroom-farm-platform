import { Module } from '@nestjs/common';
import { GrowthTrendModule } from '../growth';
import { IngestModule } from '../ingest';
import { DiseasesController } from './diseases.controller';

@Module({
  imports: [IngestModule, GrowthTrendModule],
  controllers: [DiseasesController],
})
export class DiseasesModule {}
