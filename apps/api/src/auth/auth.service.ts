import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { AuditService } from '../audit';
import { AuthUser } from '../common/auth-user';
import { User } from '../entities/user.entity';
import { LoginLogService } from './login-log.service';

export interface LoginMeta {
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly loginLogs: LoginLogService,
  ) {}

  async login(username: string, password: string, meta?: LoginMeta | null) {
    const ip = meta?.ip ?? null;
    const userAgent = meta?.userAgent ?? null;
    const user = await this.users.findOne({ where: { username } });
    const matched =
      user && user.enabled
        ? await bcrypt.compare(password, user.passwordHash)
        : false;
    if (!user || !matched) {
      await this.loginLogs.record({
        userId: user?.id ?? null,
        username: user?.username ?? username,
        result: 'failure',
        ip,
        userAgent,
      });
      await this.audit.write({
        user: user ? { id: user.id, username: user.username } : null,
        action: 'auth.login_failed',
        resource: 'auth',
        detail: { username },
        ip,
      });
      throw new UnauthorizedException('用户名或密码错误');
    }
    const authUser = this.toAuthUser(user);
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      shedCodes: user.shedCodes ?? [],
    });
    await this.loginLogs.record({
      userId: user.id,
      username: user.username,
      result: 'success',
      ip,
      userAgent,
    });
    await this.audit.write({
      user: authUser,
      action: 'auth.login',
      resource: 'auth',
      ip,
    });
    return { accessToken, user: authUser };
  }

  async changeOwnPassword(
    actor: AuthUser | undefined,
    currentPassword: string,
    newPassword: string,
    ip?: string | null,
  ) {
    if (!actor?.id) throw new UnauthorizedException('请先登录');
    const user = await this.users.findOne({ where: { id: actor.id } });
    if (!user) throw new NotFoundException('用户不存在');
    if (!user.enabled) throw new BadRequestException('账号已停用');
    const matched = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!matched) throw new BadRequestException('当前密码不正确');
    if (currentPassword === newPassword) {
      throw new BadRequestException('新密码不能与当前密码相同');
    }
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await this.users.save(user);
    await this.audit.write({
      user: this.toAuthUser(user),
      action: 'auth.password_change',
      resource: `user:${user.id}`,
      detail: { username: user.username },
      ip: ip ?? null,
    });
    return { username: user.username, changed: true as const };
  }

  toAuthUser(user: User): AuthUser {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      shedCodes: user.shedCodes ?? [],
    };
  }
}
