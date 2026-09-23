import { Controller, Get, Query, StreamableFile } from '@nestjs/common';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('growth.xlsx')
  async growth(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.file(await this.reports.growth(user, from, to), 'growth.xlsx');
  }

  @Get('disease.xlsx')
  async disease(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.file(
      await this.reports.disease(user, from, to),
      'disease.xlsx',
    );
  }

  @Get('env.xlsx')
  async environment(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.file(
      await this.reports.environment(user, from, to),
      'env.xlsx',
    );
  }

  @Get('devices.xlsx')
  async devices(@CurrentUser() user: AuthUser) {
    return this.file(await this.reports.devicesSheet(user), 'devices.xlsx');
  }

  @Get('alerts.xlsx')
  async alerts(@CurrentUser() user: AuthUser) {
    return this.file(await this.reports.alertsSheet(user), 'alerts.xlsx');
  }

  private file(buffer: Buffer, filename: string) {
    return new StreamableFile(buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${filename}"`,
    });
  }
}
