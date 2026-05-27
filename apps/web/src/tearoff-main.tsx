// Output: Minimal renderer entry for session tear-off windows.
// Input: Electron preload session id and server URL.
// Position: Web-owned tear-off surface that bypasses the main app shell.

import './styles.css'

import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { lazy, Suspense, useEffect } from 'react'
import * as ReactDOMClient from 'react-dom/client'
import { z } from 'zod'

import { getSessionsByIdOptions } from '~/api-gen/@tanstack/react-query.gen'
import { AppEnvironmentProviders, useThemeClass } from '~/app-providers'
import { AppErrorBoundary } from '~/components/common/app-error-boundary'
import { ChatRuntimeView } from '~/features/chat/chat-runtime-view'
import { loadTuiView } from '~/features/tui/tui-view-loader'
import { resolveInitialLocale } from '~/i18n/browser-locale'
import { I18nProvider } from '~/i18n/client'
import { platform, tearoffSessionId } from '~/lib/electron'

const TuiView = lazy(loadTuiView)

const RuntimeKindSchema = z.enum(['standard', 'claude-agent', 'codex', 'jar-core', 'acp-chat', 'cli-tui'])
const TearoffSessionMetadataSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  workspaceId: z.string().nullable(),
  providerTargetId: z.string().nullable(),
  runtimeKind: RuntimeKindSchema,
}).passthrough()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

function TearoffRuntime() {
  'use no memo'

  const sessionId = tearoffSessionId
  useThemeClass()

  useEffect(() => {
    document.body.dataset.surface = 'tearoff'
  }, [])

  if (!sessionId) {
    return null
  }

  return <TearoffSession sessionId={sessionId} />
}

function TearoffSession({ sessionId }: { sessionId: string }) {
  'use no memo'

  const { data: session } = useQuery({
    ...getSessionsByIdOptions({ path: { id: sessionId } }),
    select: data => data ? TearoffSessionMetadataSchema.parse(data) : undefined,
  })
  const reserveTrafficLightSpace = platform === 'darwin'

  return (
    <AppEnvironmentProviders>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-sidebar text-foreground">
        <header
          className="flex h-11 shrink-0 items-center gap-2 bg-sidebar px-3 text-xs font-medium text-sidebar-foreground/70"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          {reserveTrafficLightSpace && <div aria-hidden="true" className="h-full w-16 shrink-0" />}
          <span className="truncate">{session?.title ?? 'Chat'}</span>
        </header>
        <main className="m-1 mt-0 min-h-0 flex-1 overflow-hidden rounded-xl bg-background shadow-[var(--shadow-sm)]">
          {session?.runtimeKind === 'cli-tui'
            ? (
                <Suspense fallback={null}>
                  <TuiView sessionId={sessionId} />
                </Suspense>
              )
            : (
                <ChatRuntimeView
                  sessionId={sessionId}
                  sessionProviderTargetId={session?.providerTargetId ?? null}
                  runtimeKind={session?.runtimeKind}
                  workspaceId={session?.workspaceId ?? null}
                />
              )}
        </main>
      </div>
    </AppEnvironmentProviders>
  )
}

const initialLocale = resolveInitialLocale()

ReactDOMClient.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <I18nProvider initialLocale={initialLocale}>
        <QueryClientProvider client={queryClient}>
          <TearoffRuntime />
        </QueryClientProvider>
      </I18nProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
)
