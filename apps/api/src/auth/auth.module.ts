import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { LoginLog } from '../entities/login-log.entity';
import { User } from '../entities/user.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { LoginLogService } from './login-log.service';
import { LoginLogsController } from './login-logs.controller';
import { UsersController } from './users.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, LoginLog]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwtSecret') || 'dev-only-change-me',
        signOptions: { expiresIn: '12h' },
      }),
    }),
  ],
  controllers: [AuthController, UsersController, LoginLogsController],
  providers: [AuthService, LoginLogService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
