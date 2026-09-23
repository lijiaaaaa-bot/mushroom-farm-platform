import { Controller, Get, Query } from '@nestjs/common';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators';
import { GrowthTrendService } from './growth-trend.service';

@Controller('growth-trends')
export class GrowthTrendsController {
  constructor(private readonly trends: GrowthTrendService) {}

  @Get()
  series(
    @CurrentUser() user: AuthUser,
    @Query('days') days?: string,
    @Query('shedCode') shedCode?: string,
    @Query('cameraCode') cameraCode?: string,
  ) {
    return this.trends.series(user, { days, shedCode, cameraCode });
  }
}
