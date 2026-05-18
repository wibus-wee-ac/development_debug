import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import { devtools } from '@tanstack/devtools-vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { pluginImportMap } from './src/lib/vite-plugin-import-map'

export default defineConfig({
  plugins: [
    devtools(),
    tailwindcss(),
    viteReact({
      babel: {
        plugins: ['babel-plugin-react-compiler'],
      },
    }),
    pluginImportMap(),
  ],
  resolve: {
    alias: {
      '~': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5174,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react/jsx-runtime'],
        },
        chunkFileNames(chunkInfo) {
          if (chunkInfo.name === 'react-vendor') return 'assets/react-vendor.js'
          return 'assets/[name]-[hash].js'
        },
      },
    },
  },
})
