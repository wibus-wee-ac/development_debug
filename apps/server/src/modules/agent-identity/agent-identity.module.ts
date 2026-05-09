// Input: Agent identity module providers + controller
// Output: AgentIdentityModule registration
// Position: apps/server/src/modules/agent-identity/agent-identity.module.ts

import { Module } from '@tsuki-hono/common'

import { AgentIdentityController } from './agent-identity.controller'
import { AgentIdentityService } from './agent-identity.service'
import { AgentIdentityStore } from './agent-identity.store'

@Module({
  controllers: [AgentIdentityController],
  providers: [AgentIdentityService, AgentIdentityStore],
})
export class AgentIdentityModule {}
