import {
  WorkerProfileSchema,
  MemberSchema,
  MeSchema,
  OrganizationSummarySchema,
  PositionSchema,
} from '@covershift/shared';
import { createZodDto } from 'nestjs-zod';

export class MeDto extends createZodDto(MeSchema) {}
export class OrganizationSummaryDto extends createZodDto(OrganizationSummarySchema) {}
export class PositionDto extends createZodDto(PositionSchema) {}
export class MemberDto extends createZodDto(MemberSchema) {}

export class WorkerProfileDto extends createZodDto(WorkerProfileSchema) {}
