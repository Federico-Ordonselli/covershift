import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import { AuthModule } from './auth/auth.module';
import { CertificationsModule } from './certifications/certifications.module';
import { ProblemDetailsFilter } from './common/problem-details.filter';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { ShiftsModule } from './shifts/shifts.module';
import { SwapRequestsModule } from './swap-requests/swap-requests.module';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    DatabaseModule,
    CertificationsModule,
    ShiftsModule,
    SwapRequestsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
