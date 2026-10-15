import { Controller, Get, Post } from '@nestjs/common';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, Roles } from '../common/decorators';
import { BackupService } from './backup.service';

@Controller('backups')
export class BackupController {
  constructor(private readonly backups: BackupService) {}

  @Get('status')
  @Roles('super_admin')
  status() {
    return this.backups.status();
  }

  @Post('run')
  @Roles('super_admin')
  run(@CurrentUser() actor: AuthUser) {
    return this.backups.run(actor);
  }
}
