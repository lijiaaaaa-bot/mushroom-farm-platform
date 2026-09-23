import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EnvironmentReading } from '../entities/environment-reading.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import { RetentionService } from './retention.service';

@Module({
  imports: [TypeOrmModule.forFeature([RecognitionRecord, EnvironmentReading])],
  providers: [RetentionService],
})
export class MaintenanceModule {}
