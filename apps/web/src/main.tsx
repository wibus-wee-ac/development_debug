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
import { reportRendererError } from './lib/observability-client'

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

function installRendererErrorCapture(): void {
  window.addEventListener('error', (event) => {
    reportRendererError({
      code: 'RENDERER_UNHANDLED_ERROR',
      message: event.message || 'Unhandled renderer error',
      error: event.error ?? event.message,
      attrs: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    reportRendererError({
      code: 'RENDERER_UNHANDLED_REJECTION',
      message: 'Unhandled renderer promise rejection',
      error: event.reason,
    })
  })
}

async function startApp(): Promise<void> {
  installRendererErrorCapture()
  const initialLocale = resolveInitialLocale()

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

  queueMicrotask(() => {
    initPerfMonitor()
    void loadWebPlugins().catch((error) => {
      console.error('[plugin-host] failed to load web plugins:', error)
    })
  })
}

void startApp()
