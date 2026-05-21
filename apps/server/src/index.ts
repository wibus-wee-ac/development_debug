import { flushLogger, getLogger } from './logging/logger'

interface RuntimeServer {
  stop(): void | Promise<void>
}

function recordFatalError(message: string, err: unknown): void {
  const logger = getLogger()
  if (err instanceof Error) {
    logger.error(message, { err })
  }
  else {
    logger.error(message, { reason: err })
  }
  flushLogger()
}

function installProcessFatalHandlers(): void {
  process.on('unhandledRejection', (reason) => {
    recordFatalError('unhandled promise rejection', reason)
    process.exit(1)
  })

  process.on('uncaughtException', (err) => {
    recordFatalError('uncaught exception', err)
    process.exit(1)
  })

  process.on('warning', (warning) => {
    getLogger().warn('process warning', { err: warning })
    flushLogger()
  })
}

async function bootstrap() {
  installProcessFatalHandlers()
  await import('./langfuse')
  const [{ createServerApp }, { loadServerConfig }, { warmupModelsDevCache }] = await Promise.all([
    import('./app'),
    import('./config/server-config'),
    import('./modules/providers/model-info-registry'),
  ])

  const config = loadServerConfig()
  const logger = getLogger()

  const app = await createServerApp()
  let runtimeServer: RuntimeServer | null = null

  app.listen({
    port: config.port,
    hostname: config.host,
    reusePort: true,
  }, (server) => {
    runtimeServer = server
  })

  // Pre-warm models.dev cache so first model list request is fast
  warmupModelsDevCache()

  logger.info(`listening on http://${config.host}:${config.port}`)

  let shutdownStarted = false
  const gracefulShutdown = async (signal: string) => {
    if (shutdownStarted) return
    shutdownStarted = true

    logger.info(`received ${signal}, shutting down gracefully...`)
    try {
      if (runtimeServer) {
        await runtimeServer.stop()
      }
      else {
        await app.stop()
      }
      logger.info('graceful shutdown complete')
    } catch (err) {
      logger.error('error during graceful shutdown', { err })
    } finally {
      flushLogger()
      process.exit(0)
    }
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
  process.on('SIGINT', () => gracefulShutdown('SIGINT'))
}

bootstrap().catch((err) => {
  recordFatalError('fatal bootstrap error', err)
  process.exit(1)
})
