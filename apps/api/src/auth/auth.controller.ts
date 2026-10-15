import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { Request } from 'express';
import { parseChangeOwnPassword } from '@mushroom/contracts';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, Public } from '../common/decorators';
import { AuthService } from './auth.service';

class LoginDto {
  @IsString()
  @MinLength(1, { message: '请输入用户名' })
  username: string;

  @IsString()
  @MinLength(1, { message: '请输入密码' })
  password: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() body: LoginDto, @Req() request: Request) {
    const header = request.headers['user-agent'];
    const userAgent = Array.isArray(header) ? header[0] : header;
    return this.auth.login(body.username, body.password, {
      ip: request.ip ?? null,
      userAgent: userAgent ?? null,
    });
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  changePassword(
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    const parsed = parseChangeOwnPassword(body);
    if (!parsed.ok) {
      throw new BadRequestException({
        code: parsed.code,
        message: '密码无效',
        errors: parsed.errors,
      });
    }
    return this.auth.changeOwnPassword(
      user,
      parsed.value.currentPassword,
      parsed.value.newPassword,
      request.ip ?? null,
    );
  }
}
