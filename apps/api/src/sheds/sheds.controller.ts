import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators';
import { ShedScope } from '../common/shed-scope';
import { Shed } from '../entities/shed.entity';

@Controller('sheds')
export class ShedsController {
  constructor(
    @InjectRepository(Shed) private readonly sheds: Repository<Shed>,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const scope = ShedScope.fromUser(user);
    const qb = this.sheds.createQueryBuilder('s').orderBy('s.code', 'ASC');
    if (scope.codes) {
      if (!scope.codes.length) return [];
      qb.andWhere('s.code IN (:...codes)', { codes: scope.codes });
    }
    return qb.getMany();
  }
}
