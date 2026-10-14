import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'covershift:isPublic';

/** Opt a route out of authentication. Everything is authenticated by default. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);
