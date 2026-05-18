import './langfuse'

import { createServerApp } from './app'
import { loadServerConfig } from './config/server-config'
import { getLogger } from './logging/logger'
import { warmupModelsDevCache } from './modules/providers/model-info-registry'

async function bootstrap() {
  const config = loadServerConfig()
  const logger = getLogger()

  const app = await createServerApp()

  const server = app.listen({
    port: config.port,
    hostname: config.host,
    reusePort: true,
  })

  // Pre-warm models.dev cache so first model list request is fast
  warmupModelsDevCache()

  logger.info(`listening on http://${config.host}:${config.port}`)

  const gracefulShutdown = async (signal: string) => {
    logger.info(`received ${signal}, shutting down gracefully...`)
    try {
      await app.stop()
      logger.info('graceful shutdown complete')
    } catch (err) {
      logger.error('error during graceful shutdown', { err })
    } finally {
      process.exit(0)
    }
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
  process.on('SIGINT', () => gracefulShutdown('SIGINT'))
}

bootstrap().catch((err) => {
  getLogger().error('fatal bootstrap error', { err })
  process.exit(1)
})
