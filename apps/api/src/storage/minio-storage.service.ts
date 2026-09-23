import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client as MinioClient } from 'minio';
import { buildSnapshotObjectKey } from '@mushroom/contracts';

@Injectable()
export class MinioStorageService implements OnModuleInit {
  private readonly logger = new Logger(MinioStorageService.name);
  private client: MinioClient | null = null;
  private ready = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const endPoint = this.config.get<string>('minio.endPoint') || '127.0.0.1';
    const port = this.config.get<number>('minio.port') || 9000;
    const useSSL = this.config.get<boolean>('minio.useSSL') === true;
    const accessKey =
      this.config.get<string>('minio.accessKey') || 'minioadmin';
    const secretKey =
      this.config.get<string>('minio.secretKey') || 'minioadmin';
    this.client = new MinioClient({
      endPoint,
      port,
      useSSL,
      accessKey,
      secretKey,
    });
    void this.ensureBucket();
  }

  objectKey(shedCode: string, cameraCode: string, recognizedAt: Date): string {
    return buildSnapshotObjectKey(shedCode, cameraCode, recognizedAt);
  }

  async putSnapshot(
    shedCode: string,
    cameraCode: string,
    recognizedAt: Date,
    body: Buffer,
  ): Promise<{ objectKey: string; url: string } | null> {
    if (!this.client) return null;
    if (!this.ready) await this.ensureBucket();
    if (!this.ready || !this.client) return null;
    const bucket =
      this.config.get<string>('minio.bucket') || 'mushroom-snapshots';
    const objectKey = this.objectKey(shedCode, cameraCode, recognizedAt);
    await this.client.putObject(bucket, objectKey, body, body.length, {
      'Content-Type': 'image/jpeg',
    });
    const base =
      this.config.get<string>('minio.publicBaseUrl') ||
      `http://127.0.0.1:9000/${bucket}`;
    return { objectKey, url: `${base.replace(/\/$/, '')}/${objectKey}` };
  }

  async remove(objectKey: string): Promise<void> {
    if (!this.client || !this.ready) return;
    const bucket =
      this.config.get<string>('minio.bucket') || 'mushroom-snapshots';
    await this.client.removeObject(bucket, objectKey).catch((error: Error) => {
      this.logger.warn(`删除抓拍失败 ${objectKey}：${error.message}`);
    });
  }

  private async ensureBucket() {
    if (!this.client) return;
    const bucket =
      this.config.get<string>('minio.bucket') || 'mushroom-snapshots';
    try {
      const exists = await this.client.bucketExists(bucket);
      if (!exists) await this.client.makeBucket(bucket);
      this.ready = true;
      this.logger.log(`MinIO 桶就绪：${bucket}`);
    } catch (error) {
      this.ready = false;
      this.logger.warn(
        `MinIO 不可用，抓拍将跳过入库：${(error as Error).message}`,
      );
    }
  }
}
