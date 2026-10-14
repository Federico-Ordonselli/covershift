import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import {
  CreateShiftDto,
  ListShiftsQueryDto,
  ShiftDto,
  ShiftPageDto,
  toShiftDto,
  UpdateShiftDto,
} from './shift.dto';
import { ShiftsService } from './shifts.service';

@ApiTags('shifts')
@ApiBearerAuth()
@Controller('shifts')
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  /** Shifts in the caller's organizations (RLS-scoped), optionally filtered, by start time. */
  @Get()
  @ZodResponse({ type: ShiftPageDto })
  async list(@Query() query: ListShiftsQueryDto) {
    const page = await this.shifts.list(query);
    return { items: page.items.map(toShiftDto), nextCursor: page.nextCursor };
  }

  @Get(':id')
  @ZodResponse({ type: ShiftDto })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return toShiftDto(await this.shifts.get(id));
  }

  /** Managers/admins only. An assignee must be an active, certified, non-overlapping member. */
  @Post()
  @ZodResponse({ status: 201, type: ShiftDto })
  async create(@Body() body: CreateShiftDto) {
    return toShiftDto(await this.shifts.create(body));
  }

  /** Managers/admins only. Changing assignee, position or times re-validates the assignment. */
  @Patch(':id')
  @ZodResponse({ type: ShiftDto })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateShiftDto) {
    return toShiftDto(await this.shifts.update(id, body));
  }

  /** Managers/admins only. Refused (409) once the shift has swap-request history. */
  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.shifts.remove(id);
  }
}
