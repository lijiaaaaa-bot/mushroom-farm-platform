import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  IsArray,
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
import { ROLES, Role, isRole } from '@mushroom/contracts';
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
    return rows.map((user) => ({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      shedCodes: user.shedCodes,
      enabled: user.enabled,
      createdAt: user.createdAt,
    }));
  }

  @Post()
  @Roles('super_admin')
  async create(
    @Body() body: CreateUserDto,
    @CurrentUser() actor: AuthUser,
    @Req() request: Request,
  ) {
    if (!isRole(body.role)) return { message: '角色无效' };
    const user = await this.users.save(
      this.users.create({
        username: body.username.trim(),
        passwordHash: await bcrypt.hash(body.password, 10),
        displayName: body.displayName,
        role: body.role,
        shedCodes: body.shedCodes ?? [],
        enabled: true,
      }),
    );
    await this.audit.write({
      user: actor,
      action: 'user.create',
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
