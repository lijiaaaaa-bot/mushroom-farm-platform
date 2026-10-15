import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { parsePatchSystemParams } from '@mushroom/contracts';
import { AuditService } from '../audit';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, Roles } from '../common/decorators';
import { SystemParamsService } from './system-params.service';

@Controller('system-params')
export class SystemParamsController {
  constructor(
    private readonly params: SystemParamsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Roles('super_admin')
  current() {
    return this.params.current();
  }

  @Patch()
  @Roles('super_admin')
  async patch(
    @Body() body: unknown,
    @CurrentUser() actor: AuthUser,
    @Req() request: Request,
  ) {
    const parsed = parsePatchSystemParams(body);
    if (!parsed.ok) {
      throw new BadRequestException({
        code: parsed.code,
        message: '系统参数无效',
        errors: parsed.errors,
      });
    }
    const result = await this.params.patch(parsed.value, actor);
    await this.audit.write({
      user: actor,
      action: 'system_params.update',
      resource: 'system_params',
      detail: {
        changes: result.changes.map((change) => ({
          key: change.key,
          before: change.beforeText,
          after: change.afterText,
        })),
      },
      ip: request.ip,
    });
    return result;
  }
}
