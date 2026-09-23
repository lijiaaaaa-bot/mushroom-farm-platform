import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Not, Repository } from 'typeorm';
import {
  IMAGE_RETENTION_DAYS,
  TIMESERIES_RETENTION_DAYS,
} from '@mushroom/contracts';
import { EnvironmentReading } from '../entities/environment-reading.entity';
import { RecognitionRecord } from '../entities/recognition-record.entity';
import { MinioStorageService } from '../storage';

/** 图片 30 天、时序 90 天。定时任务已接线，数据量上来后仍走同一入口。 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    @InjectRepository(RecognitionRecord)
    private readonly records: Repository<RecognitionRecord>,
    @InjectRepository(EnvironmentReading)
    private readonly readings: Repository<EnvironmentReading>,
    private readonly storage: MinioStorageService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async scheduled() {
    const result = await this.purgeOnce();
    this.logger.log(`保留期清理：${JSON.stringify(result)}`);
  }

  async purgeOnce() {
    const imageCutoff = new Date(
      Date.now() - IMAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const seriesCutoff = new Date(
      Date.now() - TIMESERIES_RETENTION_DAYS * 24 * 60 * 60 * 1000,
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
