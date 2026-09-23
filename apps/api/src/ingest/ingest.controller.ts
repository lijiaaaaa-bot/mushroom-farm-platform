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
import { AuthUser } from '../common/auth-user';
import { CurrentUser, Public } from '../common/decorators';
import { IngestTokenGuard } from '../common/guards';
import { ListQuery } from '../common/pagination';
import { IngestService } from './ingest.service';

@Controller('ingest')
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

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
