import { Module } from '@nestjs/common';
import { SevereAlertPushService } from './severe-alert-push.service';

@Module({
  providers: [SevereAlertPushService],
  exports: [SevereAlertPushService],
})
export class AlertPushModule {}
