import { Module } from '@nestjs/common';
import { OrgAccess } from './org-access.service';

@Module({ providers: [OrgAccess], exports: [OrgAccess] })
export class OrganizationsModule {}
