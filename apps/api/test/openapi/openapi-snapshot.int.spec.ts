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

  it('docs/openapi.json matches the generated document', () => {
    const generated = `${JSON.stringify(buildOpenApiDocument(app), null, 2)}\n`;
    if (process.env.UPDATE_OPENAPI === '1') writeFileSync(SNAPSHOT, generated);
    expect(readFileSync(SNAPSHOT, 'utf8')).toBe(generated);
  });
});
