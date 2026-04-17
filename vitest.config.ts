import { resolve } from 'node:path'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@cradle/ipc': resolve('packages/ipc/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/main/**/*.test.ts'],
    mockReset: true,
  },
})
