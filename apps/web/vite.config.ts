import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { securityHeaders } from './security-headers.ts';

/**
 * The app calls its API same-origin under /api; Vite proxies that to NestJS (in dev and in
 * preview), so the API needs no CORS policy. Phase 4 hosting routes /api the same way.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000';
  const supabaseUrl = env.VITE_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error('VITE_SUPABASE_URL is not set: run `pnpm db:env` to write apps/web/.env.local');
  }
  const proxy = {
    '/api': {
      target: apiTarget,
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/api/, ''),
    },
  };
  return {
    plugins: [react()],
    server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
    // Preview serves the production build under the real CSP: Playwright runs here.
    preview: {
      host: '127.0.0.1',
      port: 4173,
      strictPort: true,
      proxy,
      headers: securityHeaders(supabaseUrl),
    },
    build: { sourcemap: true },
  };
});
