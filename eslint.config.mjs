// Flat ESLint config (ESLint 9+).
// Extends Expo's recommended config and layers on ADVISORY ("warn") guardrails
// that encode the architectural decisions in docs/V2_ARCHITECTURE_PLAN.md.
//
// These are intentionally warnings, not errors, so the build never breaks while
// the codebase is brought into line. Tightening the worst offenders to "error"
// is a roadmap item (see Track G).
import expoConfig from 'eslint-config-expo/flat.js';

export default [
  ...expoConfig,
  {
    ignores: [
      'dist/*',
      'node_modules/*',
      'vendor/*',
      'convex/_generated/*',
      'formatting.js',
      'babel.config.js',
      'metro.config.js',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // --- Advisory rollout: downgrade Expo's error-level rules to warnings so
      // the build never breaks while the backlog is worked down. Promoting these
      // back to "error" is a roadmap item (Track G).
      // rules-of-hooks is kept at "error" — the repo is clean and these are real
      // correctness bugs (the original 5 conditional-hook violations are fixed).
      'react-hooks/rules-of-hooks': 'error',
      'react/no-unescaped-entities': 'warn',
      'react/display-name': 'warn',
      'import/no-unresolved': 'warn',

      // Telemetry facade: route through src/utils/logger instead of raw console.
      // (~1,000 existing call sites — surfaced as warnings to migrate over time.)
      'no-console': 'warn',

      // Kill the god components (AddProductScreen ~7.4k, ProductDetail ~4.5k, …).
      // Files over this size should be decomposed into feature hooks + thin screens.
      'max-lines': [
        'warn',
        { max: 600, skipBlankLines: true, skipComments: true },
      ],

      // Sockets must go through a single shared client, not ad-hoc io() per hook
      // (today there are 3 separate connections to /collaboration).
      'no-restricted-imports': [
        'warn',
        {
          paths: [
            {
              name: 'socket.io-client',
              message:
                'Do not open sockets ad hoc. Route realtime through a single shared client in src/lib (see V2 plan Track G / Track D).',
            },
          ],
        },
      ],

      // Raw fetch bypasses auth/retry — go through src/lib/apiClient or tRPC.
      'no-restricted-syntax': [
        'warn',
        {
          selector: "CallExpression[callee.name='fetch']",
          message:
            'Avoid raw fetch(); use the typed apiClient (src/lib/apiClient) or tRPC so auth + retries are handled.',
        },
        {
          selector: "CallExpression[callee.object.name='supabase'][callee.property.name='channel']",
          message:
            'Do not open Supabase realtime channels in screens/contexts — subscribe via the Legend State data layer (src/utils/SupaLegend). Ad-hoc channels caused the InventoryLevels retry storm.',
        },
        {
          selector: "CallExpression[callee.object.name='supabase'][callee.property.name='from']",
          message:
            'Do not query Supabase tables directly outside the data layer. Read/write via Legend State observables (src/utils/SupaLegend) or the apiClient.',
        },
      ],
    },
  },
  {
    // The data layer is the sanctioned home for sockets, low-level fetch, and
    // direct Supabase access (the client, SupaLegend observables, activity log).
    files: ['src/lib/**/*.{ts,tsx}', 'src/utils/SupaLegend.ts', 'src/utils/logger.ts'],
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-syntax': 'off',
    },
  },
  {
    // The logger facade is the one sanctioned caller of console.*.
    files: ['src/utils/logger.ts'],
    rules: {
      'no-console': 'off',
    },
  },
];
