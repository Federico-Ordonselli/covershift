import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { type AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { MeDto, MemberDto, OrganizationSummaryDto, PositionDto } from './organization.dto';
import { OrganizationsService } from './organizations.service';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly orgs: OrganizationsService) {}

  /** Profile plus active memberships and roles: the org switcher's source. */
  @Get()
  @ZodResponse({ type: MeDto })
  async me(@CurrentUser() user: AuthUser) {
    return this.orgs.me(user);
  }
}

/** Unknown or hidden organizations are 404 on every route (indistinguishable). */
@ApiTags('organizations')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  /** Organizations the caller is an active member of, with their role. */
  @Get()
  @ZodResponse({ type: [OrganizationSummaryDto] })
  async mine(@CurrentUser() user: AuthUser) {
    return this.orgs.mine(user.id);
  }

  @Get(':id/positions')
  @ZodResponse({ type: [PositionDto] })
  async positions(@Param('id', ParseUUIDPipe) id: string) {
    return this.orgs.positions(id);
  }

  /** Active members with display names and roles. */
  @Get(':id/members')
  @ZodResponse({ type: [MemberDto] })
  async members(@Param('id', ParseUUIDPipe) id: string) {
    return this.orgs.members(id);
  }
}
