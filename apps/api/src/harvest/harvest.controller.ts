import { Controller, Get, Query } from '@nestjs/common';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators';
import { HarvestService } from './harvest.service';

@Controller('harvest')
export class HarvestController {
  constructor(private readonly harvest: HarvestService) {}

  @Get('daily')
  daily(@CurrentUser() user: AuthUser, @Query('date') date?: string) {
    return this.harvest.daily(user, date);
  }

  @Get('daily/list')
  async list(@CurrentUser() user: AuthUser, @Query('date') date?: string) {
    const result = await this.harvest.daily(user, date);
    return { date: result.date, items: result.items };
  }
}
