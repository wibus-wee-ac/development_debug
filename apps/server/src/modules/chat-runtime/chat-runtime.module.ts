// Input: chat-runtime controller, service, store, and provider registry
// Output: chat-runtime module registration
// Position: apps/server/src/modules/chat-runtime/chat-runtime.module.ts

import { Module } from '@tsuki-hono/common'

import { DatabaseModule } from '../../database/database.module'
import { ApprovalModule } from '../approval/approval.module'
import { ObservabilityModule } from '../observability/observability.module'
import { ProfilesModule } from '../profiles/profiles.module'
import { SecretsModule } from '../secrets/secrets.module'
import { SessionModule } from '../session/session.module'
import { AcpConnectionManager } from './providers/acp/connection-manager'
import { AcpProcessManager } from './providers/acp/process-manager'
import { AcpRuntimeIntegration } from './providers/acp/runtime-integration'
import { ChatTurnContextResolver } from './chat-turn-context'
import { ChatRuntimeController } from './chat-runtime.controller'
import { ChatRuntimeProviderRegistry } from './chat-runtime-provider-registry'
import { ChatRuntimeService } from './chat-runtime.service'
import { ChatRuntimeStore } from './chat-runtime.store'

@Module({
  imports: [DatabaseModule, ApprovalModule, ObservabilityModule, ProfilesModule, SecretsModule, SessionModule],
  controllers: [ChatRuntimeController],
  providers: [
    AcpConnectionManager,
    AcpProcessManager,
    AcpRuntimeIntegration,
    ChatTurnContextResolver,
    ChatRuntimeProviderRegistry,
    ChatRuntimeService,
    ChatRuntimeStore,
  ],
})
export class ChatRuntimeModule {}
