import type { Plugin } from 'vite'

// Valid JS identifier — filters out keys like 'module.exports'
const RE_VALID_IDENT = /^[a-z_$]\w*$/i

/**
 * Vite plugin that injects es-module-shims + import map for plugin bare specifier
 * resolution. This allows dynamically-imported plugin modules to resolve
 * `import { useState } from 'react'` to the host's shared React instance.
 *
 * How it works:
 * 1. es-module-shims polyfill ensures import maps work regardless of script order
 * 2. Import map maps `react` → `/__plugin-deps/react.mjs` (dev) or `/assets/react-vendor.js` (prod)
 * 3. Wrapper modules read from `window[Symbol.for('cradle:modules')]` (set in main.tsx) to re-export named members
 * 4. Result: plugins share the exact same React instance as the host app
 */
export function pluginImportMap(): Plugin {
  // Wrapper modules are generated dynamically at server start
  // by reading Object.keys() from the actual installed packages.
  // This ensures we never miss new exports when React updates.
  const KEY = `Symbol.for('cradle:modules')`
  const wrapperModules: Record<string, string> = {}

  // Map of specifier → npm package name for dynamic export discovery
  const sharedPackages: Record<string, string> = {
    'react.mjs': 'react',
    'react-dom.mjs': 'react-dom',
    'react-jsx-runtime.mjs': 'react/jsx-runtime',
    'react-dom-client.mjs': 'react-dom/client',
  }

  // Specifier → global registry key
  const registryKeys: Record<string, string> = {
    'react.mjs': 'react',
    'react-dom.mjs': 'react-dom',
    'react-jsx-runtime.mjs': 'react/jsx-runtime',
    'react-dom-client.mjs': 'react-dom/client',
  }

  function buildWrapper(exports: string[], registryKey: string): string {
    const named = exports.filter(k =>
      k !== 'default' && k !== '__esModule' && !k.startsWith('__') && RE_VALID_IDENT.test(k))
    let code = `const __mod = window[${KEY}]['${registryKey}'];\nexport default __mod;\n`
    if (named.length > 0) {
      code += `export const { ${named.join(', ')} } = __mod;\n`
    }
    return code
  }

  return {
    name: 'cradle-plugin-import-map',

    async configureServer(server) {
      // Dynamically discover exports from installed packages
      for (const [fileName, pkg] of Object.entries(sharedPackages)) {
        try {
          const mod = await import(pkg)
          const exports = Object.keys(mod)
          wrapperModules[fileName] = buildWrapper(exports, registryKeys[fileName])
        }
        catch {
          // Fallback: serve an empty re-export
          wrapperModules[fileName] = `const __mod = window[${KEY}]['${registryKeys[fileName]}'];\nexport default __mod;\n`
        }
      }

      // Serve wrapper modules for plugin bare specifier resolution
      server.middlewares.use((req, res, next) => {
        const prefix = '/__plugin-deps/'
        if (!req.url?.startsWith(prefix)) {
          return next()
        }

        const fileName = req.url.slice(prefix.length)
        const wrapper = wrapperModules[fileName]
        if (!wrapper) {
          return next()
        }

        res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Cache-Control', 'no-cache')
        res.end(wrapper)
      })
    },

    transformIndexHtml: {
      order: 'pre',
      handler(_html, ctx) {
        if (ctx.server) {
          // Dev mode — es-module-shims polyfill + import map pointing to wrappers
          return [
            {
              tag: 'script',
              attrs: {
                async: true,
                src: '/node_modules/es-module-shims/dist/es-module-shims.js',
              },
              injectTo: 'head-prepend',
            },
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

        // Production — import map pointing to stable vendor chunk
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
