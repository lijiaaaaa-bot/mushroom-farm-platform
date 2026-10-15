import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  FindOptionsWhere,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
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

  async list(
    scope: ShedScope,
    query: {
      page?: string;
      pageSize?: string;
      username?: string;
      from?: string;
      to?: string;
    },
  ) {
    void scope;
    const page = parsePage(query);
    const where: FindOptionsWhere<AuditLog> = {};
    const username = query.username?.trim();
    if (username) where.username = username;
    const from = parseBound(query.from, '开始时间');
    const to = parseBound(query.to, '结束时间');
    if (from && to && from.getTime() > to.getTime()) {
      throw new BadRequestException('时间筛选无效');
    }
    if (from && to) where.createdAt = Between(from, to);
    else if (from) where.createdAt = MoreThanOrEqual(from);
    else if (to) where.createdAt = LessThanOrEqual(to);
    const [items, total] = await this.logs.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: page.skip,
      take: page.pageSize,
    });
    return { items, total, page: page.page, pageSize: page.pageSize };
  }
}

function parseBound(
  value: string | undefined,
  label: string,
): Date | undefined {
  if (!value?.trim()) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${label}无效`);
  }
  return date;
}
