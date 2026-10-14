import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// esbuild (Vitest's default transform) cannot emit decorator metadata, which Nest DI
// and TypeORM rely on. SWC can, so it replaces esbuild for TS files.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    root: './',
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.spec.ts'] },
      },
    ],
  },
});
