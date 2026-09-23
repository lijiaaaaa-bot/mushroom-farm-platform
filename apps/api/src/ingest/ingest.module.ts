import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertsModule } from '../alerts';
import { DevicesModule } from '../devices';
import { EnvironmentReading } from '../entities/environment-reading.entity';
import { IngestReject } from '../entities/ingest-reject.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';
import { MqttIngestAdapter } from './mqtt.adapter';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RecognitionRecord,
      EnvironmentReading,
      IngestReject,
    ]),
    DevicesModule,
    AlertsModule,
  ],
  controllers: [IngestController],
  providers: [IngestService, MqttIngestAdapter],
  exports: [IngestService],
})
export class IngestModule {}
