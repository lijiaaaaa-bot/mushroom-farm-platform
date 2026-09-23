import { Module } from '@nestjs/common';
import { IngestModule } from '../ingest';
import { DiseasesController } from './diseases.controller';

@Module({
  imports: [IngestModule],
  controllers: [DiseasesController],
})
export class DiseasesModule {}
