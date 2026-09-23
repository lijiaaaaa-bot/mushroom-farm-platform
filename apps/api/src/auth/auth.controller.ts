import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { Request } from 'express';
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
    return this.auth.login(body.username, body.password, request.ip);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
