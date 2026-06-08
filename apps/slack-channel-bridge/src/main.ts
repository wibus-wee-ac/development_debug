import { loadConfig } from './config'
import { configureCradleClient } from './cradle/client'
import { CradleService } from './cradle/service'
import { createBridgeDatabase } from './db/client'
import { createSlackBridgeApp } from './slack/app'
import { BridgeStore } from './store'

async function main(): Promise<void> {
  const config = loadConfig()
  configureCradleClient(config.cradleApiBaseUrl)
  const database = createBridgeDatabase(config.dbPath)
  const store = new BridgeStore(database)
  const cradle = new CradleService({
    agentId: config.cradleAgentId,
    providerTargetId: config.cradleProviderTargetId,
    runtimeKind: config.cradleRuntimeKind,
    modelId: config.cradleModelId,
  })
  const app = createSlackBridgeApp({ config, store, cradle })

  const shutdown = async () => {
    await app.stop()
    store.close()
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())

  await app.start()
}

main().catch((error) => {
  console.error('[slack-channel-bridge] fatal', error)
  process.exit(1)
})
