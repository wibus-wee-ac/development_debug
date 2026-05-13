// Input: Elysia plugins and feature route modules
// Output: Elysia server app — pure composition root
// Position: apps/server/src explicit Elysia composition root

import { cors } from '@elysiajs/cors'
import { node } from '@elysiajs/node'
import { Elysia } from 'elysia'

import { createErrorHandler } from './http/error-mapping'
import { createOpenApiPlugin, registerOpenApiAlias } from './http/openapi'
import { createRequestIdPlugin } from './http/request-id'
import { createRequestLoggerPlugin } from './http/request-logger'
import { shutdownInfra } from './infra'
import { acp } from './modules/acp'
import { agentIdentity } from './modules/agent-identity'
import { approval } from './modules/approval'
import { chatRuntime } from './modules/chat-runtime'
import { filesystem } from './modules/filesystem'
import { git } from './modules/git'
import { health } from './modules/health'
import { issueAgent } from './modules/issue-agent'
import { kanban } from './modules/kanban'
import { observability } from './modules/observability'
import { packCodebase } from './modules/pack-codebase'
import { preferences } from './modules/preferences'
import { profiles } from './modules/profiles'
import { providers } from './modules/providers'
import { pty } from './modules/pty'
import { search } from './modules/search'
import { secrets } from './modules/secrets'
import { session } from './modules/session'
import { sessionAwait } from './modules/session-await'
import { skills } from './modules/skills'
import { testReset } from './modules/test-reset'
import { usage } from './modules/usage'
import { workflowRules } from './modules/workflow-rules'
import { workspace } from './modules/workspace'

export function createServerApp() {
  const app = new Elysia({
    name: 'cradle.server.elysia',
    adapter: node(),
    normalize: 'typebox',
  })

  app.use(cors())
  app.use(createRequestIdPlugin())
  app.use(createRequestLoggerPlugin())
  app.onError(createErrorHandler())
  app.use(createOpenApiPlugin())
  app.use(health)
  app.use(preferences)
  app.use(workspace)
  app.use(filesystem)
  app.use(usage)
  app.use(profiles)
  app.use(secrets)
  app.use(providers)
  app.use(agentIdentity)
  app.use(session)
  app.use(sessionAwait)
  app.use(kanban)
  app.use(search)
  app.use(skills)
  app.use(workflowRules)
  app.use(git)
  app.use(packCodebase)
  app.use(approval)
  app.use(acp)
  app.use(chatRuntime)
  app.use(pty)
  app.use(observability)
  app.use(issueAgent)
  if (process.env.NODE_ENV === 'test') {
    app.use(testReset)
  }
  app.onStop([() => shutdownInfra()])
  registerOpenApiAlias(app)

  return app
}
