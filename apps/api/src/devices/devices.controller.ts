import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { Request } from 'express';
import { AuditService } from '../audit';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, Roles } from '../common/decorators';
import { ListQuery } from '../common/pagination';
import { DEVICE_TYPES } from '@mushroom/contracts';
import { DeviceImportFile, readDeviceImport } from './device-import';
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

  @Post('import')
  @HttpCode(200)
  @Roles('super_admin', 'production_admin', 'shed_manager')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1_000_000 } }))
  async importDevices(
    @UploadedFile() file: DeviceImportFile | undefined,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    const result = await this.devices.importRows(
      user,
      readDeviceImport(file, request.body),
    );
    await this.audit.write({
      user,
      action: 'device.import',
      resource: 'device:batch',
      detail: {
        successCount: result.successCount,
        failCount: result.failCount,
        skippedCount: result.skippedCount,
      },
      ip: request.ip,
    });
    return result;
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
