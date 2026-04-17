import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@cradle/ipc': resolve('packages/ipc/src/index.ts'),
      },
    },
    build: {
      externalizeDeps: {
        exclude: ['@cradle/ipc', 'electron-store'],
      },
      rollupOptions: {
        external: ['better-sqlite3'],
      },
    },
  },
  preload: {
    resolve: {
      alias: {
        '@cradle/ipc': resolve('packages/ipc/src/index.ts'),
      },
    },
    build: {
      externalizeDeps: {
        exclude: ['@cradle/ipc', 'electron-store'],
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@cradle/ipc/client': resolve('packages/ipc/src/client.ts'),
      },
    },
    plugins: [
      devtools(),
      tailwindcss(),
      tanstackRouter({ target: 'react', autoCodeSplitting: true }),
      viteReact(),
    ],
  },
})
