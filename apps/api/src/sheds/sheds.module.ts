import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Shed } from '../entities/shed.entity';
import { ShedsController } from './sheds.controller';
import { ShedsService } from './sheds.service';

@Module({
  imports: [TypeOrmModule.forFeature([Shed])],
  controllers: [ShedsController],
  providers: [ShedsService],
})
export class ShedsModule {}
