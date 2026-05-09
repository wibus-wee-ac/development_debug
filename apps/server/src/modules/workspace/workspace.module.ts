// Input: Workspace module providers + controller
// Output: WorkspaceModule registration
// Position: apps/server/src/modules/workspace/workspace.module.ts

import { Module } from '@tsuki-hono/common'

import { WorkspaceController } from './workspace.controller'
import { WorkspaceFiles } from './workspace.files'
import { WorkspaceService } from './workspace.service'
import { WorkspaceStore } from './workspace.store'

@Module({
  controllers: [WorkspaceController],
  providers: [WorkspaceService, WorkspaceStore, WorkspaceFiles],
})
export class WorkspaceModule {}
