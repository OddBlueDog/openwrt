// @ts-check
import js from '@eslint/js';
import pluginQuery from '@tanstack/eslint-plugin-query';
import pluginRouter from '@tanstack/eslint-plugin-router';
import { defineConfig, globalIgnores } from 'eslint/config';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const SEE = 'See ui/ARCHITECTURE.md.';
const oldHooks = [
  { name: '@/hooks/use-load', message: `Read with a query from the feature's queries.ts (settingsQuery). ${SEE}` },
  { name: '@/hooks/use-poll', message: `Read with a live query from the feature's queries.ts (liveQuery + useLive). ${SEE}` },
  { name: '@/lib/shared-call', message: `Two readers of one query key share its call already. ${SEE}` },
];
const ubusInComponents = {
  name: '@/lib/ubus',
  importNames: ['call', 'exec', 'callAnonymous'],
  message: `Components read through queries and write through mutation hooks (queries.ts), which call api.ts. ${SEE}`,
};
const queryKeyOutsideQueries = {
  selector: "Property[key.name='queryKey']",
  message: `Query keys are written only in queries.ts (and src/lib/query): pass a factory's result. ${SEE}`,
};
const formStateInComponents = {
  selector:
    "MemberExpression[property.name='state'][object.name='form'], MemberExpression[property.name='state'][object.property.name='form']",
  message: `form.state doesn't re-render: subscribe with form.Subscribe, useSelector(form.store, …) or useFormValues(form). ${SEE}`,
};
// Everywhere in src/: moving between pages is the router's (<Link>, useNavigate)
const routerSyntax = [
  {
    selector: "AssignmentExpression > MemberExpression.left[property.name='hash'][object.property.name='location']",
    message: `Move with <Link {...pageLink(…)}> or useNavigate(), not by setting the hash. ${SEE}`,
  },
  {
    selector: "AssignmentExpression > MemberExpression.left[property.name='hash'][object.name='location']",
    message: `Move with <Link {...pageLink(…)}> or useNavigate(), not by setting the hash. ${SEE}`,
  },
  {
    selector: "CallExpression[callee.property.name='addEventListener'][arguments.0.value='hashchange']",
    message: `Read the address with useRoute() / useSubPath(), not a hashchange listener. ${SEE}`,
  },
];

// The one pattern for router data, forms and routes (ARCHITECTURE.md), held everywhere in src/.
const boundaries = [
  {
    files: ['src/**/*.ts'],
    ignores: ['**/queries.ts', 'src/lib/query/**', 'src/lib/router.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: oldHooks }],
      'no-restricted-syntax': ['error', queryKeyOutsideQueries, ...routerSyntax],
    },
  },
  {
    files: ['src/**/queries.ts', 'src/lib/query/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { paths: oldHooks }] },
  },
  {
    files: ['src/**/*.tsx'],
    rules: {
      'no-restricted-imports': ['error', { paths: [...oldHooks, ubusInComponents] }],
      'no-restricted-syntax': ['error', queryKeyOutsideQueries, formStateInComponents, ...routerSyntax],
    },
  },
];

// Strict on purpose: type-checked rules, zero warnings (pnpm lint), and no
// escape hatches without a reason.
export default defineConfig([
  globalIgnores(['dist', 'node_modules']),
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
      reportUnusedInlineConfigs: 'error',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        { allowString: false, allowNumber: false, allowNullableObject: true },
      ],
      eqeqeq: 'error',
      'no-console': ['error', { allow: ['error'] }],
    },
  },
  // Browser code: React, hooks and accessibility rules.
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      reactHooks.configs.flat['recommended-latest'],
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.strict,
      pluginQuery.configs['flat/recommended'],
      pluginRouter.configs['flat/recommended'],
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  // Node code: the Vite config, the packaging scripts and the tests.
  {
    files: ['vite.config.ts', 'vitest.config.ts', 'scripts/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'no-console': 'off',
    },
  },
  // node:test runs every test() it's given: their promises are its to await.
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': [
        'error',
        { allowForKnownSafeCalls: [{ from: 'package', name: 'test', package: 'node:test' }] },
      ],
    },
  },
  // The browser tests run in Chromium (vitest.config.ts): the page's globals.
  {
    files: ['tests/browser/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
  },
  ...boundaries,
  // This config file itself is plain JavaScript outside the TypeScript projects.
  {
    files: ['**/*.js'],
    extends: [js.configs.recommended, tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: globals.node,
    },
  },
]);
