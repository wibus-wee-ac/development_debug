import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as React from 'react'
import * as ReactJSXRuntime from 'react/jsx-runtime'
import * as ReactDOM from 'react-dom'
import * as ReactDOMClient from 'react-dom/client'

import { App } from './app'
import { AppErrorBoundary } from './components/common/app-error-boundary'
import { DevtoolPage } from './features/devtool/ipc-devtool-page'
import { resolveInitialLocale } from './i18n/browser-locale'
import { I18nProvider } from './i18n/client'
import { initPerfMonitor } from './lib/perf-monitor'
import { loadWebPlugins } from './lib/plugin-host'

type SharedModuleRegistry = Window & {
  [key: symbol]: Record<string, unknown>
}

// Expose shared React modules for plugin runtime
// Plugins loaded via dynamic import() need access to the SAME React instance
const sharedModuleRegistry = window as unknown as SharedModuleRegistry
sharedModuleRegistry[Symbol.for('cradle:modules')] = {
  'react': React,
  'react-dom': ReactDOM,
  'react-dom/client': ReactDOMClient,
  'react/jsx-runtime': ReactJSXRuntime,
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

// Hash-based routing: #devtool renders the devtool page (Electron second window)
const isDevtoolWindow = window.location.hash === '#devtool' || window.location.hash === '#/devtool'

async function startApp(): Promise<void> {
  const initialLocale = resolveInitialLocale()

  // Load web plugins before rendering.
  await loadWebPlugins()

  ReactDOMClient.createRoot(document.getElementById('app')!).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <I18nProvider initialLocale={initialLocale}>
          <QueryClientProvider client={queryClient}>
            {isDevtoolWindow ? <DevtoolPage /> : <App />}
          </QueryClientProvider>
        </I18nProvider>
      </AppErrorBoundary>
    </React.StrictMode>,
  )

  // Non-blocking: initialize performance monitoring after render.
  queueMicrotask(initPerfMonitor)
}

void startApp()
