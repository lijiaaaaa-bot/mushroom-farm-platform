import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../common/decorators';
import { LoginLogService } from './login-log.service';

@Controller('login-logs')
export class LoginLogsController {
  constructor(private readonly loginLogs: LoginLogService) {}

  @Get()
  @Roles('super_admin', 'production_admin')
  list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('username') username?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.loginLogs.list({ page, pageSize, username, from, to });
  }
}
