import 'reflect-metadata'

import { serve } from '@hono/node-server'

import { createConfiguredApp } from './app.factory'
import { loadServerConfig } from './config/server-config'

async function bootstrap() {
  const config = loadServerConfig()

  const app = await createConfiguredApp()
  const hono = app.getInstance()

  serve({
    fetch: hono.fetch,
    port: config.port,
    hostname: config.host,
  })

  console.log(`[cradle-server] listening on http://${config.host}:${config.port}`)
}

bootstrap().catch((err) => {
  console.error('[cradle-server] fatal bootstrap error:', err)
  process.exit(1)
})
