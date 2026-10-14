import { Module } from '@nestjs/common';
import { CertificationEligibilityService } from './certification-eligibility.service';

@Module({
  providers: [CertificationEligibilityService],
  exports: [CertificationEligibilityService],
})
export class CertificationsModule {}
