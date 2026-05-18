import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Elysia } from 'elysia'
import { createServerPluginContext } from './context'
import { discoverPlugins } from './discovery'
import { createPluginStaticServer } from './static-server'
import { validatePluginModule } from './validation'

// Store deactivation functions for shutdown
const activePlugins = new Map<string, { deactivate?: () => void | Promise<void> }>()

export async function activateServerPlugins(app: Elysia): Promise<void> {
  // Discover from plugins/ relative to workspace root
  // In dev: CRADLE_PLUGINS_DIR env or traverse up from this file. In prod: process.resourcesPath or cwd
  const thisDir = dirname(fileURLToPath(import.meta.url))
  const pluginsDir = process.env.CRADLE_PLUGINS_DIR
    ?? resolve(thisDir, '../../../../plugins')
  const manifests = await discoverPlugins(pluginsDir)

  if (manifests.length === 0) return

  // Activate server plugins
  const serverPlugins = manifests.filter(m => m.cradle.server)
  for (const manifest of serverPlugins) {
    const entryPath = resolve(manifest.packageDir, manifest.cradle.server!)
    try {
      const mod = await import(entryPath)
      validatePluginModule(mod, manifest.name, 'server')

      const shortName = manifest.name.replace(/^@cradle\/plugin-/, '').replace(/^@cradle\//, '')
      const pluginApp = new Elysia({ prefix: `/api/plugins/${shortName}` })

      const ctx = createServerPluginContext(manifest, pluginApp)
      await mod.activate(ctx)
      app.use(pluginApp)

      activePlugins.set(manifest.name, { deactivate: mod.deactivate as (() => void | Promise<void>) | undefined })
      console.log(`[plugins] activated: ${manifest.name}`)
    } catch (err) {
      console.error(`[plugins] failed to activate ${manifest.name}:`, err)
    }
  }

  // Plugin static server — serves web entries + plugin list API
  const staticServer = createPluginStaticServer(manifests)

  const pluginRoutes = new Elysia({ prefix: '/api/plugins' })
    .get('/', () => staticServer.getPluginList())
    .get('/:name/web.mjs', async ({ params, set, headers }) => {
      const entryPath = staticServer.getWebEntry(params.name)
      if (!entryPath) {
        set.status = 404
        return 'Not found'
      }
      let content = await readFile(entryPath, 'utf-8')

      // Rewrite bare React specifiers to absolute URLs on the web host.
      // The web app serves wrapper modules at /__plugin-deps/ that provide
      // named exports from Vite's pre-bundled React.
      const referer = headers['referer'] || headers['origin'] || ''
      let webOrigin = 'http://localhost:5174'
      try {
        if (referer) {
          const url = new URL(referer)
          webOrigin = url.origin
        }
      } catch { /* use default */ }
      const depMap: Record<string, string> = {
        'react/jsx-runtime': `${webOrigin}/__plugin-deps/react-jsx-runtime.mjs`,
        'react-dom/client': `${webOrigin}/__plugin-deps/react-dom-client.mjs`,
        'react': `${webOrigin}/__plugin-deps/react.mjs`,
        'react-dom': `${webOrigin}/__plugin-deps/react-dom.mjs`,
      }
      // Replace `from 'react/jsx-runtime'` etc. — must do longer paths first
      for (const [bare, url] of Object.entries(depMap)) {
        content = content.replaceAll(`from '${bare}'`, `from '${url}'`)
        content = content.replaceAll(`from "${bare}"`, `from "${url}"`)
      }

      return new Response(content, {
        headers: { 'content-type': 'application/javascript; charset=utf-8' },
      })
    })

  app.use(pluginRoutes)
}

export async function deactivateAllPlugins(): Promise<void> {
  for (const [name, plugin] of activePlugins) {
    try {
      await plugin.deactivate?.()
    } catch (err) {
      console.error(`[plugins] error deactivating ${name}:`, err)
    }
  }
  activePlugins.clear()
}
