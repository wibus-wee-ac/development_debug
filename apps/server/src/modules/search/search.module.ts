// Input: search controller and providers
// Output: search module registration
// Position: apps/server/src/modules/search/search.module.ts

import { Module } from '@tsuki-hono/common'

import { SearchController } from './search.controller'
import { SearchService } from './search.service'
import { ThreadSearchEngine } from './thread-search.engine'

@Module({
  controllers: [SearchController],
  providers: [SearchService, ThreadSearchEngine],
})
export class SearchModule {}
