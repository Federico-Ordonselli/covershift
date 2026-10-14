import { Module } from '@nestjs/common';
import { OrgAccess } from './org-access.service';
import { MeController, OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  controllers: [MeController, OrganizationsController],
  providers: [OrgAccess, OrganizationsService],
  exports: [OrgAccess],
})
export class OrganizationsModule {}
