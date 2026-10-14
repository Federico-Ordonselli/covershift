import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { type AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  CreateSwapRequestDto,
  ListSwapRequestsQueryDto,
  SwapRequestDto,
  toSwapRequestDto,
} from './swap-request.dto';
import { SwapRequestsService } from './swap-requests.service';

/**
 * Transitions are POST actions rather than PATCH status: each has its own actor and rules
 * (the transition table in ADR 001), and the URL says which one is being attempted.
 * Every action answers the same way: hidden = 404, visible but not yours = 403,
 * wrong state = 409.
 */
@ApiTags('swap-requests')
@ApiBearerAuth()
@Controller('swap-requests')
export class SwapRequestsController {
  constructor(private readonly swaps: SwapRequestsService) {}

  @Get()
  @ZodResponse({ type: [SwapRequestDto] })
  async list(@Query() query: ListSwapRequestsQueryDto) {
    return (await this.swaps.list(query)).map(toSwapRequestDto);
  }

  @Get(':id')
  @ZodResponse({ type: SwapRequestDto })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return toSwapRequestDto(await this.swaps.get(id));
  }

  /** Offer one of your own shifts: to a coworker (targetUserId) or open to anyone (null). */
  @Post()
  @ZodResponse({ status: 201, type: SwapRequestDto })
  async create(@CurrentUser() user: AuthUser, @Body() body: CreateSwapRequestDto) {
    return toSwapRequestDto(await this.swaps.create(user.id, body));
  }

  /** Direct target accepts, or any other member claims an open offer. */
  @Post(':id/accept')
  @HttpCode(200)
  @ZodResponse({ type: SwapRequestDto })
  async accept(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return toSwapRequestDto(await this.swaps.accept(user.id, id));
  }

  /** Direct target declines. */
  @Post(':id/decline')
  @HttpCode(200)
  @ZodResponse({ type: SwapRequestDto })
  async decline(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return toSwapRequestDto(await this.swaps.decline(user.id, id));
  }

  /** Requester withdraws (pending or accepted). */
  @Post(':id/cancel')
  @HttpCode(200)
  @ZodResponse({ type: SwapRequestDto })
  async cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return toSwapRequestDto(await this.swaps.cancel(user.id, id));
  }

  /** Manager/admin, not a participant: reassigns the shift atomically. */
  @Post(':id/approve')
  @HttpCode(200)
  @ZodResponse({ type: SwapRequestDto })
  async approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return toSwapRequestDto(await this.swaps.approve(user.id, id));
  }

  /** Manager/admin, not a participant. */
  @Post(':id/reject')
  @HttpCode(200)
  @ZodResponse({ type: SwapRequestDto })
  async reject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return toSwapRequestDto(await this.swaps.reject(user.id, id));
  }
}
