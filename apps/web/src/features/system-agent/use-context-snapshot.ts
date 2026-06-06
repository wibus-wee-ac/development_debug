import type { ContextEnvelope } from '~/features/context/context-items'
import { jarvisContextRegistry } from '~/features/context/context-registry'

import { installSystemAgentContextProvider } from './system-context-provider'

export function collectContextEnvelope(): ContextEnvelope {
  installSystemAgentContextProvider()
  return jarvisContextRegistry.collectEnvelope()
}
