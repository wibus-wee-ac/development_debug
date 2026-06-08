/* eslint-disable react-refresh/only-export-components */

import './styles.css'

import { TabRenderer, TabsProvider } from '@cradle/tabs-next'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as React from 'react'
import { useEffect } from 'react'
import * as ReactDOMClient from 'react-dom/client'

import { AppEnvironmentProviders, useThemeClass } from '~/app-providers'
import { AppErrorBoundary } from '~/components/common/app-error-boundary'
import { AppLayout } from '~/components/layout/app-layout'
import { useSyncLayoutSlotScope } from '~/components/layout/use-layout-slots'
import { resolveInitialLocale } from '~/i18n/browser-locale'
import { I18nProvider } from '~/i18n/client'
import { tearoffSessionId } from '~/lib/electron'
import { CHAT_TAB_FALLBACK_LABEL } from '~/tabs/chat.tab'
import { cradleRegistry, cradleTabStore } from '~/tabs/registry'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

function restoreTearoffTab(sessionId: string): void {
  cradleTabStore.getState().restoreTabs({
    tabs: [{
      id: 'tearoff-session',
      type: 'chat',
      params: { sessionId },
      label: CHAT_TAB_FALLBACK_LABEL,
      pinned: true,
    }],
    activeTabId: 'tearoff-session',
  })
}

function TearoffShellFallback() {
  return <div className="h-full w-full bg-background" />
}

if (tearoffSessionId) {
  restoreTearoffTab(tearoffSessionId)
}

function TearoffRuntime() {
  'use no memo'

  const sessionId = tearoffSessionId
  useThemeClass()

  useEffect(() => {
    document.body.dataset.surface = 'tearoff'
  }, [])

  if (!sessionId) {
    return (
      <div className="flex h-screen w-screen overflow-hidden bg-sidebar">
        <TearoffShellFallback />
      </div>
    )
  }

  return <TearoffSession sessionId={sessionId} />
}

function TearoffSession({ sessionId }: { sessionId: string }) {
  'use no memo'

  useSyncLayoutSlotScope(sessionId, [sessionId])

  return (
    <AppEnvironmentProviders>
      <TabsProvider store={cradleTabStore} registry={cradleRegistry}>
        <div className="flex h-screen w-screen overflow-hidden bg-sidebar">
          <AppLayout sessionScoped showFooter={false}>
            <TabRenderer
              fallback={<TearoffShellFallback />}
              className="h-full flex overflow-hidden w-full"
            />
          </AppLayout>
        </div>
      </TabsProvider>
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
