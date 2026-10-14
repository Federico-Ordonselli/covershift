import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { ShiftsModule } from '../shifts/shifts.module';
import { SwapRequestsController } from './swap-requests.controller';
import { SwapRequestsService } from './swap-requests.service';

@Module({
  imports: [OrganizationsModule, ShiftsModule],
  controllers: [SwapRequestsController],
  providers: [SwapRequestsService],
})
export class SwapRequestsModule {}
