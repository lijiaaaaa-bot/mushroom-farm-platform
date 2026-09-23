import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser } from '../common/auth-user';
import { ShedScope } from '../common/shed-scope';
import { Shed } from '../entities/shed.entity';

@Injectable()
export class ShedsService {
  constructor(
    @InjectRepository(Shed) private readonly sheds: Repository<Shed>,
  ) {}

  async list(user: AuthUser) {
    const scope = ShedScope.fromUser(user);
    const qb = this.sheds.createQueryBuilder('s').orderBy('s.code', 'ASC');
    if (scope.codes) {
      if (!scope.codes.length) return [];
      qb.andWhere('s.code IN (:...codes)', { codes: scope.codes });
    }
    return qb.getMany();
  }

  async updateLayout(
    user: AuthUser,
    id: string,
    patch: { mapX?: number | null; mapY?: number | null },
  ) {
    const shed = await this.sheds.findOne({ where: { id } });
    if (!shed) throw new NotFoundException('棚区不存在');
    ShedScope.fromUser(user).assert(shed.code);
    if (patch.mapX !== undefined) shed.mapX = patch.mapX;
    if (patch.mapY !== undefined) shed.mapY = patch.mapY;
    return this.sheds.save(shed);
  }
}
