import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { type AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { ApiAuthenticatedProblems, ApiProblems } from '../common/api-problems';
import { IdParam } from '../common/id-param';
import { MeDto, MemberDto, OrganizationSummaryDto, PositionDto } from './organization.dto';
import { OrganizationsService } from './organizations.service';

@ApiTags('me')
@ApiBearerAuth()
@ApiAuthenticatedProblems()
@Controller('me')
export class MeController {
  constructor(private readonly orgs: OrganizationsService) {}

  /** Profile plus active memberships and roles: the org switcher's source. */
  @Get()
  @ZodResponse({ status: 200, type: MeDto })
  async me(@CurrentUser() user: AuthUser) {
    return this.orgs.me(user);
  }
}

/** Unknown or hidden organizations are 404 on every route (indistinguishable). */
@ApiTags('organizations')
@ApiBearerAuth()
@ApiAuthenticatedProblems()
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  /** Organizations the caller is an active member of, with their role. */
  @Get()
  @ZodResponse({ status: 200, type: [OrganizationSummaryDto] })
  async mine(@CurrentUser() user: AuthUser) {
    return this.orgs.mine(user.id);
  }

  /** At most LIST_HARD_CAP (500), by name. */
  @Get(':id/positions')
  @ZodResponse({ status: 200, type: [PositionDto] })
  @ApiProblems({ 400: true, 404: true })
  async positions(@IdParam() id: string) {
    return this.orgs.positions(id);
  }

  /** Active members with display names and roles. At most LIST_HARD_CAP (500), by name. */
  @Get(':id/members')
  @ZodResponse({ status: 200, type: [MemberDto] })
  @ApiProblems({ 400: true, 404: true })
  async members(@IdParam() id: string) {
    return this.orgs.members(id);
  }
}
