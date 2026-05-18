import './langfuse'

import { createServerApp } from './app'
import { loadServerConfig } from './config/server-config'
import { getLogger } from './logging/logger'
import { warmupModelsDevCache } from './modules/providers/model-info-registry'

async function bootstrap() {
  const config = loadServerConfig()
  const logger = getLogger()

  const app = await createServerApp()

  app.listen({
    port: config.port,
    hostname: config.host,
  })

  // Pre-warm models.dev cache so first model list request is fast
  warmupModelsDevCache()

  logger.info(`listening on http://${config.host}:${config.port}`)
}

bootstrap().catch((err) => {
  getLogger().error('fatal bootstrap error', { err })
  process.exit(1)
})
