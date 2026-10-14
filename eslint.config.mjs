// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

// Methods that take raw SQL: EntityManager/QueryRunner/pg query(), and QueryBuilder clauses.
const SQL_METHODS =
  '/^(query|where|andWhere|orWhere|having|andHaving|orHaving|select|addSelect|orderBy|addOrderBy|groupBy|addGroupBy|innerJoin|leftJoin|innerJoinAndSelect|leftJoinAndSelect|innerJoinAndMapOne|leftJoinAndMapOne|returning)$/';
const SQL_MESSAGE =
  'No interpolation into SQL: pass values as bind parameters ($1 / :name). See ADR 001.';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', 'supabase/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    // Nest DI reads constructor param types from emitted metadata. Without these
    // options, consistent-type-imports would rewrite injected classes into
    // type-only imports and break injection at runtime.
    files: ['apps/api/**/*.ts'],
    languageOptions: {
      parserOptions: { emitDecoratorMetadata: true, experimentalDecorators: true },
    },
  },
  {
    // No string-built SQL (ADR 001, accepted risk: request.jwt.claims is settable from inside
    // the session, so SQL injection would mean impersonation within RLS). Values go in bind
    // parameters ($1 / :name), never into the SQL text.
    files: ['apps/api/**/*.ts'],
    // Migrations interpolate DDL identifiers from literal arrays; identifiers can't be bound.
    ignores: ['apps/api/src/database/migrations/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: `CallExpression[callee.property.name=${SQL_METHODS}] > TemplateLiteral[expressions.length>0]`,
          message: SQL_MESSAGE,
        },
        {
          selector: `CallExpression[callee.property.name=${SQL_METHODS}] > BinaryExpression[operator='+']`,
          message: SQL_MESSAGE,
        },
        {
          // SQL assembled in a variable first, then passed along
          selector:
            'TemplateLiteral[expressions.length>0][quasis.0.value.raw=/^\\s*(select|insert|update|delete|with)\\b/i]',
          message: SQL_MESSAGE,
        },
      ],
    },
  },
);
