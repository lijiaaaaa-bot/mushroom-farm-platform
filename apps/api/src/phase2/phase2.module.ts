import { Module } from '@nestjs/common';
import { Phase2Controller } from './phase2.controller';

@Module({ controllers: [Phase2Controller] })
export class Phase2Module {}
