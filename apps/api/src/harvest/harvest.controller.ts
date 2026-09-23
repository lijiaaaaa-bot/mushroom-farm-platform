import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
} from '@nestjs/common';
import { IsInt, IsOptional, Min } from 'class-validator';
import { Request } from 'express';
import { AuditService } from '../audit';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, Roles } from '../common/decorators';
import { HarvestService } from './harvest.service';

class CorrectHarvestDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  matureCount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  mushroomCount?: number;
}

@Controller('harvest')
export class HarvestController {
  constructor(
    private readonly harvest: HarvestService,
    private readonly audit: AuditService,
  ) {}

  @Get('daily')
  daily(@CurrentUser() user: AuthUser, @Query('date') date?: string) {
    return this.harvest.daily(user, date);
  }

  @Get('daily/list')
  async list(@CurrentUser() user: AuthUser, @Query('date') date?: string) {
    const result = await this.harvest.daily(user, date);
    return { date: result.date, items: result.items };
  }

  @Patch('daily/:id')
  @Roles('super_admin', 'production_admin', 'shed_manager')
  async correct(
    @Param('id') id: string,
    @Body() body: CorrectHarvestDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    const result = await this.harvest.correct(user, id, body);
    if (result.changes.matureCount || result.changes.mushroomCount) {
      await this.audit.write({
        user,
        action: 'harvest.correct',
        resource: `recognition:${result.item.id}`,
        detail: {
          shedCode: result.item.shedCode,
          cameraCode: result.item.cameraCode,
          changes: result.changes,
        },
        ip: request.ip,
      });
    }
    return result.item;
  }
}
