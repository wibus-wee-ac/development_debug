import { cors } from '@elysiajs/cors'
import { node } from '@elysiajs/node'
import { Elysia } from 'elysia'

import { createErrorHandler } from './http/error-mapping'
import { createOpenApiPlugin, registerOpenApiAlias } from './http/openapi'
import { createRequestIdPlugin } from './http/request-id'
import { createRequestLoggerPlugin } from './http/request-logger'
import { shutdownInfra } from './infra'
import { flushAllActiveRunSnapshots, recoverPersistedStreamingRuns } from './modules/chat-runtime/service'
import { shutdownTraceStreams } from './modules/chat-runtime/stream-trace'
import { acp } from './modules/acp'
import { agentIdentity } from './modules/agent-identity'
import { automation } from './modules/automation'
import { chatRuntime } from './modules/chat-runtime'
import { chronicle, chronicleApi, chronicleMemoryApi } from './modules/chronicle'
import { cleanup as chronicleCleanup } from './modules/chronicle/daemon-manager'
import {
  initDaemon as chronicleInitDaemon,
  startSlackBackgroundSync as chronicleStartSlackBackgroundSync,
  stopActivityPipelineScheduler as chronicleStopActivityPipelineScheduler,
  stopSlackBackgroundSync as chronicleStopSlackBackgroundSync,
} from './modules/chronicle/service'
import { desktop } from './modules/desktop'
import { externalProviderSources } from './modules/external-provider-sources'
import { refreshAllExternalProviderSources } from './modules/external-provider-sources/service'
import { externalWorkImport } from './modules/external-work-import'
import { filesystem } from './modules/filesystem'
import { git } from './modules/git'
import { health } from './modules/health'
import { issue } from './modules/issue'
import { issueAgent } from './modules/issue-agent'
import { kanban } from './modules/kanban'
import { modelRegistry } from './modules/model-registry'
import { observability } from './modules/observability'
import { packCodebase } from './modules/pack-codebase'
import { preferences } from './modules/preferences'
import { profiles } from './modules/profiles'
import { providerTargets } from './modules/provider-targets'
import { providers } from './modules/provider-catalog'
import { registerPtyRoutes } from './modules/pty'
import { search } from './modules/search'
import { secrets } from './modules/secrets'
import { session } from './modules/session'
import { sessionAwait } from './modules/session-await'
import { skills } from './modules/skills'
import { testReset } from './modules/test-reset'
import { usage } from './modules/usage'
import { workflowRules } from './modules/workflow-rules'
import { workspace } from './modules/workspace'
import { activateServerPlugins } from './plugins'

interface CreateServerAppOptions {
  startBackgroundTasks?: boolean
}

function isAllowedCorsOrigin({ headers }: { headers: Headers }): boolean {
  const origin = headers.get('origin')
  if (!origin || origin === 'null') {
    return true
  }

  try {
    const parsed = new URL(origin)
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
    )
  }
 catch {
    return false
  }
}

export async function createServerApp(options: CreateServerAppOptions = {}) {
  const { startBackgroundTasks = process.env.NODE_ENV !== 'test' } = options
  const app = new Elysia({
    name: 'cradle.server.elysia',
    adapter: node(),
    normalize: 'typebox',
  })
  recoverPersistedStreamingRuns()

  app.use(
    cors({
      origin: isAllowedCorsOrigin,
      exposeHeaders: [
        'x-cradle-run-id',
        'x-cradle-assistant-message-id',
        'x-cradle-user-message-id',
      ],
    }),
  )
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
  app.use(providerTargets)
  app.use(externalProviderSources)
  app.use(externalWorkImport)
  app.use(secrets)
  app.use(modelRegistry)
  app.use(providers)
  app.use(agentIdentity)
  app.use(automation)
  app.use(session)
  app.use(sessionAwait)
  app.use(issue)
  app.use(kanban)
  app.use(search)
  app.use(skills)
  app.use(workflowRules)
  app.use(git)
  app.use(packCodebase)
  app.use(acp)
  app.use(chatRuntime)
  app.use(chronicle)
  app.use(chronicleApi)
  app.use(chronicleMemoryApi)
  app.use(desktop)
  registerPtyRoutes(app)
  app.use(observability)
  app.use(issueAgent)
  if (process.env.NODE_ENV === 'test') {
    app.use(testReset)
  }
  // Plugin system — discover and activate server plugins
  await activateServerPlugins(app)

  app.onStop([
    () => flushAllActiveRunSnapshots(),
    () => chronicleStopActivityPipelineScheduler(),
    () => chronicleStopSlackBackgroundSync(),
    () => chronicleCleanup(),
    () => shutdownTraceStreams(),
    () => shutdownInfra(),
  ])

  // Start chronicle daemon if enabled
  if (startBackgroundTasks) {
    void refreshAllExternalProviderSources()
      .then((results) => {
        for (const result of results) {
          if (result.status === 'error') {
            console.error('[external-provider-sources] Source refresh failed:', {
              sourceKey: result.sourceKey,
              message: result.message ?? 'Unknown sync error',
            })
          }
        }
      })
      .catch((error) => {
        console.error('[external-provider-sources] Refresh failed:', error)
      })
    void chronicleInitDaemon().catch((error) => {
      console.error('[chronicle] Daemon initialization failed:', error)
    })
    chronicleStartSlackBackgroundSync()
  }

  registerOpenApiAlias(app)

  return app
}
