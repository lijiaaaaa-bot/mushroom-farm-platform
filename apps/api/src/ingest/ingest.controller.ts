import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { parseHeartbeatIngress } from '@mushroom/contracts';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, Public } from '../common/decorators';
import { IngestTokenGuard } from '../common/guards';
import { ListQuery } from '../common/pagination';
import { DevicesService } from '../devices';
import { IngestService } from './ingest.service';

@Controller('ingest')
export class IngestController {
  constructor(
    private readonly ingest: IngestService,
    private readonly devices: DevicesService,
  ) {}

  @Public()
  @UseGuards(IngestTokenGuard)
  @Post('recognition')
  async recognition(@Body() body: unknown) {
    const result = await this.ingest.handle(body, 'http');
    if (!result.accepted) {
      throw new BadRequestException({
        accepted: false,
        code: result.code,
        message: '识别报文被拒绝',
        errors: result.errors,
      });
    }
    return result;
  }

  @Public()
  @UseGuards(IngestTokenGuard)
  @Post('environment')
  async environment(@Body() body: unknown) {
    const result = await this.ingest.handleEnvironment(body, 'http');
    if (!result.accepted) {
      throw new BadRequestException({
        accepted: false,
        code: result.code,
        message: '环境报文被拒绝',
        errors: result.errors,
      });
    }
    return result;
  }

  @Public()
  @UseGuards(IngestTokenGuard)
  @Post('heartbeat')
  async heartbeat(@Body() body: unknown) {
    const parsed = parseHeartbeatIngress(body);
    if (!parsed.ok) {
      await this.ingest.recordReject({
        source: 'http',
        channel: 'heartbeat',
        code: parsed.code,
        errors: parsed.errors,
        payload: body,
      });
      throw new BadRequestException({
        accepted: false,
        code: parsed.code,
        message: '心跳报文被拒绝',
        errors: parsed.errors,
      });
    }
    const beat = parsed.value;
    const result = beat.reportedAt
      ? await this.devices.heartbeat(
          beat.shedCode,
          beat.deviceCode,
          beat.deviceType,
          beat.online,
          beat.reportedAt,
        )
      : await this.devices.heartbeat(
          beat.shedCode,
          beat.deviceCode,
          beat.deviceType,
          beat.online,
        );
    await this.ingest.recordHeartbeat({
      source: 'http',
      shedCode: beat.shedCode,
      deviceCode: beat.deviceCode,
      duplicate: result.duplicate,
      reportedAt: beat.reportedAt,
    });
    return result;
  }

  @Get('observability')
  observability(
    @CurrentUser() user: AuthUser,
    @Query('windowMinutes') windowMinutes?: string,
  ) {
    return this.ingest.observability(user, windowMinutes);
  }

  @Get('recognitions')
  list(@CurrentUser() user: AuthUser, @Query() query: ListQuery) {
    return this.ingest.list(user, query);
  }

  @Get('environment-readings')
  listEnvironment(@CurrentUser() user: AuthUser, @Query() query: ListQuery) {
    return this.ingest.listEnvironment(user, query);
  }

  @Get('recognitions/:id/snapshot')
  async snapshot(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const file = await this.ingest.readSnapshot(user, id);
    return new StreamableFile(file.body, {
      type: file.contentType,
      disposition: 'inline; filename="snapshot"',
    });
  }
}
