import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertRule } from '../entities/alert-rule.entity';
import { AlertRead } from '../entities/alert-read.entity';
import { Alert } from '../entities/alert.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import { AlertEngineService } from './alert-engine.service';
import { AlertPushModule } from './alert-push.module';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Alert, AlertRead, AlertRule, RecognitionRecord]),
    AlertPushModule,
  ],
  controllers: [AlertsController],
  providers: [AlertsService, AlertEngineService],
  exports: [AlertEngineService, AlertsService],
})
export class AlertsModule {}
