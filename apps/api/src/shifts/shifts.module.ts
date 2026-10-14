import { Module } from '@nestjs/common';
import { CertificationsModule } from '../certifications/certifications.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';

@Module({
  imports: [CertificationsModule, OrganizationsModule],
  controllers: [ShiftsController],
  providers: [ShiftsService],
  exports: [ShiftsService],
})
export class ShiftsModule {}
