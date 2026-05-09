// Input: thread search engine
// Output: search capability orchestration
// Position: apps/server/src/modules/search/search.service.ts

import { injectable } from 'tsyringe'

import type { ThreadSearchHit, ThreadSearchParams } from './thread-search.engine'
import { ThreadSearchEngine } from './thread-search.engine'

@injectable()
export class SearchService {
  constructor(private readonly engine: ThreadSearchEngine) {}

  searchThreads(params: ThreadSearchParams): ThreadSearchHit[] {
    return this.engine.search(params)
  }
}
