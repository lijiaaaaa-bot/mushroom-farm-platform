import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  FindOptionsWhere,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { parsePage } from '../common/pagination';
import { LoginLog } from '../entities/login-log.entity';

export type LoginResult = 'success' | 'failure';

@Injectable()
export class LoginLogService {
  constructor(
    @InjectRepository(LoginLog) private readonly logs: Repository<LoginLog>,
  ) {}

  async record(entry: {
    userId?: string | null;
    username?: string | null;
    result: LoginResult;
    ip?: string | null;
    userAgent?: string | null;
  }) {
    await this.logs.save(
      this.logs.create({
        userId: entry.userId ?? null,
        username: entry.username ?? null,
        result: entry.result,
        ip: entry.ip ?? null,
        userAgent: entry.userAgent ?? null,
      }),
    );
  }

  async list(query: {
    page?: string;
    pageSize?: string;
    username?: string;
    from?: string;
    to?: string;
  }) {
    const page = parsePage(query);
    const where: FindOptionsWhere<LoginLog> = {};
    const username = query.username?.trim();
    if (username) where.username = username;
    const from = parseBound(query.from, '开始时间');
    const to = parseBound(query.to, '结束时间');
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
