// Input: git controller and service
// Output: git module registration
// Position: apps/server/src/modules/git/git.module.ts

import { Module } from '@tsuki-hono/common'

import { WorkspaceModule } from '../workspace/workspace.module'
import { GitController } from './git.controller'
import { GitService } from './git.service'

@Module({
  imports: [WorkspaceModule],
  controllers: [GitController],
  providers: [GitService],
})
export class GitModule {}
