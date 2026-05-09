import { builtinModules } from 'node:module'
import { resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import swc from 'unplugin-swc'
import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

const __dirname = dirname(fileURLToPath(import.meta.url))

const NODE_BUILT_IN_MODULES = builtinModules.filter(m => !m.startsWith('_'))
NODE_BUILT_IN_MODULES.push(...NODE_BUILT_IN_MODULES.map(m => `node:${m}`))
const SERVER_EXTERNALS = new Set([
  ...NODE_BUILT_IN_MODULES,
  '@node-rs/jieba',
  '@node-rs/jieba/dict',
])

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    swc.vite(),
  ],
  esbuild: false,
  ssr: {
    noExternal: true,
    external: ['@node-rs/jieba', '@node-rs/jieba/dict'],
  },
  build: {
    ssr: true,
    rollupOptions: {
      external: (id) => {
        return SERVER_EXTERNALS.has(id) || id.startsWith('@node-rs/jieba-')
      },
      input: {
        main: resolve(__dirname, 'src/index.ts'),
      },
    },
  },
})
