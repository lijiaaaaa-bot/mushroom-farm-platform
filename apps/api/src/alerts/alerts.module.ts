import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertRule } from '../entities/alert-rule.entity';
import { Alert } from '../entities/alert.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import { AlertEngineService } from './alert-engine.service';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';

@Module({
  imports: [TypeOrmModule.forFeature([Alert, AlertRule, RecognitionRecord])],
  controllers: [AlertsController],
  providers: [AlertsService, AlertEngineService],
  exports: [AlertEngineService, AlertsService],
})
export class AlertsModule {}
