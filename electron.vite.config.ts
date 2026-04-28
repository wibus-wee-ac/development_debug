import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import { devtools } from '@tanstack/devtools-vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@cradle/ipc': resolve('packages/ipc/src/index.ts'),
        '@shared': resolve('src/shared'),
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
        '@shared': resolve('src/shared'),
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
        '@main': resolve('src/main'),
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
        '@cradle/ipc/client': resolve('packages/ipc/src/client.ts'),
      },
    },
    plugins: [
      devtools(),
      tailwindcss(),
      viteReact({
        babel: {
          plugins: ['babel-plugin-react-compiler'],
        },
      }),
    ],
  },
})
