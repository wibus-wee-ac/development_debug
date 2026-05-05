// Input: IpcService decorator framework, ThreadSearchEngine singleton
// Output: SearchService IPC surface — forwards queries to ThreadSearchEngine
// Position: Main-process IPC layer (L2 surface) for thread search feature

import { IpcMethod, IpcService } from '@cradle/ipc'

import type { ThreadSearchHit, ThreadSearchParams } from '../../chat/thread-search'
import { threadSearchEngine } from '../../chat/thread-search'

export class SearchService extends IpcService {
  static readonly groupName = 'search'

  private get engine() {
    return threadSearchEngine
  }

  @IpcMethod()
  searchThreads(params: ThreadSearchParams): ThreadSearchHit[] {
    return this.engine.search(params)
  }
}
