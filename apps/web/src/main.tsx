import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as ReactDOMClient from 'react-dom/client'
import * as ReactJSXRuntime from 'react/jsx-runtime'

import { App } from './app'
import { DevtoolPage } from './features/devtool'
import { initPerfMonitor } from './lib/perf-monitor'
import { loadWebPlugins } from './lib/plugin-host'

// Expose shared React modules for plugin runtime
// Plugins loaded via dynamic import() need access to the SAME React instance
;(window as any).__CRADLE_SHARED__ = {
  react: React,
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

// Load web plugins before rendering
await loadWebPlugins()

ReactDOMClient.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {isDevtoolWindow ? <DevtoolPage /> : <App />}
    </QueryClientProvider>
  </React.StrictMode>,
)

// Non-blocking: initialize performance monitoring after render
queueMicrotask(initPerfMonitor)
