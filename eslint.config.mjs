// @ts-check
import { defineConfig } from 'eslint-config-hyoban'

export default defineConfig(
  {
    lessOpinionated: true,
    react: true,
    tailwindcss: false,
    ignores: [
      '**/components/ui/**',
      '**/routeTree.gen.ts',
      '.agents/**',
      '**/*.md',
    ],
  },
  {
    settings: {
      tailwindcss: {
        whitelist: ['center'],
      },
    },
    rules: {
      'unicorn/prefer-math-trunc': 'off',
      '@eslint-react/no-clone-element': 0,
      '@eslint-react/hooks-extra/no-direct-set-state-in-use-effect': 0,
      'no-restricted-syntax': 0,
      'react-google-translate/no-conditional-text-nodes-with-siblings': 0,
      // Electron: process / Buffer are always available as globals
      'node/prefer-global/process': 'off',
      'node/prefer-global/buffer': 'off',
      'style/indent': 'off',
    },
  },
  {
    files: ['**/*.tsx'],
    rules: {
      '@stylistic/jsx-self-closing-comp': 'error',
    },
  },
  {
    // TanStack Router writes both Route config and component in the same file
    files: ['**/routes/**/*.tsx', '**/routes/**/*.ts'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
)
