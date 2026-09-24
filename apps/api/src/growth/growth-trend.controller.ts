import { Controller, Get, Query } from '@nestjs/common';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators';
import { GrowthTrendService } from './growth-trend.service';

@Controller('growth-trends')
export class GrowthTrendsController {
  constructor(private readonly trends: GrowthTrendService) {}

  @Get('hours')
  hours(
    @CurrentUser() user: AuthUser,
    @Query('hours') hours?: string,
    @Query('shedCode') shedCode?: string,
    @Query('cameraCode') cameraCode?: string,
  ) {
    return this.trends.hourlySeries(user, { hours, shedCode, cameraCode });
  }

  @Get('environment')
  environment(
    @CurrentUser() user: AuthUser,
    @Query('hours') hours?: string,
    @Query('shedCode') shedCode?: string,
  ) {
    return this.trends.environmentSeries(user, { hours, shedCode });
  }

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
