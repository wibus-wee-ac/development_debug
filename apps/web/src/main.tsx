import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as React from 'react'
import ReactDOM from 'react-dom/client'

import { App } from './app'
import { DevtoolPage } from './features/devtool'
import { initPerfMonitor } from './lib/perf-monitor'

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

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {isDevtoolWindow ? <DevtoolPage /> : <App />}
    </QueryClientProvider>
  </React.StrictMode>,
)

// Non-blocking: initialize performance monitoring after render
queueMicrotask(initPerfMonitor)
