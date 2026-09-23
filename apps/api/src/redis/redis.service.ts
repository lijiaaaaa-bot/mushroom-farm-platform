import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const url = this.config.get<string>('redisUrl') || 'redis://127.0.0.1:6379';
    this.client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2000,
      retryStrategy: (times) => Math.min(times * 500, 5000),
    });
    this.client.on('error', (error) => {
      this.logger.warn(`Redis 不可用：${error.message}`);
    });
    void this.client.connect().catch((error: Error) => {
      this.logger.warn(`Redis 连接失败，幂等将只依赖数据库：${error.message}`);
    });
  }

  async onModuleDestroy() {
    await this.client?.quit().catch(() => undefined);
  }

  /** 返回 true 表示新键，false 表示已存在，null 表示 Redis 不可用。 */
  async setNx(key: string, ttlSeconds: number): Promise<boolean | null> {
    if (!this.client || this.client.status !== 'ready') return null;
    try {
      const result = await this.client.set(key, '1', 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch (error) {
      this.logger.warn(`Redis SET NX 失败：${(error as Error).message}`);
      return null;
    }
  }
}
