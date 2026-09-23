import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser } from '../common/auth-user';
import { parsePage } from '../common/pagination';
import { ShedScope } from '../common/shed-scope';
import { AuditLog } from '../entities/audit-log.entity';

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog) private readonly logs: Repository<AuditLog>,
  ) {}

  async write(entry: {
    user?: Pick<AuthUser, 'id' | 'username'> | null;
    action: string;
    resource: string;
    detail?: Record<string, unknown> | null;
    ip?: string | null;
  }) {
    await this.logs.save(
      this.logs.create({
        userId: entry.user?.id ?? null,
        username: entry.user?.username ?? null,
        action: entry.action,
        resource: entry.resource,
        detail: entry.detail ?? null,
        ip: entry.ip ?? null,
      }),
    );
  }

  async list(scope: ShedScope, query: { page?: string; pageSize?: string }) {
    void scope;
    const page = parsePage(query);
    const [items, total] = await this.logs.findAndCount({
      order: { createdAt: 'DESC' },
      skip: page.skip,
      take: page.pageSize,
    });
    return { items, total, page: page.page, pageSize: page.pageSize };
  }
}
