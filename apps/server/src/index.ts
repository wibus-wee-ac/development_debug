import './langfuse'
import { createServerApp } from './app'
import { loadServerConfig } from './config/server-config'
import { getLogger } from './logging/logger'

async function bootstrap() {
  const config = loadServerConfig()
  const logger = getLogger()

  const app = createServerApp()

  app.listen({
    port: config.port,
    hostname: config.host,
  })

  logger.info(`listening on http://${config.host}:${config.port}`)
}

bootstrap().catch((err) => {
  getLogger().error('fatal bootstrap error', { err })
  process.exit(1)
})
