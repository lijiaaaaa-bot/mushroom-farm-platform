import { Injectable, UnauthorizedException } from '@nestjs/common';
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
