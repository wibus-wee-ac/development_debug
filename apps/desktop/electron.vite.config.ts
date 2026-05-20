import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const __dirname = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(__dirname, '../web')
const desktopUpdateUrl = process.env.CRADLE_DESKTOP_UPDATE_URL ?? ''

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({
      exclude: ['get-port', '@cradle/ipc', '@cradle/browser-use'],
    })],
    define: {
      __CRADLE_DESKTOP_UPDATE_URL__: JSON.stringify(desktopUpdateUrl),
    },
    build: {
      outDir: resolve(__dirname, 'dist/main'),
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: resolve(__dirname, 'dist/preload'),
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
        },
      },
    },
  },
  renderer: {
    root: webRoot,
    plugins: [
      tailwindcss(),
      viteReact({
        babel: {
          plugins: ['babel-plugin-react-compiler'],
        },
      }),
    ],
    resolve: {
      alias: {
        '~': resolve(webRoot, 'src'),
      },
    },
    build: {
      outDir: resolve(__dirname, 'dist/renderer'),
      rollupOptions: {
        input: resolve(webRoot, 'index.html'),
      },
    },
  },
})
