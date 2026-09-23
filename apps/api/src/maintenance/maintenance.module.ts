import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import { RetentionService } from './retention.service';

@Module({
  imports: [TypeOrmModule.forFeature([RecognitionRecord])],
  providers: [RetentionService],
})
export class MaintenanceModule {}
