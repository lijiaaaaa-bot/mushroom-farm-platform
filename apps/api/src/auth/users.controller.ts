import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import bcrypt from 'bcryptjs';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { AuditService } from '../audit';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, Roles } from '../common/decorators';
import { ROLES, Role, isRole, parseSetUserEnabled } from '@mushroom/contracts';
import { User } from '../entities/user.entity';

class CreateUserDto {
  @IsString()
  @MinLength(2)
  username: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsString()
  displayName: string;

  @IsIn(ROLES as unknown as string[])
  role: Role;

  @IsOptional()
  @IsArray()
  shedCodes?: string[];

  /** 用户名已存在时，超管显式要求才重设密码和角色。 */
  @IsOptional()
  @IsBoolean()
  resetPassword?: boolean;
}

@Controller('users')
export class UsersController {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Roles('super_admin')
  async list() {
    const rows = await this.users.find({ order: { createdAt: 'ASC' } });
    return rows.map((user) => this.toPublic(user));
  }

  @Patch(':id')
  @Roles('super_admin')
  async setEnabled(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() actor: AuthUser,
    @Req() request: Request,
  ) {
    const parsed = parseSetUserEnabled(body);
    if (!parsed.ok) {
      throw new BadRequestException({
        code: parsed.code,
        message: '启用状态无效',
        errors: parsed.errors,
      });
    }
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new NotFoundException('用户不存在');
    if (
      !parsed.value.enabled &&
      (user.id === actor.id || user.username === actor.username)
    ) {
      throw new BadRequestException('不能停用当前登录账号');
    }
    if (user.enabled !== parsed.value.enabled) {
      user.enabled = parsed.value.enabled;
      await this.users.save(user);
      await this.audit.write({
        user: actor,
        action: parsed.value.enabled ? 'user.enable' : 'user.disable',
        resource: `user:${user.id}`,
        detail: { username: user.username, enabled: user.enabled },
        ip: request.ip,
      });
    }
    return this.toPublic(user);
  }

  private toPublic(user: User) {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      shedCodes: user.shedCodes ?? [],
      enabled: user.enabled,
      createdAt: user.createdAt,
    };
  }

  @Post()
  @Roles('super_admin')
  async create(
    @Body() body: CreateUserDto,
    @CurrentUser() actor: AuthUser,
    @Req() request: Request,
  ) {
    if (!isRole(body.role)) return { message: '角色无效' };
    const username = body.username.trim();
    const existing = await this.users.findOne({ where: { username } });
    if (existing && !body.resetPassword) {
      throw new ConflictException('用户名已存在');
    }
    const passwordHash = await bcrypt.hash(body.password, 10);
    const user = existing
      ? await this.users.save(
          Object.assign(existing, {
            passwordHash,
            displayName: body.displayName,
            role: body.role,
            shedCodes: body.shedCodes ?? [],
            enabled: true,
          }),
        )
      : await this.users.save(
          this.users.create({
            username,
            passwordHash,
            displayName: body.displayName,
            role: body.role,
            shedCodes: body.shedCodes ?? [],
            enabled: true,
          }),
        );
    await this.audit.write({
      user: actor,
      action: existing ? 'user.update' : 'user.create',
      resource: `user:${user.id}`,
      detail: {
        username: user.username,
        role: user.role,
        shedCodes: user.shedCodes,
      },
      ip: request.ip,
    });
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      shedCodes: user.shedCodes,
    };
  }
}
