import { Body, Controller, Get, Param, Patch, Req } from '@nestjs/common';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Request } from 'express';
import { AuditService } from '../audit';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, Roles } from '../common/decorators';
import { ShedsService } from './sheds.service';

class UpdateShedLayoutDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  mapX?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  mapY?: number | null;
}

@Controller('sheds')
export class ShedsController {
  constructor(
    private readonly sheds: ShedsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.sheds.list(user);
  }

  @Patch(':id')
  @Roles('super_admin', 'production_admin')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateShedLayoutDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    const shed = await this.sheds.updateLayout(user, id, body);
    await this.audit.write({
      user,
      action: 'shed.layout',
      resource: `shed:${shed.id}`,
      detail: { code: shed.code, mapX: shed.mapX, mapY: shed.mapY },
      ip: request.ip,
    });
    return shed;
  }
}
