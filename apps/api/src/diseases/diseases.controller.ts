import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators';
import { ListQuery } from '../common/pagination';
import { GrowthTrendService } from '../growth';
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
  constructor(
    private readonly ingest: IngestService,
    private readonly trends: GrowthTrendService,
  ) {}

  @Get('peaks')
  peaks(
    @CurrentUser() user: AuthUser,
    @Query('grain') grain?: string,
    @Query('shedCode') shedCode?: string,
  ) {
    return this.trends.diseasePeaks(user, { grain, shedCode });
  }

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
