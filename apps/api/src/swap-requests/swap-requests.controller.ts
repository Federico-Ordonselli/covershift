import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { type AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { ApiAuthenticatedProblems, ApiProblems } from '../common/api-problems';
import { IdParam } from '../common/id-param';
import {
  CreateSwapRequestDto,
  ListSwapRequestsQueryDto,
  SwapRequestDto,
  SwapRequestPageDto,
  toSwapRequestDto,
} from './swap-request.dto';
import { SwapRequestsService } from './swap-requests.service';

const NOT_YOURS = 'SWAP_NOT_ALLOWED: visible, but not your action';
const TRANSITION_409 = 'SWAP_INVALID_TRANSITION (wrong state), SHIFT_ALREADY_STARTED';
const ELIGIBILITY_422 = 'CERTIFICATION_MISSING, CERTIFICATION_EXPIRES_BEFORE_SHIFT_END';

/**
 * Transitions are POST actions rather than PATCH status: each has its own actor and rules
 * (the transition table in ADR 001), and the URL says which one is being attempted.
 * Every action answers the same way: hidden = 404, visible but not yours = 403,
 * wrong state = 409.
 */
@ApiTags('swap-requests')
@ApiBearerAuth()
@ApiAuthenticatedProblems()
@Controller('swap-requests')
export class SwapRequestsController {
  constructor(private readonly swaps: SwapRequestsService) {}

  /** Newest first. Visible to members of the request's organization (RLS-scoped). */
  @Get()
  @ZodResponse({ status: 200, type: SwapRequestPageDto })
  @ApiProblems({ 400: true })
  async list(@Query() query: ListSwapRequestsQueryDto) {
    const page = await this.swaps.list(query);
    return { items: page.items.map(toSwapRequestDto), nextCursor: page.nextCursor };
  }

  @Get(':id')
  @ZodResponse({ status: 200, type: SwapRequestDto })
  @ApiProblems({ 400: true, 404: true })
  async get(@IdParam() id: string) {
    return toSwapRequestDto(await this.swaps.get(id));
  }

  /** Offer one of your own shifts: to a coworker (targetUserId) or open to anyone (null). */
  @Post()
  @ZodResponse({ status: 201, type: SwapRequestDto })
  @ApiProblems({
    400: true,
    403: 'SWAP_NOT_ALLOWED: the shift is not assigned to you',
    404: 'NOT_FOUND: the shift does not exist or is not visible',
    409: 'SWAP_ALREADY_ACTIVE, SHIFT_ALREADY_STARTED',
    413: true,
    422: 'NOT_A_MEMBER (target), SWAP_NOT_ALLOWED (offer to yourself)',
  })
  async create(@CurrentUser() user: AuthUser, @Body() body: CreateSwapRequestDto) {
    return toSwapRequestDto(await this.swaps.create(user.id, body));
  }

  /** Direct target accepts, or any other member claims an open offer. */
  @Post(':id/accept')
  @HttpCode(200)
  @ZodResponse({ status: 200, type: SwapRequestDto })
  @ApiProblems({
    400: true,
    403: NOT_YOURS,
    404: true,
    409: `${TRANSITION_409}, SWAP_CONFLICT (already claimed), SHIFT_OVERLAP`,
    422: ELIGIBILITY_422,
  })
  async accept(@CurrentUser() user: AuthUser, @IdParam() id: string) {
    return toSwapRequestDto(await this.swaps.accept(user.id, id));
  }

  /** Direct target declines. */
  @Post(':id/decline')
  @HttpCode(200)
  @ZodResponse({ status: 200, type: SwapRequestDto })
  @ApiProblems({ 400: true, 403: NOT_YOURS, 404: true, 409: TRANSITION_409 })
  async decline(@CurrentUser() user: AuthUser, @IdParam() id: string) {
    return toSwapRequestDto(await this.swaps.decline(user.id, id));
  }

  /** Requester withdraws (pending or accepted). */
  @Post(':id/cancel')
  @HttpCode(200)
  @ZodResponse({ status: 200, type: SwapRequestDto })
  @ApiProblems({ 400: true, 403: NOT_YOURS, 404: true, 409: TRANSITION_409 })
  async cancel(@CurrentUser() user: AuthUser, @IdParam() id: string) {
    return toSwapRequestDto(await this.swaps.cancel(user.id, id));
  }

  /** Manager/admin, not a participant: reassigns the shift atomically. */
  @Post(':id/approve')
  @HttpCode(200)
  @ZodResponse({ status: 200, type: SwapRequestDto })
  @ApiProblems({
    400: true,
    403: NOT_YOURS,
    404: true,
    409: `${TRANSITION_409}, SWAP_CONFLICT (shift reassigned meanwhile), SHIFT_OVERLAP`,
    422: ELIGIBILITY_422,
  })
  async approve(@CurrentUser() user: AuthUser, @IdParam() id: string) {
    return toSwapRequestDto(await this.swaps.approve(user.id, id));
  }

  /** Manager/admin, not a participant. */
  @Post(':id/reject')
  @HttpCode(200)
  @ZodResponse({ status: 200, type: SwapRequestDto })
  @ApiProblems({ 400: true, 403: NOT_YOURS, 404: true, 409: TRANSITION_409 })
  async reject(@CurrentUser() user: AuthUser, @IdParam() id: string) {
    return toSwapRequestDto(await this.swaps.reject(user.id, id));
  }
}
