import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createBridgeDatabase } from '../src/db/client'
import { BridgeStore } from '../src/store'

export interface TestStore {
  store: BridgeStore
  dbPath: string
  cleanup(): void
}

export function createTestStore(): TestStore {
  const dir = mkdtempSync(join(tmpdir(), 'slack-channel-bridge-'))
  const dbPath = join(dir, 'bridge.sqlite')
  const database = createBridgeDatabase(dbPath)
  const store = new BridgeStore(database)
  return {
    store,
    dbPath,
    cleanup() {
      store.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
