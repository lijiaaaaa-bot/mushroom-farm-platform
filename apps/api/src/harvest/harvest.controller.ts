import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { HARVEST_SHIFTS, HARVEST_TASK_STATUSES } from '../entities/harvest-task.entity';
import { Request } from 'express';
import { AuditService } from '../audit';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, Roles } from '../common/decorators';
import { HarvestService } from './harvest.service';

class ScheduleTaskDto {
  @IsOptional()
  @IsString()
  assignee?: string;

  @IsOptional()
  @IsIn([...HARVEST_SHIFTS, ''])
  shift?: string;

  @IsOptional()
  @IsIn(HARVEST_TASK_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

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

  @Get('yield-estimate')
  yieldEstimate(
    @CurrentUser() user: AuthUser,
    @Query('shedCode') shedCode?: string,
  ) {
    return this.harvest.yieldEstimate(user, shedCode);
  }

  @Get('bucket-forecast')
  bucketForecast(
    @CurrentUser() user: AuthUser,
    @Query('shedCode') shedCode?: string,
  ) {
    return this.harvest.bucketForecast(user, shedCode);
  }

  @Get('tasks')
  tasks(@CurrentUser() user: AuthUser, @Query('date') date?: string) {
    return this.harvest.listTasks(user, date);
  }

  @Post('tasks/generate')
  @Roles('super_admin', 'production_admin', 'shed_manager')
  async generate(
    @CurrentUser() user: AuthUser,
    @Query('date') date: string | undefined,
    @Req() request: Request,
  ) {
    const result = await this.harvest.generateTasks(user, date);
    await this.audit.write({
      user,
      action: 'harvest.tasks.generate',
      resource: `harvest-tasks:${result.date}`,
      detail: { date: result.date, count: result.items.length },
      ip: request.ip,
    });
    return result;
  }

  @Patch('tasks/:id')
  @Roles('super_admin', 'production_admin', 'shed_manager')
  async schedule(
    @Param('id') id: string,
    @Body() body: ScheduleTaskDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    const item = await this.harvest.scheduleTask(user, id, {
      ...body,
      shift: body.shift === '' ? null : body.shift,
    });
    await this.audit.write({
      user,
      action: 'harvest.tasks.schedule',
      resource: `harvest-task:${item.id}`,
      detail: {
        shedCode: item.shedCode,
        cameraCode: item.cameraCode,
        assignee: item.assignee,
        shift: item.shift,
        status: item.status,
      },
      ip: request.ip,
    });
    return item;
  }

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
