import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { globalIgnores } from 'eslint/config';

export default tseslint.config(
  globalIgnores(['dist', 'coverage', 'node_modules', '.claude/worktrees']),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    rules: {
      // Async Fastify handlers often contain no await.
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    files: ['src/server/**/*.ts', 'src/lib/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['src/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    ...reactHooks.configs.flat.recommended,
  },
  {
    files: ['src/web/**/*.tsx'],
    plugins: {
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['src/lib/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['node:*'], message: 'src/lib must not import Node built-ins.' },
          { group: ['react', 'react-*'], message: 'src/lib must not import React.' },
          { group: ['fastify', 'fastify-*'], message: 'src/lib must not import Fastify.' },
          { group: ['**/server/**'], message: 'src/lib must not import src/server.' },
          { group: ['**/web/**'], message: 'src/lib must not import src/web.' },
          { group: ['@/*'], message: 'src/lib must not use the @/ alias.' },
        ],
      }],
    },
  },
  {
    files: ['src/server/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['react', 'react-*'], message: 'src/server must not import React.' },
          { group: ['**/web/**'], message: 'src/server must not import src/web.' },
          { group: ['@/*'], message: 'src/server must not use the @/ alias.' },
        ],
      }],
    },
  },
  {
    files: ['src/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['node:*'], message: 'src/web must not import Node built-ins.' },
          { group: ['fastify', 'fastify-*'], message: 'src/web must not import Fastify.' },
          { group: ['**/server/**'], message: 'src/web must not import src/server.' },
        ],
      }],
    },
  },
);
