import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Optional,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ALERT_LEVELS,
  ALERT_METRICS,
  parseAlertFalsePositive,
  parseAlertNote,
  parseCreateAlert,
} from '@mushroom/contracts';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { Request } from 'express';
import { AuditService } from '../audit';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, Roles } from '../common/decorators';
import { ListQuery } from '../common/pagination';
import { AlertsService } from './alerts.service';
import { SevereAlertPushService } from './severe-alert-push.service';

class CreateRuleDto {
  @IsString()
  name: string;

  @IsIn(ALERT_METRICS as unknown as string[])
  metric: string;

  @IsNumber()
  threshold: number;

  @IsIn(ALERT_LEVELS as unknown as string[])
  level: string;

  @IsOptional()
  @IsString()
  shedCode?: string;

  @IsOptional()
  @IsNumber()
  windowMinutes?: number;
}

class UpdateRuleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsNumber()
  threshold?: number;

  @IsOptional()
  @IsIn(ALERT_LEVELS as unknown as string[])
  level?: string;

  @IsOptional()
  @IsNumber()
  windowMinutes?: number;
}

@Controller()
export class AlertsController {
  constructor(
    private readonly alerts: AlertsService,
    private readonly audit: AuditService,
    @Optional() private readonly push?: SevereAlertPushService,
  ) {}

  @Get('alerts')
  list(@CurrentUser() user: AuthUser, @Query() query: ListQuery) {
    return this.alerts.list(user, query);
  }

  @Get('alerts/unread')
  unread(@CurrentUser() user: AuthUser) {
    return this.alerts.listUnread(user);
  }

  @Get('alerts/push-channels')
  pushChannels() {
    return (
      this.push?.channels() ?? { wecomEnabled: false, dingtalkEnabled: false }
    );
  }

  @Post('alerts/read-all')
  @HttpCode(200)
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.alerts.markAllRead(user);
  }

  @Post('alerts/:id/read')
  @HttpCode(200)
  markRead(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.alerts.markRead(user, id);
  }

  @Post('alerts')
  @Roles('super_admin', 'production_admin', 'shed_manager')
  async create(
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    const parsed = parseCreateAlert(body);
    if (!parsed.ok) {
      throw new BadRequestException({
        code: parsed.code,
        message: '告警报文被拒绝',
        errors: parsed.errors,
      });
    }
    const alert = await this.alerts.create(user, parsed.value);
    await this.audit.write({
      user,
      action: 'alert.create',
      resource: `alert:${alert.id}`,
      detail: {
        shedCode: alert.shedCode,
        level: alert.level,
        title: alert.title,
      },
      ip: request.ip,
    });
    return alert;
  }

  @Post('alerts/:id/ack')
  @Roles('super_admin', 'production_admin', 'shed_manager')
  async ack(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    const parsed = parseAlertNote(body ?? {});
    if (!parsed.ok) {
      throw new BadRequestException({
        code: parsed.code,
        message: '确认报文被拒绝',
        errors: parsed.errors,
      });
    }
    const alert = await this.alerts.ack(user, id, parsed.value.note);
    await this.audit.write({
      user,
      action: 'alert.ack',
      resource: `alert:${alert.id}`,
      detail: { note: parsed.value.note ?? null },
      ip: request.ip,
    });
    return alert;
  }

  @Post('alerts/:id/close')
  @Roles('super_admin', 'production_admin', 'shed_manager')
  async close(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    const parsed = parseAlertNote(body ?? {});
    if (!parsed.ok) {
      throw new BadRequestException({
        code: parsed.code,
        message: '关闭报文被拒绝',
        errors: parsed.errors,
      });
    }
    const alert = await this.alerts.close(user, id, parsed.value.note);
    await this.audit.write({
      user,
      action: 'alert.close',
      resource: `alert:${alert.id}`,
      detail: {
        note: parsed.value.note ?? null,
        closeReason: alert.closeReason,
      },
      ip: request.ip,
    });
    return alert;
  }

  @Post('alerts/:id/claim')
  @Roles('super_admin', 'production_admin', 'shed_manager')
  async claim(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    const parsed = parseAlertNote(body ?? {});
    if (!parsed.ok) {
      throw new BadRequestException({
        code: parsed.code,
        message: '认领报文被拒绝',
        errors: parsed.errors,
      });
    }
    const alert = await this.alerts.claim(user, id, parsed.value.note);
    await this.audit.write({
      user,
      action: 'alert.claim',
      resource: `alert:${alert.id}`,
      detail: {
        note: parsed.value.note ?? null,
        claimedBy: alert.claimedBy,
      },
      ip: request.ip,
    });
    return alert;
  }

  @Post('alerts/:id/false-positive')
  @Roles('super_admin', 'production_admin', 'shed_manager')
  async falsePositive(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    const parsed = parseAlertFalsePositive(body ?? {});
    if (!parsed.ok) {
      throw new BadRequestException({
        code: parsed.code,
        message: '误报报文被拒绝',
        errors: parsed.errors,
      });
    }
    const alert = await this.alerts.closeFalsePositive(
      user,
      id,
      parsed.value.note,
    );
    await this.audit.write({
      user,
      action: 'alert.false_positive',
      resource: `alert:${alert.id}`,
      detail: {
        note: parsed.value.note,
        closeReason: alert.closeReason,
      },
      ip: request.ip,
    });
    return alert;
  }

  @Get('alert-rules')
  rules(@CurrentUser() user: AuthUser) {
    return this.alerts.listRules(user);
  }

  @Post('alert-rules')
  @Roles('super_admin', 'production_admin')
  async createRule(
    @Body() body: CreateRuleDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    const rule = await this.alerts.createRule(user, body);
    await this.audit.write({
      user,
      action: 'alert_rule.create',
      resource: `alert_rule:${rule.id}`,
      detail: { metric: rule.metric, threshold: rule.threshold },
      ip: request.ip,
    });
    return rule;
  }

  @Patch('alert-rules/:id')
  @Roles('super_admin', 'production_admin')
  updateRule(
    @Param('id') id: string,
    @Body() body: UpdateRuleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.alerts.updateRule(user, id, body);
  }
}
