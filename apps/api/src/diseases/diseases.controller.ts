import { Controller, Get, Param, Query } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators';
import { ListQuery } from '../common/pagination';
import { IngestService } from '../ingest';

class DiseaseEnvironmentQuery {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24 * 60)
  beforeMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24 * 60)
  afterMinutes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sensorCode?: string;
}

@Controller('diseases')
export class DiseasesController {
  constructor(private readonly ingest: IngestService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListQuery) {
    return this.ingest.list(user, { ...query, diseased: '1' });
  }

  @Get(':id/environment')
  environment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: DiseaseEnvironmentQuery,
  ) {
    return this.ingest.diseaseEnvironment(user, id, query);
  }
}
