import { z } from 'zod';

/**
 * zod 4 probes `new Function('')` to JIT-compile object parsers. Under our CSP
 * (script-src 'self', no 'unsafe-eval') the probe throws and zod falls back, but the
 * browser still reports a CSP violation. Jitless mode skips the probe entirely.
 *
 * Must run before any schema is created (zod reads the flag when an object schema is
 * constructed), so main.tsx imports this module first.
 */
z.config({ jitless: true });
