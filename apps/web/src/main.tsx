import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as React from 'react'
import ReactDOM from 'react-dom/client'

import { App } from './app'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
)
