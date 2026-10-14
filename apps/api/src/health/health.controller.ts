import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  /** Liveness for the load balancer. Deliberately does not touch the database. */
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
