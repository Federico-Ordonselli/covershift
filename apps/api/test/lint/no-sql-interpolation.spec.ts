import { ESLint } from 'eslint';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Proves the lint gate from ADR 001 actually fires (it's a CI check; it must not be vacuous). */
const root = resolve(__dirname, '../../../..');
const eslint = new ESLint({ cwd: root });

async function sqlErrors(code: string, file = 'apps/api/src/example.service.ts'): Promise<number> {
  const [result] = await eslint.lintText(code, { filePath: resolve(root, file) });
  return result!.messages.filter((m) => m.message.startsWith('No interpolation into SQL')).length;
}

describe('lint: no interpolation into SQL', () => {
  it.each([
    [
      'query() with ${}',
      'declare const em: any, id: string;\nem.query(`select * from app.shifts where id = ${id}`);',
    ],
    [
      'query() with +',
      "declare const em: any, id: string;\nem.query('select * from app.shifts where id = ' + id);",
    ],
    [
      'QueryBuilder where() with ${}',
      'declare const qb: any, id: string;\nqb.where(`s.id = ${id}`);',
    ],
    [
      'SQL built in a variable',
      'declare const em: any, id: string;\nconst sql = `delete from app.shifts where id = ${id}`;\nem.query(sql);',
    ],
  ])('flags %s', async (_, code) => {
    expect(await sqlErrors(code)).toBeGreaterThan(0);
  });

  it.each([
    [
      'bind parameters',
      "declare const em: any, id: string;\nem.query('select * from app.shifts where id = $1', [id]);",
    ],
    ['named parameters', "declare const qb: any, id: string;\nqb.where('s.id = :id', { id });"],
    ['non-SQL templates', 'declare const n: number;\nconst msg = `found ${n} shifts`;\nvoid msg;'],
  ])('allows %s', async (_, code) => {
    expect(await sqlErrors(code)).toBe(0);
  });

  it('exempts migrations (DDL identifiers cannot be bound)', async () => {
    const code =
      'declare const q: any, t: string;\nq.query(`alter table app.${t} enable row level security`);';
    expect(await sqlErrors(code, 'apps/api/src/database/migrations/0-x.ts')).toBe(0);
  });
});
