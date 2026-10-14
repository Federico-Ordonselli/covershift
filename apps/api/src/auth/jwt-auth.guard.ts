import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { type AuthenticatedRequest } from './current-user.decorator';
import { IS_PUBLIC } from './public.decorator';
import { InvalidTokenError, SupabaseJwtVerifier } from './supabase-jwt.verifier';

/** Global guard: every route requires a valid Supabase access token unless @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly verifier: SupabaseJwtVerifier,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const token = bearerToken(req);
    if (!token) throw new UnauthorizedException('missing bearer token');

    try {
      (req as AuthenticatedRequest).user = await this.verifier.verify(token);
    } catch (err) {
      if (err instanceof InvalidTokenError) throw new UnauthorizedException(err.message);
      throw err;
    }
    return true;
  }
}

function bearerToken(req: Request): string | undefined {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}
