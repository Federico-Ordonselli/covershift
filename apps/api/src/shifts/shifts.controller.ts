import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ApiAuthenticatedProblems, ApiProblems } from '../common/api-problems';
import { IdParam } from '../common/id-param';
import {
  CreateShiftDto,
  ListShiftsQueryDto,
  ShiftDto,
  ShiftPageDto,
  toShiftDto,
  UpdateShiftDto,
} from './shift.dto';
import { ShiftsService } from './shifts.service';

const ASSIGNMENT_422 =
  'NOT_A_MEMBER, CERTIFICATION_MISSING, CERTIFICATION_EXPIRES_BEFORE_SHIFT_END, INVALID_REFERENCE';

@ApiTags('shifts')
@ApiBearerAuth()
@ApiAuthenticatedProblems()
@Controller('shifts')
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  /** Shifts in the caller's organizations (RLS-scoped), optionally filtered, by start time. */
  @Get()
  @ZodResponse({ status: 200, type: ShiftPageDto })
  @ApiProblems({ 400: true })
  async list(@Query() query: ListShiftsQueryDto) {
    const page = await this.shifts.list(query);
    return { items: page.items.map(toShiftDto), nextCursor: page.nextCursor };
  }

  @Get(':id')
  @ZodResponse({ status: 200, type: ShiftDto })
  @ApiProblems({ 400: true, 404: true })
  async get(@IdParam() id: string) {
    return toShiftDto(await this.shifts.get(id));
  }

  /** Managers/admins only. An assignee must be an active, certified, non-overlapping member. */
  @Post()
  @ZodResponse({ status: 201, type: ShiftDto })
  @ApiProblems({
    400: true,
    403: 'FORBIDDEN: not a manager or admin of the organization',
    409: 'SHIFT_OVERLAP',
    413: true,
    422: ASSIGNMENT_422,
  })
  async create(@Body() body: CreateShiftDto) {
    return toShiftDto(await this.shifts.create(body));
  }

  /** Managers/admins only. Changing assignee, position or times re-validates the assignment. */
  @Patch(':id')
  @ZodResponse({ status: 200, type: ShiftDto })
  @ApiProblems({
    400: true,
    403: 'FORBIDDEN: not a manager or admin of the organization',
    404: true,
    409: 'SHIFT_OVERLAP',
    413: true,
    422: `${ASSIGNMENT_422}, CONSTRAINT_VIOLATION`,
  })
  async update(@IdParam() id: string, @Body() body: UpdateShiftDto) {
    return toShiftDto(await this.shifts.update(id, body));
  }

  /** Managers/admins only. Refused (409) once the shift has swap-request history. */
  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiProblems({
    400: true,
    403: 'FORBIDDEN: not a manager or admin of the organization',
    404: true,
    409: 'CONFLICT: the shift has swap-request history',
  })
  async remove(@IdParam() id: string): Promise<void> {
    await this.shifts.remove(id);
  }
}
