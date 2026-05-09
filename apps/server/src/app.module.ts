import { APP_FILTER, APP_MIDDLEWARE, Module } from '@tsuki-hono/common'

import { ServerConfig } from './config/server-config'
import { DatabaseModule } from './database/database.module'
import { AppExceptionFilter } from './filters/app-exception.filter'
import { Logger } from './logging/logger'
import { RequestIdMiddleware } from './middlewares/request-id.middleware'
import { AcpModule } from './modules/acp/acp.module'
import { AgentIdentityModule } from './modules/agent-identity/agent-identity.module'
import { ApprovalModule } from './modules/approval/approval.module'
import { ChatRuntimeModule } from './modules/chat-runtime/chat-runtime.module'
import { GitModule } from './modules/git/git.module'
import { HealthModule } from './modules/health/health.module'
import { IssueAgentModule } from './modules/issue-agent/issue-agent.module'
import { KanbanModule } from './modules/kanban/kanban.module'
import { ObservabilityModule } from './modules/observability/observability.module'
import { PackCodebaseModule } from './modules/pack-codebase/pack-codebase.module'
import { PreferencesModule } from './modules/preferences/preferences.module'
import { ProfilesModule } from './modules/profiles/profiles.module'
import { ProvidersModule } from './modules/providers/providers.module'
import { PtyModule } from './modules/pty/pty.module'
import { SearchModule } from './modules/search/search.module'
import { SecretsModule } from './modules/secrets/secrets.module'
import { SessionModule } from './modules/session/session.module'
import { SkillsModule } from './modules/skills/skills.module'
import { UsageModule } from './modules/usage/usage.module'
import { WorkflowRulesModule } from './modules/workflow-rules/workflow-rules.module'
import { WorkspaceModule } from './modules/workspace/workspace.module'

@Module({
  imports: [
    DatabaseModule,
    HealthModule,
    AcpModule,
    AgentIdentityModule,
    ApprovalModule,
    ChatRuntimeModule,
    GitModule,
    IssueAgentModule,
    KanbanModule,
    ObservabilityModule,
    PackCodebaseModule,
    PreferencesModule,
    ProfilesModule,
    ProvidersModule,
    PtyModule,
    SearchModule,
    SecretsModule,
    SessionModule,
    SkillsModule,
    UsageModule,
    WorkflowRulesModule,
    WorkspaceModule,
],
  providers: [
    ServerConfig,
    Logger,
    RequestIdMiddleware,
    AppExceptionFilter,
    { provide: APP_MIDDLEWARE, useClass: RequestIdMiddleware },
    { provide: APP_FILTER, useClass: AppExceptionFilter },
  ],
})
export class AppModule {}
