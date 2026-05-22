import * as SessionService from '../session/service'
import { searchChronicle as runChronicleSearch } from './chronicle-search.engine'
import type { ChronicleSearchParams } from './chronicle-search.engine'
import type { ThreadSearchParams } from './thread-search.engine'
import { ThreadSearchEngine } from './thread-search.engine'

const engine = new ThreadSearchEngine()

SessionService.onSessionCleanup((sessionId) => {
  engine.removeSessionFromIndex(sessionId)
})

export function searchThreads(params: ThreadSearchParams) {
  return engine.search(params)
}

export function searchChronicle(params: ChronicleSearchParams) {
  return runChronicleSearch(params)
}

export function indexMessage(sessionId: string, sessionTitle: string, messageId: string, content: string) {
  engine.indexMessage(sessionId, sessionTitle, messageId, content)
}

export function removeSessionFromIndex(sessionId: string) {
  engine.removeSessionFromIndex(sessionId)
}

export function rebuildIndex() {
  engine.rebuildIndex()
}
