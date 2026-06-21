import { resolve } from 'node:path'

import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: {
        server: resolve(__dirname, 'src/server.ts'),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.mjs`,
    },
    rollupOptions: {
      external: [
        /^node:/,
        '@cradle/plugin-sdk/server',
        // @slack/bolt is CJS; bundling it forces rolldown to emit `__require("node:...")`
        // calls inside a CJS wrapper, which throw in our pure-ESM runtime. Letting Node's
        // native CJS↔ESM interop load it avoids the `Calling require for ...` error.
        '@slack/bolt',
        '@slack/bolt/dist/App',
        '@slack/bolt/dist/index',
      ],
    },
    target: 'node20',
    minify: false,
    outDir: 'dist',
  },
})
