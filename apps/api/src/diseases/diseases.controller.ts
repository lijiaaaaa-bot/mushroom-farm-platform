import { Controller, Get, Query } from '@nestjs/common';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators';
import { ListQuery } from '../common/pagination';
import { IngestService } from '../ingest';

@Controller('diseases')
export class DiseasesController {
  constructor(private readonly ingest: IngestService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListQuery) {
    return this.ingest.list(user, { ...query, diseased: '1' });
  }
}
