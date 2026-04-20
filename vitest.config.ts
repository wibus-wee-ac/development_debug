// Input: Node path resolver and Vitest config helpers
// Output: Shared Vitest configuration for main-process and renderer unit tests
// Position: Repository-level test runner configuration

import { resolve } from 'node:path'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@cradle/ipc': resolve('packages/ipc/src/index.ts'),
      '@main': resolve('src/main'),
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'src/**/__tests__/**/*.test.ts',
      'src/**/__tests__/**/*.test.tsx',
    ],
    mockReset: true,
  },
})
