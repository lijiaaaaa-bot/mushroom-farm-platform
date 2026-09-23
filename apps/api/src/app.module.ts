import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertsModule } from './alerts';
import { AuditModule } from './audit';
import { AuthModule } from './auth';
import configuration from './config/configuration';
import { JwtAuthGuard, RolesGuard, ShedIsolationGuard } from './common/guards';
import { DashboardModule } from './dashboard';
import { DiseasesModule } from './diseases';
import { SnakeNamingStrategy } from './database/naming.strategy';
import { DevicesModule } from './devices';
import { GrowthTrendModule } from './growth';
import { HarvestModule } from './harvest';
import { IngestModule } from './ingest';
import { MaintenanceModule } from './maintenance';
import { MetaModule } from './meta';
import { Phase2Module } from './phase2';
import { RedisModule } from './redis';
import { ReportsModule } from './reports';
import { SeedModule } from './seed';
import { ShedsModule } from './sheds';
import { StorageModule } from './storage';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.get<string>('databaseUrl'),
        autoLoadEntities: true,
        synchronize: config.get<boolean>('typeormSync') === true,
        namingStrategy: new SnakeNamingStrategy(),
      }),
    }),
    ScheduleModule.forRoot(),
    RedisModule,
    StorageModule,
    AuditModule,
    AuthModule,
    ShedsModule,
    DevicesModule,
    IngestModule,
    AlertsModule,
    HarvestModule,
    GrowthTrendModule,
    ReportsModule,
    DashboardModule,
    DiseasesModule,
    MaintenanceModule,
    Phase2Module,
    MetaModule,
    SeedModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ShedIsolationGuard },
  ],
})
export class AppModule {}
