import { createServerApp } from './app'
import { loadServerConfig } from './config/server-config'

async function bootstrap() {
  const config = loadServerConfig()

  const app = createServerApp()

  app.listen({
    port: config.port,
    hostname: config.host,
  })

  console.warn(`[cradle-server] listening on http://${config.host}:${config.port}`)
}

bootstrap().catch((err) => {
  console.error('[cradle-server] fatal bootstrap error:', err)
  process.exit(1)
})
