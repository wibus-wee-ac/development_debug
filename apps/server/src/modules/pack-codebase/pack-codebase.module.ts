// Input: Pack-codebase providers and controller
// Output: PackCodebaseModule registration
// Position: apps/server/src/modules/pack-codebase/pack-codebase.module.ts

import { Module } from '@tsuki-hono/common'

import { WorkspaceModule } from '../workspace/workspace.module'
import { PackCodebaseController } from './pack-codebase.controller'
import { PackCodebaseEngine } from './pack-codebase.engine'
import { PackCodebaseService } from './pack-codebase.service'

@Module({
  imports: [WorkspaceModule],
  controllers: [PackCodebaseController],
  providers: [PackCodebaseService, PackCodebaseEngine],
})
export class PackCodebaseModule {}
