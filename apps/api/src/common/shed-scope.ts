import { ForbiddenException } from '@nestjs/common';
import { AuthUser } from './auth-user';

/**
 * 棚区隔离。超管与生产管理员 codes = null 表示全场；
 * 棚区负责人与查看只保留账号上的棚区编号。
 * 挂在 ShedIsolationGuard 上：中间件早于 JWT，隔离必须发生在认证之后。
 */
export class ShedScope {
  constructor(readonly codes: string[] | null) {}

  static fromUser(user: AuthUser): ShedScope {
    if (user.role === 'super_admin' || user.role === 'production_admin') {
      return new ShedScope(null);
    }
    return new ShedScope(user.shedCodes ?? []);
  }

  allows(shedCode: string): boolean {
    return this.codes === null || this.codes.includes(shedCode);
  }

  assert(shedCode: string): void {
    if (!this.allows(shedCode)) throw new ForbiddenException('无权访问该棚区');
  }

  /** null = 不限制；空数组 = 看不到任何棚。 */
  sqlParam(): string[] | null {
    return this.codes;
  }
}
