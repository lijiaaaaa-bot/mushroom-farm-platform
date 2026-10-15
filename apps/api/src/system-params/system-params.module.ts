import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemParam } from '../entities/system-param.entity';
import { SystemParamsController } from './system-params.controller';
import { SystemParamsService } from './system-params.service';

@Module({
  imports: [TypeOrmModule.forFeature([SystemParam])],
  controllers: [SystemParamsController],
  providers: [SystemParamsService],
  exports: [SystemParamsService],
})
export class SystemParamsModule {}
