import { resolve } from 'node:path'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@cradle/ipc': resolve('packages/ipc/src/index.ts'),
      '@main': resolve('src/main'),
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/main/**/*.test.ts', 'src/main/**/__tests__/**/*.test.ts'],
    mockReset: true
  }
})
