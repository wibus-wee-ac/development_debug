import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import { DevTools } from '@vitejs/devtools'
// import { devtools } from '@tanstack/devtools-vite'
import viteReact from '@vitejs/plugin-react'
import { pluginImportMap } from '@cradle/plugin-sdk/vite-plugin-import-map'
import { defineConfig, type Plugin } from 'vite'

import packageJson from './package.json' with { type: 'json' }

const ASSET_MODULE_RE = /\.(?:avif|gif|ico|jpe?g|png|svg|webp)(?:\?|$)/
const PRECACHE_ASSET_RE = /\.(?:css|js|woff2)$/

function getVendorChunk(id: string): string | undefined {
  if (id.includes('?url') || ASSET_MODULE_RE.test(id)) {
    return undefined
  }

  const marker = '/node_modules/'
  const index = id.lastIndexOf(marker)
  if (index === -1) return undefined

  const path = id.slice(index + marker.length)
  const parts = path.split('/')
  const packageName = path.startsWith('@')
    ? `${parts[0]}/${parts[1]}`
    : parts[0]

  if (packageName === 'react' || packageName === 'react-dom') return 'vendor-react'
  if (packageName?.startsWith('@tanstack/')) return 'vendor-tanstack'
  if (packageName?.startsWith('@tiptap/')) return 'vendor-tiptap'
  if (packageName?.startsWith('@xterm/')) return 'vendor-xterm'
  if (packageName === 'motion') return 'vendor-motion'
  if (packageName === 'lucide-react' || packageName === '@mingcute/react' || packageName === 'react-icons') return 'vendor-icons'
  if (packageName?.startsWith('@base-ui/') || packageName === 'radix-ui' || packageName === 'vaul') return 'vendor-ui'
  if (packageName?.startsWith('@cradle/')) return packageName.replace('@cradle/', 'vendor-cradle-')

  return `vendor-${packageName?.replace('@', '').replace('/', '-')}`
}

function createAssetPrecachePlugin(): Plugin {
  return {
    name: 'cradle-asset-precache',
    apply: 'build',
    generateBundle(_, bundle) {
      const urls = Object.values(bundle)
        .map(item => item.fileName)
        .filter(fileName => fileName.startsWith('assets/') && PRECACHE_ASSET_RE.test(fileName))
        .sort()
        .map(fileName => `/${fileName}`)
      const cacheKey = createHash('sha256').update(urls.join('\n')).digest('hex').slice(0, 12)

      this.emitFile({
        type: 'asset',
        fileName: 'cradle-sw.js',
        source: `const CACHE_NAME = 'cradle-assets-${cacheKey}';
const PRECACHE_URLS = ${JSON.stringify(urls, null, 2)};

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('cradle-assets-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !PRECACHE_URLS.includes(url.pathname)) return;

  event.respondWith(caches.match(request).then(response => response || fetch(request)));
});
`,
      })
    },
  }
}

export default defineConfig({
  define: {
    'import.meta.env.PACKAGE_VERSION': JSON.stringify(packageJson.version),
  },
  devtools: {
    enabled: true,
  },
  plugins: [
    tailwindcss(),
    viteReact({
      babel: {
        plugins: ['babel-plugin-react-compiler'],
      },
    }),
    pluginImportMap(),
    createAssetPrecachePlugin(),
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
    manifest: true,
    target: 'esnext',
    modulePreload: {
      polyfill: false,
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          return getVendorChunk(id)
        },
        chunkFileNames(chunkInfo) {
          if (chunkInfo.name === 'vendor-react') return 'assets/vendor-react.js'
          return 'assets/[name]-[hash].js'
        },
      },
    },
  },
})
