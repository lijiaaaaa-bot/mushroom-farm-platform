import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Not, Repository } from 'typeorm';
import { EnvironmentReading } from '../entities/environment-reading.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import { MinioStorageService } from '../storage';
import { SystemParamsService } from '../system-params/system-params.service';

/** 图片与时序天数读 system_params。没改过时仍是 30 天和 90 天。 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    @InjectRepository(RecognitionRecord)
    private readonly records: Repository<RecognitionRecord>,
    @InjectRepository(EnvironmentReading)
    private readonly readings: Repository<EnvironmentReading>,
    private readonly storage: MinioStorageService,
    private readonly params: SystemParamsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async scheduled() {
    const result = await this.purgeOnce();
    this.logger.log(`保留期清理：${JSON.stringify(result)}`);
  }

  async purgeOnce() {
    const params = await this.params.current();
    const imageCutoff = new Date(
      Date.now() - params.imageRetentionDays * 24 * 60 * 60 * 1000,
    );
    const seriesCutoff = new Date(
      Date.now() - params.timeseriesRetentionDays * 24 * 60 * 60 * 1000,
    );
    const staleImages = await this.records.find({
      where: {
        recognizedAt: LessThan(imageCutoff),
        snapshotObjectKey: Not(IsNull()),
      },
    });
    for (const row of staleImages) {
      if (row.snapshotObjectKey)
        await this.storage.remove(row.snapshotObjectKey);
      row.snapshotObjectKey = null;
      row.snapshotUrl = null;
    }
    if (staleImages.length) await this.records.save(staleImages);
    const removed = await this.records.delete({
      recognizedAt: LessThan(seriesCutoff),
    });
    const environmentRemoved = await this.readings.delete({
      observedAt: LessThan(seriesCutoff),
    });
    return {
      imagesCleared: staleImages.length,
      rowsDeleted: removed.affected ?? 0,
      environmentRowsDeleted: environmentRemoved.affected ?? 0,
    };
  }
}
