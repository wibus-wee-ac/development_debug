// Input: kanban controller, service, and store
// Output: kanban module registration
// Position: apps/server/src/modules/kanban/kanban.module.ts

import { Module } from '@tsuki-hono/common'

import { KanbanController } from './kanban.controller'
import { KanbanService } from './kanban.service'
import { KanbanStore } from './kanban.store'

@Module({
  controllers: [KanbanController],
  providers: [KanbanService, KanbanStore],
})
export class KanbanModule {}
