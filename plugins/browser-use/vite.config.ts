import { resolve } from 'node:path'

import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/mcp-server.ts'),
      formats: ['es'],
      fileName: () => 'mcp-server.mjs',
    },
    rollupOptions: {
      external: [
        'net',
        'path',
        'os',
        'fs',
        'crypto',
        'stream',
        'events',
        'util',
        'node:net',
        'node:path',
        'node:os',
        'node:fs',
        'node:crypto',
        'node:stream',
        'node:events',
        'node:util',
        '@modelcontextprotocol/sdk/server/stdio.js',
        '@modelcontextprotocol/sdk/server/index.js',
      ],
    },
    target: 'node20',
    minify: false,
    outDir: 'dist',
  },
})
