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
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { Request } from 'express';
import { AuditService } from '../audit';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, Roles } from '../common/decorators';
import { ListQuery } from '../common/pagination';
import { DEVICE_TYPES } from '@mushroom/contracts';
import { DevicesService } from './devices.service';

class DeviceDto {
  @IsString()
  @MinLength(1)
  code: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsIn(DEVICE_TYPES as unknown as string[])
  type: string;

  @IsString()
  shedCode: string;

  @IsOptional()
  @IsString()
  parentCode?: string;
}

class UpdateDeviceDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  shedCode?: string;

  @IsOptional()
  @IsString()
  parentCode?: string;

  @IsOptional()
  @IsIn(DEVICE_TYPES as unknown as string[])
  type?: string;
}

@Controller('devices')
export class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListQuery) {
    return this.devices.list(user, query);
  }

  @Post()
  @Roles('super_admin', 'production_admin')
  async create(
    @Body() body: DeviceDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    const device = await this.devices.create(user, body);
    await this.audit.write({
      user,
      action: 'device.create',
      resource: `device:${device.id}`,
      detail: {
        code: device.code,
        type: device.type,
        shedCode: device.shedCode,
      },
      ip: request.ip,
    });
    return device;
  }

  @Patch(':id')
  @Roles('super_admin', 'production_admin')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateDeviceDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    const device = await this.devices.update(user, id, body);
    await this.audit.write({
      user,
      action: 'device.update',
      resource: `device:${device.id}`,
      detail: { code: device.code },
      ip: request.ip,
    });
    return device;
  }
}
