import { resolve } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '~': resolve(__dirname, '../../apps/web/src'),
    },
  },
  build: {
    lib: {
      entry: {
        web: resolve(__dirname, 'src/web.tsx'),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.mjs`,
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    },
    target: 'esnext',
    minify: false,
    outDir: 'dist',
  },
})
