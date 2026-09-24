import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { FLUSH_PHASES } from '../entities/flush-batch.entity';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, Roles } from '../common/decorators';
import { BatchService } from './batch.service';

class CreateBatchDto {
  @IsString()
  shedCode: string;

  @IsString()
  batchCode: string;

  @IsOptional()
  @IsString()
  startedAt?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

class RecordPhaseDto {
  @IsIn(FLUSH_PHASES)
  phase: string;

  @IsOptional()
  @IsString()
  occurredAt?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

class CloseBatchDto {
  @IsOptional()
  @IsString()
  closedAt?: string;
}

@Controller('batches')
export class BatchController {
  constructor(private readonly batches: BatchService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('shedCode') shedCode?: string) {
    return this.batches.list(user, shedCode);
  }

  @Post()
  @Roles('super_admin', 'production_admin', 'shed_manager')
  create(@CurrentUser() user: AuthUser, @Body() body: CreateBatchDto) {
    return this.batches.create(user, body);
  }

  @Get(':id/replay')
  replay(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.batches.replay(user, id);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.batches.get(user, id);
  }

  @Post(':id/phases')
  @Roles('super_admin', 'production_admin', 'shed_manager')
  recordPhase(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: RecordPhaseDto,
  ) {
    return this.batches.recordPhase(user, id, body);
  }

  @Post(':id/close')
  @Roles('super_admin', 'production_admin', 'shed_manager')
  close(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: CloseBatchDto,
  ) {
    return this.batches.close(user, id, body.closedAt);
  }
}
