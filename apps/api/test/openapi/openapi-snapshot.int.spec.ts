import { type INestApplication } from '@nestjs/common';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../../src/openapi';
import { createE2eApp } from '../helpers/app';

const SNAPSHOT = resolve(__dirname, '../../../../docs/openapi.json');

/**
 * docs/openapi.json is the committed, reviewable API contract (the frontend reads it).
 * It must match what the app generates; refresh it with `pnpm --filter @covershift/api
 * openapi:update` and review the diff like any other contract change.
 */
describe('OpenAPI snapshot', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createE2eApp());
  });

  afterAll(async () => {
    await app?.close();
  });

  it('every operation documents explicit success and problem+json error responses', () => {
    const doc = buildOpenApiDocument(app);
    const problems: string[] = [];
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(item as Record<string, { responses?: object }>)) {
        const responses = (op.responses ?? {}) as Record<string, { content?: object }>;
        const where = `${method.toUpperCase()} ${path}`;
        if ('default' in responses) problems.push(`${where}: generic "default" response`);
        if (!Object.keys(responses).some((s) => s.startsWith('2'))) {
          problems.push(`${where}: no explicit 2xx response`);
        }
        if (path !== '/health') {
          for (const required of ['401', '500']) {
            if (!(required in responses)) problems.push(`${where}: missing ${required}`);
          }
        }
        for (const [status, response] of Object.entries(responses)) {
          if (Number(status) >= 400 && !('application/problem+json' in (response.content ?? {}))) {
            problems.push(`${where}: ${status} is not application/problem+json`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('docs/openapi.json matches the generated document', () => {
    const generated = `${JSON.stringify(buildOpenApiDocument(app), null, 2)}\n`;
    if (process.env.UPDATE_OPENAPI === '1') writeFileSync(SNAPSHOT, generated);
    expect(readFileSync(SNAPSHOT, 'utf8')).toBe(generated);
  });
});
