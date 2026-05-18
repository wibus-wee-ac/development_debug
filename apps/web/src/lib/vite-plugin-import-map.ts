import type { Plugin, ViteDevServer } from 'vite'

/**
 * Vite plugin that injects an import map into index.html.
 * This allows dynamically-imported plugin modules to resolve bare specifiers
 * like 'react' and 'react-dom' to the host's bundled React instance.
 *
 * In dev mode: serves CJS-to-ESM wrapper modules that re-export named properties
 * from Vite's pre-bundled deps (which only have default exports).
 * In production: points to the stable react-vendor.js chunk.
 */
export function pluginImportMap(): Plugin {
  let devServer: ViteDevServer | undefined

  // Wrapper module templates — expose host's React instance to plugins
  // Uses window.__CRADLE_SHARED__ set in main.tsx to ensure same React instance
  const wrapperModules: Record<string, string> = {
    'react.mjs': `
const __mod = window.__CRADLE_SHARED__['react'];
export default __mod;
export const {
  Children, Component, Fragment, Profiler, PureComponent, StrictMode, Suspense,
  cloneElement, createContext, createElement, createRef, forwardRef,
  isValidElement, lazy, memo, startTransition, use,
  useCallback, useContext, useDebugValue, useDeferredValue, useEffect,
  useId, useImperativeHandle, useInsertionEffect, useLayoutEffect, useMemo,
  useOptimistic, useReducer, useRef, useState, useSyncExternalStore, useTransition,
} = __mod;
`,
    'react-dom.mjs': `
const __mod = window.__CRADLE_SHARED__['react-dom'];
export default __mod;
export const { createPortal, flushSync, unstable_batchedUpdates, version } = __mod;
`,
    'react-jsx-runtime.mjs': `
const __mod = window.__CRADLE_SHARED__['react/jsx-runtime'];
export default __mod;
export const { jsx, jsxs, jsxDEV, Fragment } = __mod;
`,
    'react-dom-client.mjs': `
const __mod = window.__CRADLE_SHARED__['react-dom/client'];
export default __mod;
export const { createRoot, hydrateRoot } = __mod;
`,
  }

  return {
    name: 'cradle-plugin-import-map',

    configureServer(server) {
      devServer = server

      // Serve wrapper modules for plugin bare specifier resolution
      server.middlewares.use((req, res, next) => {
        const prefix = '/__plugin-deps/'
        if (!req.url?.startsWith(prefix)) return next()

        const fileName = req.url.slice(prefix.length)
        const wrapper = wrapperModules[fileName]
        if (!wrapper) return next()

        res.setHeader('Content-Type', 'application/javascript')
        res.setHeader('Cache-Control', 'no-cache')
        res.end(wrapper)
      })
    },

    transformIndexHtml: {
      order: 'pre',
      handler(_html, ctx) {
        if (ctx.server) {
          // Dev mode — point to our wrapper modules
          return [
            {
              tag: 'script',
              attrs: { type: 'importmap' },
              children: JSON.stringify({
                imports: {
                  'react': '/__plugin-deps/react.mjs',
                  'react-dom': '/__plugin-deps/react-dom.mjs',
                  'react/jsx-runtime': '/__plugin-deps/react-jsx-runtime.mjs',
                  'react-dom/client': '/__plugin-deps/react-dom-client.mjs',
                },
              }),
              injectTo: 'head-prepend',
            },
          ]
        }

        // Production — inject import map pointing to stable vendor chunk
        return [
          {
            tag: 'script',
            attrs: { type: 'importmap' },
            children: JSON.stringify({
              imports: {
                'react': '/assets/react-vendor.js',
                'react-dom': '/assets/react-vendor.js',
                'react/jsx-runtime': '/assets/react-vendor.js',
                'react-dom/client': '/assets/react-vendor.js',
              },
            }),
            injectTo: 'head-prepend',
          },
        ]
      },
    },
  }
}
